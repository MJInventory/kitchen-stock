import http from "node:http";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

const baseId = "appAFvMwWZb2PPWUz";
const inventoryTableId = "tblEuIXG6gxEiD5oU";
const requestsTableId = "tblUHh1jWhqMFEfjd";
const suppliersTableId = "tbl2YP7EpUpk3Ug6f";
const token = process.env.AIRTABLE_TOKEN;
const port = Number(process.env.PORT || 3000);
const itemCacheMs = Number(process.env.ITEM_CACHE_MS || 10 * 60 * 1000);
const requestCacheMs = Number(process.env.REQUEST_CACHE_MS || 20 * 1000);
const authSecret = process.env.AUTH_SECRET || "change-this-secret-in-render";
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const userConfig = process.env.APP_USERS || "";
const allowedUnits = new Set(["box", "bag", "item", "bottle"]);
const accountingInbox = process.env.ACCOUNTING_INBOX || "bills.madameja.23d9599b@billfiles.com";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const mailFrom = process.env.MAIL_FROM || smtpUser;
const ocrSpaceApiKey = process.env.OCR_SPACE_API_KEY || "helloworld";

const cache = {
  items: { expiresAt: 0, value: null, pending: null },
  requests: { expiresAt: 0, value: null, pending: null },
  suppliers: { expiresAt: 0, value: null, pending: null },
  lookups: { expiresAt: 0, value: null, pending: null },
  schema: { expiresAt: 0, value: null, pending: null }
};

const metrics = {
  airtableCalls: 0,
  cacheHits: { items: 0, requests: 0, suppliers: 0, lookups: 0, schema: 0 }
};

const lookupConfigs = {
  categories: { tableName: "Categories", primaryField: "Category" },
  storageLocations: { tableName: "Storage Locations", primaryField: "Storage Location" },
  inventorySubgroups: { tableName: "Inventory Subgroups", primaryField: "Inventory Subgroup" },
  shelfCodes: { tableName: "Shelf Codes", primaryField: "Shelf Code" },
  inventoryAreas: { tableName: "Inventory Areas", primaryField: "Inventory Area" },
  unitOfMeasurement: { tableName: "Unit Of Measurement", primaryField: "Unit" }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function parseUsers() {
  return new Map(
    userConfig
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, password] = entry.split(":");
        return [String(name || "").trim().toLowerCase(), {
          name: String(name || "").trim(),
          password: String(password || "").trim()
        }];
      })
      .filter(([name, user]) => name && user.password)
  );
}

const users = parseUsers();

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", authSecret).update(value).digest("base64url");
}

function createSession(userName) {
  const payload = JSON.stringify({
    user: userName,
    exp: Date.now() + sessionMaxAgeMs
  });
  const encoded = base64url(payload);
  return `${encoded}.${sign(encoded)}`;
}

function verifySession(tokenValue) {
  if (!tokenValue || !tokenValue.includes(".")) return null;

  const [encoded, signature] = tokenValue.split(".");
  const expected = sign(encoded);

  if (signature.length !== expected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.user || !payload.exp || Date.now() > payload.exp) return null;
    return { name: payload.user };
  } catch {
    return null;
  }
}

function bearerUser(req) {
  const header = req.headers.authorization || "";
  const tokenValue = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifySession(tokenValue);
}

function requireUser(req, res) {
  const user = bearerUser(req);
  if (!user) {
    send(res, 401, { error: "Login required." });
    return null;
  }
  return user;
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function requireSmtpConfig() {
  const missing = [];
  if (!smtpHost) missing.push("SMTP_HOST");
  if (!smtpUser) missing.push("SMTP_USER");
  if (!smtpPass) missing.push("SMTP_PASS");
  if (!mailFrom) missing.push("MAIL_FROM");
  if (missing.length) {
    throw new Error(`Email is not configured yet. Add these Render environment variables: ${missing.join(", ")}.`);
  }
}

function attachmentFromDataUrl(dataUrl, fileName) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invoice image data was not valid.");

  const content = Buffer.from(match[2], "base64");
  if (!content.length) throw new Error("Invoice image was empty.");
  if (content.length > 12 * 1024 * 1024) throw new Error("Invoice image is too large to email. Retake a smaller photo.");

  return {
    filename: String(fileName || "invoice.jpg").replace(/[^\w.\- ]+/g, "_"),
    contentType: match[1],
    content
  };
}

async function ocrSpaceParseImage(payload) {
  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("OCR image data was not valid.");

  const imageBytes = Buffer.from(match[2], "base64");
  if (!imageBytes.length) throw new Error("OCR image was empty.");
  if (imageBytes.length > 1024 * 1024) {
    throw new Error("OCR.space free API accepts images up to 1 MB. Retake or use a smaller image.");
  }

  const form = new FormData();
  form.set("base64Image", dataUrl);
  form.set("language", "eng");
  form.set("isOverlayRequired", "false");
  form.set("detectOrientation", "true");
  form.set("scale", "true");
  form.set("isTable", "true");
  form.set("OCREngine", String(payload.engine || "2"));

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: {
      apikey: ocrSpaceApiKey
    },
    body: form
  });

  const data = await response.json();
  if (!response.ok || data.IsErroredOnProcessing) {
    const errorText = Array.isArray(data.ErrorMessage)
      ? data.ErrorMessage.join(" ")
      : data.ErrorMessage || response.statusText;
    throw new Error(`Hosted OCR failed: ${errorText}`);
  }

  const parsedText = (data.ParsedResults || [])
    .map((result) => result.ParsedText || "")
    .join("\n")
    .trim();

  return {
    text: parsedText,
    provider: "OCR.space",
    exitCode: data.OCRExitCode || null
  };
}

async function airtable(path, options = {}) {
  if (!token) {
    throw new Error("AIRTABLE_TOKEN is not set.");
  }

  metrics.airtableCalls += 1;

  const url = options.meta
    ? `https://api.airtable.com/v0/meta/bases/${baseId}/${path}`
    : `https://api.airtable.com/v0/${baseId}/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return data;
}

async function listItems() {
  const suppliers = await getSuppliers();
  const lookups = await getLookups();
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const data = await airtable(`${inventoryTableId}?pageSize=100`);
  return data.records
    .map((record) => normalizeItem(record, supplierById, lookups))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function linkedValue(record, linkFieldName, fallbackFieldName, lookupMap) {
  const linkedId = record.fields[linkFieldName]?.[0] || "";
  return lookupMap?.byId?.get(linkedId)?.name || record.fields[fallbackFieldName] || "";
}

function normalizeItem(record, supplierById, lookups) {
  const supplierId = record.fields["Supplier/Vendor"]?.[0] || "";
  const supplier = supplierById.get(supplierId);

  return {
    id: record.id,
    name: record.fields["Item Name"] || "",
    category: linkedValue(record, "Category Link", "Category", lookups.categories),
    storageLocation: linkedValue(record, "Storage Location Link", "Storage Location", lookups.storageLocations),
    inventoryArea: linkedValue(record, "Inventory Area Link", "Inventory Area", lookups.inventoryAreas),
    inventorySubgroup: linkedValue(record, "Inventory Subgroup Link", "Inventory Subgroup", lookups.inventorySubgroups),
    shelfCode: linkedValue(record, "Shelf Code Link", "Shelf Code", lookups.shelfCodes),
    supplierId,
    supplierName: supplier?.name || "Unassigned Supplier",
    supplierContact: supplier?.contact || "",
    quantity: record.fields["Current Quantity"] ?? null,
    unit: linkedValue(record, "Unit Of Measurement Link", "Unit of Measure", lookups.unitOfMeasurement),
    minimum: record.fields["Minimum Threshold"] ?? null
  };
}

async function listSuppliers() {
  const data = await airtable(`${suppliersTableId}?pageSize=100`);
  return data.records
    .map((record) => ({
      id: record.id,
      name: record.fields["Supplier Name"] || "",
      contact: record.fields["Contact Information"] || ""
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listRequests() {
  const data = await airtable(`${requestsTableId}?pageSize=20&sort%5B0%5D%5Bfield%5D=Request%20ID&sort%5B0%5D%5Bdirection%5D=desc`);
  return data.records.map((record) => ({
    id: record.id,
    requestId: record.fields["Request ID"],
    itemId: record.fields["Requested Item"]?.[0] || "",
    quantity: record.fields["Quantity Needed"] ?? null,
    urgency: record.fields["Urgency Level"] || "",
    storageLocation: record.fields["Storage Location"] || "",
    inventoryArea: record.fields["Inventory Area"] || "",
    inventorySubgroup: record.fields["Inventory Subgroup"] || "",
    shelfCode: record.fields["Shelf Code"] || "",
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
    received: Boolean(record.fields.Received),
    receivedAt: record.fields["Received Date/Time"] || "",
    receivedBy: record.fields["Received By"] || "",
    notes: record.fields.Notes || "",
    requestedAt: record.fields["Request Date/Time"] || ""
  }));
}

async function cached(key, ttlMs, loader) {
  const entry = cache[key];
  const now = Date.now();

  if (entry.value && entry.expiresAt > now) {
    metrics.cacheHits[key] += 1;
    return entry.value;
  }

  if (!entry.pending) {
    entry.pending = loader()
      .then((value) => {
        entry.value = value;
        entry.expiresAt = Date.now() + ttlMs;
        return value;
      })
      .finally(() => {
        entry.pending = null;
      });
  }

  return entry.pending;
}

async function getItems() {
  return cached("items", itemCacheMs, listItems);
}

async function getSuppliers() {
  return cached("suppliers", itemCacheMs, listSuppliers);
}

async function getRequests() {
  return cached("requests", requestCacheMs, listRequests);
}

async function listSchema() {
  const data = await airtable("tables", { meta: true });
  const requests = data.tables.find((table) => table.id === requestsTableId);
  const requestFields = new Set((requests?.fields || []).map((field) => field.name));
  const tableByName = new Map(data.tables.map((table) => [table.name, table.id]));
  const lookupTables = Object.fromEntries(
    Object.entries(lookupConfigs).map(([key, config]) => [key, tableByName.get(config.tableName) || ""])
  );

  return {
    tables: {
      driverSheetLines: tableByName.get("Driver Sheet Lines") || "",
      stockCounts: tableByName.get("Stock Counts") || "",
      invoiceCaptures: tableByName.get("Invoice Captures") || "",
      invoiceLines: tableByName.get("Invoice Lines") || "",
      ...lookupTables
    },
    requests: {
      hasStorageLocation: requestFields.has("Storage Location"),
      hasInventoryArea: requestFields.has("Inventory Area")
    }
  };
}

async function getSchema() {
  return cached("schema", 10 * 60 * 1000, listSchema);
}

async function listLookupRecords() {
  const schema = await getSchema();
  const result = {};

  for (const [key, config] of Object.entries(lookupConfigs)) {
    const tableId = schema.tables[key];
    const records = tableId ? (await airtable(`${tableId}?pageSize=100`)).records : [];
    const values = records
      .map((record) => ({
        id: record.id,
        name: String(record.fields[config.primaryField] || "").trim()
      }))
      .filter((record) => record.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    result[key] = {
      tableId,
      primaryField: config.primaryField,
      records: values,
      byId: new Map(values.map((record) => [record.id, record])),
      byName: new Map(values.map((record) => [record.name.toLowerCase(), record]))
    };
  }

  return result;
}

async function getLookups() {
  return cached("lookups", itemCacheMs, listLookupRecords);
}

async function findOrCreateLookupRecord(lookupKey, value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";

  let lookups = await getLookups();
  const lookup = lookups[lookupKey];
  if (!lookup?.tableId) return "";

  const existing = lookup.byName.get(cleaned.toLowerCase());
  if (existing) return existing.id;

  const record = await airtable(lookup.tableId, {
    method: "POST",
    body: JSON.stringify({ fields: { [lookup.primaryField]: cleaned } })
  });

  cache.lookups.expiresAt = 0;
  cache.schema.expiresAt = 0;
  return record.id;
}

function normalizeCreatedRequest(record) {
  return {
    id: record.id,
    requestId: record.fields["Request ID"],
    itemId: record.fields["Requested Item"]?.[0] || "",
    quantity: record.fields["Quantity Needed"] ?? null,
    urgency: record.fields["Urgency Level"] || "",
    storageLocation: record.fields["Storage Location"] || "",
    inventoryArea: record.fields["Inventory Area"] || "",
    inventorySubgroup: record.fields["Inventory Subgroup"] || "",
    shelfCode: record.fields["Shelf Code"] || "",
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
    received: Boolean(record.fields.Received),
    receivedAt: record.fields["Received Date/Time"] || "",
    receivedBy: record.fields["Received By"] || "",
    notes: record.fields.Notes || "",
    requestedAt: record.fields["Request Date/Time"] || ""
  };
}

function normalizeRequest(record) {
  return {
    id: record.id,
    requestId: record.fields["Request ID"],
    itemId: record.fields["Requested Item"]?.[0] || "",
    quantity: record.fields["Quantity Needed"] ?? null,
    urgency: record.fields["Urgency Level"] || "",
    storageLocation: record.fields["Storage Location"] || "",
    inventoryArea: record.fields["Inventory Area"] || "",
    inventorySubgroup: record.fields["Inventory Subgroup"] || "",
    shelfCode: record.fields["Shelf Code"] || "",
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
    received: Boolean(record.fields.Received),
    receivedAt: record.fields["Received Date/Time"] || "",
    receivedBy: record.fields["Received By"] || "",
    notes: record.fields.Notes || "",
    requestedAt: record.fields["Request Date/Time"] || ""
  };
}

async function listDriverSheet(date) {
  const schema = await getSchema();
  const driverLinesTableId = schema.tables.driverSheetLines;
  const items = await getItems();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  const formula = "AND(OR({Status}='Pending', {Status}='Approved'), NOT({Received}))";
  const query = new URLSearchParams({
    pageSize: "100",
    filterByFormula: formula,
    "sort[0][field]": "Inventory Area",
    "sort[0][direction]": "asc",
    "sort[1][field]": "Storage Location",
    "sort[1][direction]": "asc",
    "sort[2][field]": "Request ID",
    "sort[2][direction]": "asc"
  });
  const data = await airtable(`${requestsTableId}?${query}`);
  const requests = data.records.map((record) => {
    const request = normalizeRequest(record);
    const item = itemById.get(request.itemId);
    return {
      ...request,
      itemName: item?.name || "Requested item",
      unit: item?.unit || "",
      supplierName: item?.supplierName || "Unassigned Supplier",
      supplierContact: item?.supplierContact || "",
      storageLocation: request.storageLocation || item?.storageLocation || "",
      inventoryArea: request.inventoryArea || item?.inventoryArea || "",
      inventorySubgroup: request.inventorySubgroup || item?.inventorySubgroup || "",
      shelfCode: request.shelfCode || item?.shelfCode || ""
    };
  });

  if (driverLinesTableId) {
    await persistDriverSheetLines(driverLinesTableId, selectedDate, requests);
  }

  return { date: selectedDate, requests };
}

async function persistDriverSheetLines(tableId, sheetDate, requests) {
  const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
  const existingQuery = new URLSearchParams({ pageSize: "100", filterByFormula: formula });
  const existing = await airtable(`${tableId}?${existingQuery}`);
  const existingKeys = new Set(
    existing.records.map((record) => `${record.fields["Item Request Record ID"] || ""}|${record.fields["Sheet Date"] || ""}`)
  );

  for (const request of requests) {
    const key = `${request.id}|${sheetDate}`;
    if (existingKeys.has(key)) continue;

    await airtable(tableId, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Sheet Line": `${sheetDate} - ${request.requestId || request.id}`,
          "Sheet Date": sheetDate,
          "Item Request Record ID": request.id,
          "Request ID": request.requestId || 0,
          "Inventory Item Record ID": request.itemId,
          "Item Name": request.itemName,
          "Supplier Name": request.supplierName,
          "Supplier Contact": request.supplierContact,
          Quantity: request.quantity || 0,
          Unit: request.unit,
          "Inventory Area": request.inventoryArea || undefined,
          "Storage Location": request.storageLocation || undefined,
          "Inventory Subgroup": request.inventorySubgroup || "",
          "Shelf Code": request.shelfCode || "",
          "Request Status": request.status,
          Received: Boolean(request.received),
          Notes: request.notes || ""
        }
      })
    });
  }
}

async function createRequest(payload) {
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");
  const storageLocation = String(payload.storageLocation || "");
  const inventoryArea = String(payload.inventoryArea || "");
  const inventorySubgroup = String(payload.inventorySubgroup || "");
  const shelfCode = String(payload.shelfCode || "");

  if (!itemId) throw new Error("Choose an item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");

  const schema = await getSchema();
  const fields = {
    "Requested Item": [itemId],
    "Quantity Needed": quantity,
    "Urgency Level": urgency,
    "Requested By": requestedBy,
    "Request Date/Time": new Date().toISOString(),
    Status: "Pending",
    Notes: notes
  };

  if (schema.requests.hasStorageLocation && storageLocation) {
    fields["Storage Location"] = storageLocation;
  }

  if (schema.requests.hasInventoryArea && inventoryArea) {
    fields["Inventory Area"] = inventoryArea;
  }

  if (inventorySubgroup) {
    fields["Inventory Subgroup"] = inventorySubgroup;
  }

  if (shelfCode) {
    fields["Shelf Code"] = shelfCode;
  }

  const record = await airtable(requestsTableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });

  cache.requests.expiresAt = 0;
  return normalizeCreatedRequest(record);
}

async function updateItemSettings(recordId, payload) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid item record.");
  }

  const minimum = Number(payload.minimumThreshold);
  const unit = String(payload.unit || "").trim().toLowerCase();
  const inventorySubgroup = String(payload.inventorySubgroup || "").trim();
  const shelfCode = String(payload.shelfCode || "").trim();

  if (!Number.isFinite(minimum) || minimum < 0) {
    throw new Error("Minimum stock must be zero or greater.");
  }

  if (!allowedUnits.has(unit)) {
    throw new Error("Unit must be box, bag, item, or bottle.");
  }

  const unitRecordId = await findOrCreateLookupRecord("unitOfMeasurement", unit);
  const subgroupRecordId = await findOrCreateLookupRecord("inventorySubgroups", inventorySubgroup);
  const shelfRecordId = await findOrCreateLookupRecord("shelfCodes", shelfCode);
  const fields = {
    "Minimum Threshold": minimum,
    "Unit of Measure": unit,
    "Inventory Subgroup": inventorySubgroup,
    "Shelf Code": shelfCode
  };

  if (unitRecordId) fields["Unit Of Measurement Link"] = [unitRecordId];
  fields["Inventory Subgroup Link"] = subgroupRecordId ? [subgroupRecordId] : [];
  fields["Shelf Code Link"] = shelfRecordId ? [shelfRecordId] : [];

  const record = await airtable(`${inventoryTableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });

  cache.items.expiresAt = 0;
  const suppliers = await getSuppliers();
  const lookups = await getLookups();
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  return normalizeItem(record, supplierById, lookups);
}

async function createStockCount(payload, userName) {
  const schema = await getSchema();
  const tableId = schema.tables.stockCounts;
  if (!tableId) throw new Error("Stock Counts table was not found.");

  const itemId = String(payload.itemId || "");
  const countedQuantity = Number(payload.countedQuantity);
  const notes = String(payload.notes || "");

  if (!/^rec[a-zA-Z0-9]+$/.test(itemId)) throw new Error("Choose an item.");
  if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
    throw new Error("Counted quantity must be zero or greater.");
  }

  const items = await getItems();
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("Item not found.");

  const countedAt = new Date().toISOString();
  const countRecord = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Count Line": `${item.name} - ${countedAt.slice(0, 10)}`,
        "Count Date/Time": countedAt,
        "Inventory Item Record ID": item.id,
        "Item Name": item.name,
        "Counted Quantity": countedQuantity,
        "Previous Quantity": item.quantity || 0,
        Unit: item.unit || "",
        "Inventory Area": item.inventoryArea || undefined,
        "Storage Location": item.storageLocation || undefined,
        "Inventory Subgroup": item.inventorySubgroup || "",
        "Shelf Code": item.shelfCode || "",
        "Counted By": userName,
        Notes: notes
      }
    })
  });

  const updatedItem = await airtable(`${inventoryTableId}/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        "Current Quantity": countedQuantity,
        "Last Updated Date": countedAt
      }
    })
  });

  cache.items.expiresAt = 0;

  return {
    count: { id: countRecord.id, fields: countRecord.fields },
    item: {
      id: updatedItem.id,
      name: updatedItem.fields["Item Name"] || "",
      quantity: updatedItem.fields["Current Quantity"] ?? null,
      unit: updatedItem.fields["Unit of Measure"] || ""
    }
  };
}

async function createInvoiceCapture(payload, userName) {
  const schema = await getSchema();
  const tableId = schema.tables.invoiceCaptures;
  if (!tableId) throw new Error("Invoice Captures table was not found.");

  const supplierName = String(payload.supplierName || "");
  const invoiceNumber = String(payload.invoiceNumber || "");
  const invoiceTotal = payload.invoiceTotal === "" ? null : Number(payload.invoiceTotal);
  const photoUrl = String(payload.photoUrl || "");
  const extractedText = String(payload.extractedText || "");
  const notes = String(payload.notes || "");

  if (invoiceTotal !== null && !Number.isFinite(invoiceTotal)) {
    throw new Error("Invoice total must be a number.");
  }

  const capturedAt = new Date().toISOString();
  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Invoice Capture": `${supplierName || "Invoice"} - ${capturedAt.slice(0, 10)}`,
        "Capture Date/Time": capturedAt,
        "Supplier Name": supplierName,
        "Invoice Number": invoiceNumber,
        ...(invoiceTotal === null ? {} : { "Invoice Total": invoiceTotal }),
        "Photo URL": photoUrl,
        "Extracted Text": extractedText,
        "Entered By": userName,
        Status: "Captured",
        Notes: notes
      }
    })
  });

  return { id: record.id, fields: record.fields };
}

async function createInvoiceLine(payload, userName) {
  const schema = await getSchema();
  const tableId = schema.tables.invoiceLines;
  if (!tableId) throw new Error("Invoice Lines table was not found.");

  const itemName = String(payload.itemName || "");
  const invoiceNumber = String(payload.invoiceNumber || "");
  const supplierName = String(payload.supplierName || "");
  const quantity = Number(payload.quantityReceived || 0);
  const unitPrice = payload.unitPrice === "" || payload.unitPrice === null ? null : Number(payload.unitPrice);
  const lineTotal = unitPrice === null ? null : quantity * unitPrice;
  const appliedAt = new Date().toISOString();

  if (!itemName) throw new Error("Invoice line needs an item name.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invoice line quantity must be greater than zero.");
  if (unitPrice !== null && !Number.isFinite(unitPrice)) throw new Error("Invoice line price must be a number.");

  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Invoice Line": `${invoiceNumber || "Invoice"} - ${itemName} - ${appliedAt.slice(0, 10)}`,
        "Invoice Capture Record ID": String(payload.invoiceCaptureId || ""),
        "Invoice Number": invoiceNumber,
        "Supplier Name": supplierName,
        "Inventory Item Record ID": String(payload.itemId || ""),
        "Item Name": itemName,
        "OCR Line Text": String(payload.ocrLineText || ""),
        "Quantity Received": quantity,
        Unit: String(payload.unit || ""),
        ...(unitPrice === null ? {} : { "Unit Price": unitPrice, "Line Total": lineTotal }),
        "Applied Date/Time": appliedAt,
        "Applied By": userName
      }
    })
  });

  return { id: record.id, fields: record.fields };
}

async function emailInvoicePicture(payload, userName) {
  requireSmtpConfig();

  const attachment = attachmentFromDataUrl(payload.dataUrl, payload.fileName);
  const supplier = String(payload.supplierName || "").trim();
  const invoiceNumber = String(payload.invoiceNumber || "").trim();
  const notes = String(payload.notes || "").trim();
  const subjectParts = ["Invoice"];
  if (supplier) subjectParts.push(supplier);
  if (invoiceNumber) subjectParts.push(`#${invoiceNumber}`);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const info = await transporter.sendMail({
    from: mailFrom,
    to: accountingInbox,
    subject: subjectParts.join(" - "),
    text: [
      "Invoice photo sent from Kitchen Stock.",
      "",
      `Sent by: ${userName}`,
      `Supplier: ${supplier || "(not entered)"}`,
      `Invoice number: ${invoiceNumber || "(not entered)"}`,
      notes ? `Notes: ${notes}` : ""
    ].filter(Boolean).join("\n"),
    attachments: [attachment]
  });

  return {
    to: accountingInbox,
    messageId: info.messageId || ""
  };
}

async function markRequestReceived(recordId, userName) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid request record.");
  }

  const record = await airtable(`${requestsTableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Received: true,
        "Received Date/Time": new Date().toISOString(),
        "Received By": userName,
        Status: "Fulfilled"
      }
    })
  });

  cache.requests.expiresAt = 0;
  return normalizeRequest(record);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicDir, rawPath));

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await readFile(filePath);
    send(res, 200, file, mimeTypes[extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/login") {
      const payload = await readJson(req);
      const name = String(payload.username || "").trim();
      const password = String(payload.password || "").trim();
      const user = users.get(name.toLowerCase());

      if (!user || user.password !== password) {
        send(res, 401, { error: "Invalid username or password." });
        return;
      }

      send(res, 200, { token: createSession(user.name), user: { name: user.name } });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/me")) {
      const user = requireUser(req, res);
      if (!user) return;
      send(res, 200, { user });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/items")) {
      if (!requireUser(req, res)) return;
      send(res, 200, { items: await getItems() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/requests")) {
      if (!requireUser(req, res)) return;
      send(res, 200, { requests: await getRequests() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      if (!requireUser(req, res)) return;
      const [items, requests] = await Promise.all([getItems(), getRequests()]);
      send(res, 200, { items, requests });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/driver-sheet")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listDriverSheet(url.searchParams.get("date")));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/health")) {
      send(res, 200, {
        ok: true,
        metrics,
        cache: {
          itemsCached: Boolean(cache.items.value),
          requestsCached: Boolean(cache.requests.value),
          suppliersCached: Boolean(cache.suppliers.value),
          lookupsCached: Boolean(cache.lookups.value),
          schemaCached: Boolean(cache.schema.value)
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/requests") {
      const user = requireUser(req, res);
      if (!user) return;
      const request = await createRequest(await readJson(req));
      send(res, 201, { request });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/items/")) {
      if (!requireUser(req, res)) return;
      const recordId = req.url.split("/")[3];
      const item = await updateItemSettings(recordId, await readJson(req));
      send(res, 200, { item });
      return;
    }

    if (req.method === "POST" && req.url === "/api/stock-counts") {
      const user = requireUser(req, res);
      if (!user) return;
      const result = await createStockCount(await readJson(req), user.name);
      send(res, 201, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/invoice-captures") {
      const user = requireUser(req, res);
      if (!user) return;
      const invoice = await createInvoiceCapture(await readJson(req), user.name);
      send(res, 201, { invoice });
      return;
    }

    if (req.method === "POST" && req.url === "/api/invoice-lines") {
      const user = requireUser(req, res);
      if (!user) return;
      const invoiceLine = await createInvoiceLine(await readJson(req), user.name);
      send(res, 201, { invoiceLine });
      return;
    }

    if (req.method === "POST" && req.url === "/api/email-invoice") {
      const user = requireUser(req, res);
      if (!user) return;
      const result = await emailInvoicePicture(await readJson(req), user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ocr-invoice") {
      if (!requireUser(req, res)) return;
      const result = await ocrSpaceParseImage(await readJson(req));
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/receive")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const request = await markRequestReceived(recordId, user.name);
      send(res, 200, { request });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    send(res, 400, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Kitchen inventory web app running at http://localhost:${port}`);
});
