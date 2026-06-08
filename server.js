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
const invoiceOcrRulesTableId = process.env.INVOICE_OCR_RULES_TABLE_ID || "tblW611UMHnm9LUeb";
const appUsersTableIdFromEnv = process.env.APP_USERS_TABLE_ID || "";
const token = process.env.AIRTABLE_TOKEN;
const port = Number(process.env.PORT || 3000);
const itemCacheMs = Number(process.env.ITEM_CACHE_MS || 10 * 60 * 1000);
const requestCacheMs = Number(process.env.REQUEST_CACHE_MS || 20 * 1000);
const authSecret = process.env.AUTH_SECRET || "change-this-secret-in-render";
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const userConfig = process.env.APP_USERS || "";
const allowedUnits = new Set(["box", "bag", "item", "bottle"]);
const editableUserSources = new Set(["airtable"]);
const accountingInbox = process.env.ACCOUNTING_INBOX || "bills.madameja.23d9599b@billfiles.com";
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const mailFrom = process.env.MAIL_FROM || smtpUser;
const brevoApiKey = process.env.BREVO_API_KEY || "";
const ocrSpaceApiKey = process.env.OCR_SPACE_API_KEY || "helloworld";
const isRender = Boolean(process.env.RENDER);

const cache = {
  items: { expiresAt: 0, value: null, pending: null },
  requests: { expiresAt: 0, value: null, pending: null },
  suppliers: { expiresAt: 0, value: null, pending: null },
  appUsers: { expiresAt: 0, value: null, pending: null },
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
        const [name, password, roleValue] = entry.split(":");
        const role = normalizeRole(roleValue || (String(name || "").trim().toLowerCase() === "enno" ? "god" : "user"));
        return [String(name || "").trim().toLowerCase(), {
          name: String(name || "").trim(),
          password: String(password || "").trim(),
          role,
          active: true,
          mustChangePassword: false,
          source: "env"
        }];
      })
      .filter(([name, user]) => name && user.password)
  );
}

const users = parseUsers();

function normalizeRole(role) {
  const cleaned = String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (cleaned === "god") return "god";
  if (cleaned === "admin") return "admin";
  if (cleaned === "power-user" || cleaned === "poweruser" || cleaned === "power") return "power-user";
  return "user";
}

function userPermissions(role) {
  const normalized = normalizeRole(role);
  const isGod = normalized === "god";
  const isAdmin = normalized === "admin" || isGod;
  const isPower = normalized === "power-user";
  return {
    canAdminUsers: isAdmin,
    canManageAdminRoles: isGod,
    canDeleteAdmins: isGod,
    canAddInventoryItems: isAdmin || isPower,
    canDeleteAnyOrder: isAdmin || isPower,
    canUseInvoices: isAdmin || isPower,
    canSendInvoiceToAccounting: isAdmin
  };
}

function publicUser(user) {
  const role = normalizeRole(user?.role);
  return {
    name: user?.name || "",
    role,
    theme: user?.theme === "light" ? "light" : "dark",
    active: user?.active !== false,
    mustChangePassword: Boolean(user?.mustChangePassword),
    source: user?.source || "airtable",
    permissions: userPermissions(role)
  };
}

function publicUserForAdmin(user, actor = null) {
  const editable = editableUserSources.has(user.source);
  const canEditRole = actor ? canChangeAppUser(actor, user, user.role) : true;
  return {
    ...publicUser(user),
    id: user.id || "",
    editable,
    canEditRole,
    canSave: editable && (canEditRole || normalizeRole(user.role) === "user" || normalizeRole(user.role) === "power-user"),
    canDelete: actor ? canDeleteAppUser(actor, user) && String(actor.name || "").toLowerCase() !== String(user.name || "").toLowerCase() : false
  };
}

function storeSession(user) {
  return { token: createSession(user), user: publicUser(user) };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", authSecret).update(value).digest("base64url");
}

function createSession(user) {
  const safeUser = publicUser(user);
  const payload = JSON.stringify({
    user: safeUser.name,
    role: safeUser.role,
    mustChangePassword: Boolean(safeUser.mustChangePassword),
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
    return publicUser({ name: payload.user, role: payload.role || "user", active: true, mustChangePassword: Boolean(payload.mustChangePassword) });
  } catch {
    return null;
  }
}

function bearerUser(req) {
  const header = req.headers.authorization || "";
  const tokenValue = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifySession(tokenValue);
}

function requireUser(req, res, options = {}) {
  const user = bearerUser(req);
  if (!user) {
    send(res, 401, { error: "Login required." });
    return null;
  }
  if (user.mustChangePassword && !options.allowPasswordChange) {
    send(res, 403, { error: "Password change required.", code: "PASSWORD_CHANGE_REQUIRED" });
    return null;
  }
  return user;
}

function requireRole(user, res, predicate, message) {
  if (predicate(user)) return true;
  send(res, 403, { error: message || "You do not have permission for this action." });
  return false;
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

function requireEmailConfig() {
  if (brevoApiKey) {
    if (!mailFrom) throw new Error("Email is not configured yet. Add MAIL_FROM in Render.");
    return;
  }

  if (isRender) {
    throw new Error("Email is not configured for Render. Add BREVO_API_KEY and MAIL_FROM in Render environment variables. SMTP ports time out on Render.");
  }

  const missing = [];
  if (!smtpHost) missing.push("SMTP_HOST");
  if (!smtpUser) missing.push("SMTP_USER");
  if (!smtpPass) missing.push("SMTP_PASS");
  if (!mailFrom) missing.push("MAIL_FROM");
  if (missing.length) {
    throw new Error(`Email is not configured yet. Add BREVO_API_KEY and MAIL_FROM, or add SMTP settings: ${missing.join(", ")}.`);
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
  if (!match) throw new Error("OCR file data was not valid.");

  const mimeType = match[1].toLowerCase();
  const fileBytes = Buffer.from(match[2], "base64");
  if (!fileBytes.length) throw new Error("OCR file was empty.");
  if (fileBytes.length > 1024 * 1024) {
    throw new Error("OCR.space free API accepts files up to 1 MB. Use a smaller PDF/photo or split the invoice.");
  }

  const form = new FormData();
  form.set("base64Image", dataUrl);
  form.set("language", "eng");
  form.set("isOverlayRequired", "false");
  form.set("detectOrientation", "true");
  form.set("scale", "true");
  form.set("isTable", "true");
  form.set("OCREngine", String(payload.engine || "2"));
  if (mimeType === "application/pdf") {
    form.set("filetype", "PDF");
  }

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

async function listAirtableRecords(tableId, params = {}) {
  const records = [];
  let offset = "";

  do {
    const query = new URLSearchParams({
      pageSize: "100",
      ...params
    });

    if (offset) {
      query.set("offset", offset);
    }

    const data = await airtable(`${tableId}?${query}`);
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

async function listItems() {
  const suppliers = await getSuppliers();
  const lookups = await getLookups();
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const records = await listAirtableRecords(inventoryTableId);
  return records
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
    categoryId: record.fields["Category Link"]?.[0] || "",
    storageLocation: linkedValue(record, "Storage Location Link", "Storage Location", lookups.storageLocations),
    storageLocationId: record.fields["Storage Location Link"]?.[0] || "",
    inventoryArea: linkedValue(record, "Inventory Area Link", "Inventory Area", lookups.inventoryAreas),
    inventoryAreaId: record.fields["Inventory Area Link"]?.[0] || "",
    inventorySubgroup: linkedValue(record, "Inventory Subgroup Link", "Inventory Subgroup", lookups.inventorySubgroups),
    inventorySubgroupId: record.fields["Inventory Subgroup Link"]?.[0] || "",
    shelfCode: linkedValue(record, "Shelf Code Link", "Shelf Code", lookups.shelfCodes),
    shelfCodeId: record.fields["Shelf Code Link"]?.[0] || "",
    supplierId,
    supplierName: supplier?.name || "Unassigned Supplier",
    supplierContact: supplier?.contact || "",
    quantity: record.fields["Current Quantity"] ?? null,
    unit: linkedValue(record, "Unit Of Measurement Link", "Unit of Measure", lookups.unitOfMeasurement),
    minimum: record.fields["Minimum Threshold"] ?? null
  };
}

async function listSuppliers() {
  const records = await listAirtableRecords(suppliersTableId);
  return records
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

async function listOpenRequests() {
  const records = await listAirtableRecords(requestsTableId, {
    filterByFormula: "AND(OR({Status}='Pending', {Status}='Approved'), NOT({Received}))",
    "sort[0][field]": "Inventory Subgroup",
    "sort[0][direction]": "asc",
    "sort[1][field]": "Requested By",
    "sort[1][direction]": "asc",
    "sort[2][field]": "Request ID",
    "sort[2][direction]": "desc"
  });
  return records.map(normalizeRequest);
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

function normalizeAppUser(record) {
  const fields = record.fields || {};
  const name = String(fields.Name || fields.Username || "").trim();
  return {
    id: record.id,
    name,
    password: String(fields.Password || "").trim(),
    role: name.toLowerCase() === "enno" ? "god" : normalizeRole(fields.Role || "user"),
    theme: String(fields.Theme || "dark").trim().toLowerCase() === "light" ? "light" : "dark",
    active: fields.Active !== false,
    mustChangePassword: Boolean(fields["Force Password Change"]),
    source: "airtable"
  };
}

function envUsersList() {
  return [...users.values()].map((user) => ({
    id: `env-${user.name.toLowerCase()}`,
    name: user.name,
    password: user.password,
    role: normalizeRole(user.role),
    theme: user.theme === "light" ? "light" : "dark",
    active: user.active !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    source: "env"
  }));
}

async function getAppUsersTableId() {
  if (appUsersTableIdFromEnv) return appUsersTableIdFromEnv;
  const schema = await getSchema();
  return schema.tables.appUsers || "";
}

async function listAppUsers() {
  const tableId = await getAppUsersTableId();
  if (!tableId) return envUsersList();

  const records = await listAirtableRecords(tableId, {
    pageSize: "100",
    "sort[0][field]": "Name",
    "sort[0][direction]": "asc"
  });

  const tableUsers = records.map(normalizeAppUser).filter((user) => user.name && user.password);
  const tableUserNames = new Set(tableUsers.map((user) => user.name.toLowerCase()));
  for (const envUser of users.values()) {
    if (!tableUserNames.has(envUser.name.toLowerCase())) {
      try {
        const schema = await getSchema();
        const fields = appUserFields({
          name: envUser.name,
          password: envUser.password,
          role: envUser.role,
          theme: envUser.theme || "dark",
          active: true,
          mustChangePassword: false
        }, schema);
        const record = await airtable(tableId, {
          method: "POST",
          body: JSON.stringify({ fields, typecast: true })
        });
        const createdUser = normalizeAppUser(record);
        tableUsers.push(createdUser);
        tableUserNames.add(createdUser.name.toLowerCase());
      } catch {
        tableUsers.push({ ...envUser, id: `env-${envUser.name.toLowerCase()}`, source: "env" });
      }
    }
  }
  return tableUsers.sort((a, b) => a.name.localeCompare(b.name));
}

async function getAppUsers() {
  return cached("appUsers", 30 * 1000, listAppUsers);
}

async function findAppUserByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const appUsers = await getAppUsers();
  return appUsers.find((user) => user.name.toLowerCase() === normalized && user.active !== false);
}

async function refreshUserFromDirectory(user) {
  const freshUser = await findAppUserByName(user?.name);
  if (!freshUser) return user;
  return freshUser;
}

function appUserFields(payload, schema = null) {
  const name = String(payload.name || "").trim();
  const password = String(payload.password || "").trim();
  const role = normalizeRole(payload.role);
  const theme = String(payload.theme || "dark").trim().toLowerCase() === "light" ? "Light" : "Dark";
  const active = payload.active !== false;
  const mustChangePassword = Boolean(payload.mustChangePassword);

  if (!name) throw new Error("User name is required.");
  if (!password) throw new Error("Password is required.");
  const fields = {
    Name: name,
    Password: password,
    Role: role === "god" ? "God" : role === "power-user" ? "Power User" : role === "admin" ? "Admin" : "User"
  };
  if (!schema || schema.appUsers.hasTheme) fields.Theme = theme;
  if (!schema || schema.appUsers.hasActive) fields.Active = active;
  if (!schema || schema.appUsers.hasForcePasswordChange) fields["Force Password Change"] = mustChangePassword;
  return fields;
}

function appUserUpdateFields(payload, currentUser, schema = null) {
  const name = String(payload.name || currentUser?.name || "").trim();
  const role = normalizeRole(payload.role || currentUser?.role || "user");
  const theme = String(payload.theme || currentUser?.theme || "dark").trim().toLowerCase() === "light" ? "Light" : "Dark";
  const active = payload.active !== false;
  const mustChangePassword = Boolean(payload.mustChangePassword);
  const password = String(payload.password || "").trim();

  if (!name) throw new Error("User name is required.");
  const fields = {
    Name: name,
    Role: role === "god" ? "God" : role === "power-user" ? "Power User" : role === "admin" ? "Admin" : "User"
  };
  if (password) fields.Password = password;
  if (!schema || schema.appUsers.hasTheme) fields.Theme = theme;
  if (!schema || schema.appUsers.hasActive) fields.Active = active;
  if (!schema || schema.appUsers.hasForcePasswordChange) fields["Force Password Change"] = mustChangePassword;
  return fields;
}

function canChangeAppUser(actor, target, nextRole) {
  const actorRole = normalizeRole(actor?.role);
  const targetRole = normalizeRole(target?.role);
  const wantedRole = normalizeRole(nextRole);
  const actorIsGod = actorRole === "god";
  const actorIsAdmin = actorRole === "admin";
  if (actorIsGod) return true;
  if (!actorIsAdmin) return false;
  if (targetRole === "admin" || targetRole === "god") return false;
  if (wantedRole === "admin" || wantedRole === "god") return false;
  return true;
}

function canDeleteAppUser(actor, target) {
  const actorRole = normalizeRole(actor?.role);
  const targetRole = normalizeRole(target?.role);
  if (actorRole === "god") return true;
  if (actorRole !== "admin") return false;
  return targetRole === "power-user" || targetRole === "user";
}

async function findAppUserById(recordId) {
  const appUsers = await getAppUsers();
  return appUsers.find((user) => user.id === recordId);
}

async function createAppUser(payload) {
  const tableId = await getAppUsersTableId();
  if (!tableId) throw new Error("App Users table is not configured yet. Create an Airtable table named App Users with fields Name, Password, Role, Active.");

  const schema = await getSchema();
  const fields = appUserFields(payload, schema);
  const existing = await findAppUserByName(fields.Name);
  if (existing && !String(existing.id).startsWith("env-")) throw new Error("That user already exists.");

  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true })
  });
  cache.appUsers.expiresAt = 0;
  return normalizeAppUser(record);
}

async function changeOwnPassword(userName, currentPassword, newPassword, options = {}) {
  const appUser = await findAppUserByName(userName);
  if (!appUser) throw new Error("User was not found.");
  if (!editableUserSources.has(appUser.source)) {
    throw new Error("This user is configured in Render. Move users to the App Users Airtable table before changing passwords online.");
  }
  if (!options.forceChange && appUser.password !== String(currentPassword || "")) throw new Error("Current password is not correct.");
  if (String(newPassword || "").trim().length < 2) throw new Error("New password is too short.");

  const tableId = await getAppUsersTableId();
  const record = await airtable(`${tableId}/${appUser.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Password: String(newPassword).trim(),
        "Force Password Change": false
      }
    })
  });
  cache.appUsers.expiresAt = 0;
  return normalizeAppUser(record);
}

async function itemFormOptions() {
  const [suppliers, lookups, shelfCodes] = await Promise.all([getSuppliers(), getLookups(), listShelfCodesAdmin()]);
  return {
    suppliers,
    categories: lookups.categories.records,
    storageLocations: lookups.storageLocations.records,
    inventoryAreas: lookups.inventoryAreas.records,
    inventorySubgroups: lookups.inventorySubgroups.records,
    shelfCodes: shelfCodes.map((shelf) => ({
      id: shelf.id,
      name: shelf.name,
      storageLocation: shelf.storageLocation || "",
      displayName: [shelf.storageLocation, shelf.name].filter(Boolean).join(" / ") || shelf.name
    })),
    units: lookups.unitOfMeasurement.records.length
      ? lookups.unitOfMeasurement.records
      : [...allowedUnits].map((name) => ({ id: name, name }))
  };
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeStandingOrder(record) {
  const fields = record.fields || {};
  let items = [];
  try {
    const parsed = fields["Items JSON"] ? JSON.parse(fields["Items JSON"]) : [];
    if (Array.isArray(parsed)) {
      items = parsed
        .map((item) => ({
          itemId: String(item.itemId || "").trim(),
          itemName: String(item.itemName || "").trim(),
          quantity: Number(item.quantity || item.quantityNeeded || 0)
        }))
        .filter((item) => item.itemId && Number.isFinite(item.quantity) && item.quantity > 0);
    }
  } catch {
    items = [];
  }

  if (!items.length && (fields["Inventory Item"]?.[0] || fields["Inventory Item Record ID"])) {
    items = [{
      itemId: fields["Inventory Item"]?.[0] || fields["Inventory Item Record ID"] || "",
      itemName: fields["Item Name"] || "",
      quantity: Number(fields.Quantity ?? 1)
    }];
  }

  const firstItem = items[0] || {};
  return {
    id: record.id,
    name: fields["Standing Order"] || fields.Name || "",
    itemId: firstItem.itemId || "",
    itemName: firstItem.itemName || "",
    items,
    supplierName: fields["Supplier Name"] || "",
    quantity: firstItem.quantity ?? fields.Quantity ?? 1,
    expectedDate: fields["Expected Arrival Date"] || "",
    schedule: fields.Schedule || "Weekly",
    otherSchedule: fields["Other Schedule"] || "",
    active: fields.Active !== false,
    lastGeneratedDate: fields["Last Generated Date"] || "",
    notes: fields.Notes || ""
  };
}

async function getStandingOrdersTableId() {
  const schema = await getSchema();
  return schema.tables.standingOrders || "";
}

async function listStandingOrders() {
  const tableId = await getStandingOrdersTableId();
  if (!tableId) return [];
  const records = await listAirtableRecords(tableId, {
    "sort[0][field]": "Expected Arrival Date",
    "sort[0][direction]": "asc"
  });
  return records.map(normalizeStandingOrder);
}

function nextStandingOrderDate(order, generatedDate) {
  if (order.schedule === "Daily") return addDays(generatedDate, 1);
  if (order.schedule === "Weekly") return addDays(generatedDate, 7);
  return "";
}

function normalizeDailyGuestCount(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    date: fields.Date || fields["Guest Date"] || "",
    guests: fields["Guest Count"] ?? fields.Guests ?? null,
    notes: fields.Notes || "",
    enteredBy: fields["Entered By"] || "",
    enteredAt: fields["Entered At"] || ""
  };
}

async function getDailyGuestCountsTableId() {
  const schema = await getSchema();
  return schema.tables.dailyGuestCounts || "";
}

async function getDailyGuestCount(date) {
  const tableId = await getDailyGuestCountsTableId();
  if (!tableId) return null;
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  const records = await listAirtableRecords(tableId, {
    filterByFormula: `IS_SAME({Date}, '${selectedDate}', 'day')`,
    pageSize: "1"
  });
  return records[0] ? normalizeDailyGuestCount(records[0]) : null;
}

async function saveDailyGuestCount(payload, user) {
  if (!user.permissions?.canAdminUsers) throw new Error("Only admins can enter daily guest counts.");
  const tableId = await getDailyGuestCountsTableId();
  if (!tableId) throw new Error("Daily Guest Counts table is not configured. Add an Airtable table named Daily Guest Counts.");

  const selectedDate = String(payload.date || "").trim();
  const guests = Number(payload.guests);
  const notes = String(payload.notes || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) throw new Error("Choose a valid date.");
  if (!Number.isFinite(guests) || guests < 0) throw new Error("Guest count must be zero or greater.");

  const existing = await getDailyGuestCount(selectedDate);
  const fields = {
    Date: selectedDate,
    "Guest Count": guests,
    Notes: notes,
    "Entered By": user.name,
    "Entered At": new Date().toISOString()
  };

  const record = existing
    ? await airtable(`${tableId}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });

  return normalizeDailyGuestCount(record);
}

function isStandingOrderDue(order, selectedDate) {
  if (!order.active || !order.expectedDate) return false;
  if (order.lastGeneratedDate === selectedDate) return false;
  return order.expectedDate <= selectedDate;
}

function standingSupplierFromNotes(notes) {
  const match = String(notes || "").match(/^Standing supplier:\s*(.+?)\.?$/im);
  return match ? match[1].trim().replace(/\.$/, "") : "";
}

function standingRunIdFromNotes(notes) {
  const match = String(notes || "").match(/^Standing run id:\s*(rec[a-zA-Z0-9]+)\.?$/im);
  return match ? match[1].trim() : "";
}

function standingRunLineIdFromNotes(notes) {
  const match = String(notes || "").match(/^Standing run line id:\s*(rec[a-zA-Z0-9]+)\.?$/im);
  return match ? match[1].trim() : "";
}

function normalizeStandingOrderRun(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    name: fields["Run Name"] || "",
    standingOrderId: fields["Standing Order Record ID"] || "",
    standingOrderName: fields["Standing Order Name"] || "",
    supplierName: fields["Supplier Name"] || "",
    expectedDate: fields["Expected Delivery Date"] || "",
    schedule: fields.Schedule || "",
    status: fields.Status || "",
    generatedAt: fields["Generated At"] || "",
    generatedBy: fields["Generated By"] || "",
    closedAt: fields["Closed At"] || "",
    closedBy: fields["Closed By"] || "",
    notes: fields.Notes || ""
  };
}

function normalizeStandingOrderRunLine(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    runId: fields["Standing Order Run ID"] || "",
    standingOrderId: fields["Standing Order Record ID"] || "",
    requestRecordId: fields["Request Record ID"] || "",
    driverLineRecordId: fields["Driver Line Record ID"] || "",
    itemRecordId: fields["Inventory Item Record ID"] || "",
    itemName: fields["Item Name"] || "",
    quantity: fields.Quantity ?? null,
    unit: fields.Unit || "",
    supplierName: fields["Supplier Name"] || "",
    received: Boolean(fields.Received),
    receivedAt: fields["Received At"] || "",
    receivedBy: fields["Received By"] || "",
    status: fields.Status || "",
    notes: fields.Notes || ""
  };
}

async function getStandingOrderRunTables() {
  const schema = await getSchema();
  return {
    runsTableId: schema.tables.standingOrderRuns || "",
    linesTableId: schema.tables.standingOrderRunLines || ""
  };
}

async function findStandingOrderRun(orderId, expectedDate) {
  const { runsTableId } = await getStandingOrderRunTables();
  if (!runsTableId) return null;
  const records = await listAirtableRecords(runsTableId, {
    filterByFormula: `AND({Standing Order Record ID}='${airtableFormulaText(orderId)}', IS_SAME({Expected Delivery Date}, '${expectedDate}', 'day'))`,
    pageSize: "1"
  });
  return records[0] ? normalizeStandingOrderRun(records[0]) : null;
}

async function ensureStandingOrderRun(order, selectedDate, userName) {
  const { runsTableId } = await getStandingOrderRunTables();
  if (!runsTableId) return null;

  const existing = await findStandingOrderRun(order.id, selectedDate);
  if (existing) return { ...existing, existing: true };

  const generatedAt = new Date().toISOString();
  const record = await airtable(runsTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Run Name": `${order.name || order.supplierName || "Standing Order"} - ${selectedDate}`,
        "Standing Order Record ID": order.id,
        "Standing Order Name": order.name || "",
        "Supplier Name": order.supplierName || "",
        "Expected Delivery Date": selectedDate,
        Schedule: order.schedule || "",
        Status: "Open",
        "Generated At": generatedAt,
        "Generated By": userName,
        Notes: order.notes || ""
      }
    })
  });

  return { ...normalizeStandingOrderRun(record), existing: false };
}

async function createStandingOrderRunLine(run, order, item, quantity, request, notes = "") {
  const { linesTableId } = await getStandingOrderRunTables();
  if (!linesTableId || !run?.id) return null;

  const record = await airtable(linesTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Run Line": `${run.expectedDate || ""} - ${item.name || request.itemName || "Item"}`,
        "Standing Order Run ID": run.id,
        "Standing Order Record ID": order.id,
        "Request Record ID": request.id,
        "Inventory Item Record ID": item.id,
        "Item Name": item.name || "",
        Quantity: quantity,
        Unit: item.unit || "",
        "Supplier Name": run.supplierName || order.supplierName || "",
        Received: false,
        Status: "Open",
        Notes: notes
      }
    })
  });

  return normalizeStandingOrderRunLine(record);
}

async function hasStandingOrderRunLines(runId) {
  const { linesTableId } = await getStandingOrderRunTables();
  if (!linesTableId || !/^rec[a-zA-Z0-9]+$/.test(runId || "")) return false;
  const records = await listAirtableRecords(linesTableId, {
    filterByFormula: `{Standing Order Run ID}='${airtableFormulaText(runId)}'`,
    pageSize: "1"
  });
  return records.length > 0;
}

async function patchStandingOrderRunLine(recordId, fields) {
  const { linesTableId } = await getStandingOrderRunTables();
  if (!linesTableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) return null;
  const record = await airtable(`${linesTableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  return normalizeStandingOrderRunLine(record);
}

async function closeStandingOrderRunIfComplete(runId, userName) {
  const { runsTableId, linesTableId } = await getStandingOrderRunTables();
  if (!runsTableId || !linesTableId || !/^rec[a-zA-Z0-9]+$/.test(runId || "")) return null;

  const lines = await listAirtableRecords(linesTableId, {
    filterByFormula: `{Standing Order Run ID}='${airtableFormulaText(runId)}'`,
    pageSize: "100"
  });
  if (!lines.length) return null;

  const allReceived = lines.every((record) => Boolean(record.fields?.Received));
  if (!allReceived) return null;

  const closedAt = new Date().toISOString();
  const record = await airtable(`${runsTableId}/${runId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Status: "Closed",
        "Closed At": closedAt,
        "Closed By": userName
      }
    })
  });
  return normalizeStandingOrderRun(record);
}

async function listStandingOrderRuns(limit = 50) {
  const { runsTableId, linesTableId } = await getStandingOrderRunTables();
  if (!runsTableId) return [];

  const records = await listAirtableRecords(runsTableId, {
    pageSize: String(Math.min(Math.max(Number(limit) || 50, 1), 100)),
    "sort[0][field]": "Expected Delivery Date",
    "sort[0][direction]": "desc",
    "sort[1][field]": "Generated At",
    "sort[1][direction]": "desc"
  });
  const runs = records.map(normalizeStandingOrderRun);

  if (!linesTableId || !runs.length) {
    return runs.map((run) => ({ ...run, lines: [], totalLines: 0, receivedLines: 0, openLines: 0 }));
  }

  const linesByRunId = new Map(runs.map((run) => [run.id, []]));
  const runIds = runs.map((run) => run.id);
  for (let index = 0; index < runIds.length; index += 20) {
    const chunk = runIds.slice(index, index + 20);
    const formula = `OR(${chunk.map((id) => `{Standing Order Run ID}='${airtableFormulaText(id)}'`).join(",")})`;
    const lineRecords = await listAirtableRecords(linesTableId, { filterByFormula: formula, pageSize: "100" });
    for (const record of lineRecords) {
      const line = normalizeStandingOrderRunLine(record);
      if (!linesByRunId.has(line.runId)) linesByRunId.set(line.runId, []);
      linesByRunId.get(line.runId).push(line);
    }
  }

  return runs.map((run) => {
    const lines = (linesByRunId.get(run.id) || [])
      .sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || "")));
    return {
      ...run,
      lines,
      totalLines: lines.length,
      receivedLines: lines.filter((line) => line.received).length,
      openLines: lines.filter((line) => !line.received).length
    };
  });
}

async function updateStandingOrderRecord(recordId, payload) {
  const tableId = await getStandingOrdersTableId();
  if (!tableId) throw new Error("Standing Orders table is not configured.");
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid standing order record.");

  const fields = await standingOrderFields(payload);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  return normalizeStandingOrder(record);
}

async function standingOrderFields(payload) {
  const schema = await getSchema();
  const rawItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: payload.quantityNeeded || payload.quantity
    }];
  const supplierName = String(payload.supplierName || "").trim();
  const standingName = String(payload.name || payload.standingOrderName || "").trim();
  const expectedDate = String(payload.expectedDate || "").trim();
  const schedule = ["Daily", "Weekly", "Other", "One Time"].includes(payload.schedule) ? payload.schedule : "Weekly";
  const otherSchedule = String(payload.otherSchedule || payload.recurrence || "").trim();
  const active = payload.active !== false;
  const items = rawItems.map((item) => ({
    itemId: String(item.itemId || "").trim(),
    itemName: String(item.itemName || "").trim(),
    quantity: Number(item.quantityNeeded || item.quantity || 0)
  }));

  if (!items.length) throw new Error("Add at least one inventory item.");
  if (!supplierName) throw new Error("Choose one supplier for this standing order.");
  for (const item of items) {
    if (!/^rec[a-zA-Z0-9]+$/.test(item.itemId)) throw new Error("Choose valid inventory items.");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Each standing-order item needs a quantity greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw new Error("Choose the expected arrival date.");
  if (items.length > 1 && !schema.standingOrders.hasItemsJson) {
    throw new Error("Add a long text field named Items JSON to the Standing Orders table before saving multi-item standing orders.");
  }

  const firstItem = items[0];
  const name = standingName || `${supplierName || "Standing order"} - ${schedule} - ${expectedDate}`;

  const fields = {
    "Standing Order": name,
    "Supplier Name": supplierName,
    "Expected Arrival Date": expectedDate,
    Schedule: schedule,
    "Other Schedule": otherSchedule,
    Active: active,
    Notes: String(payload.notes || "")
  };

  if (schema.standingOrders.hasInventoryItem) fields["Inventory Item"] = [firstItem.itemId];
  if (schema.standingOrders.hasInventoryItemRecordId) fields["Inventory Item Record ID"] = firstItem.itemId;
  if (schema.standingOrders.hasItemName) fields["Item Name"] = firstItem.itemName;
  if (schema.standingOrders.hasQuantity) fields.Quantity = firstItem.quantity;
  if (schema.standingOrders.hasItemsJson) fields["Items JSON"] = JSON.stringify(items);

  return fields;
}

async function saveStandingOrderDefinition(payload, user) {
  if (!user.permissions?.canAddInventoryItems) throw new Error("Only admins and power users can save standing orders.");
  const tableId = await getStandingOrdersTableId();
  if (!tableId) throw new Error("Standing Orders table is not configured. Add an Airtable table named Standing Orders.");

  const inventoryItems = await getItems();
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const rawItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{ itemId: payload.itemId, quantity: payload.quantityNeeded || payload.quantity }];
  const standingItems = rawItems.map((line) => {
    const item = itemById.get(String(line.itemId || ""));
    if (!item) throw new Error("Inventory item was not found.");
    return {
      itemId: item.id,
      itemName: item.name,
      quantity: Number(line.quantityNeeded || line.quantity || 0)
    };
  });

  const fields = await standingOrderFields({
    ...payload,
    items: standingItems,
    supplierName: payload.supplierName || standingItems[0]?.supplierName || ""
  });

  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });
  return normalizeStandingOrder(record);
}

async function generateStandingOrdersForDate(selectedDate, userName = "System") {
  const tableId = await getStandingOrdersTableId();
  if (!tableId) return [];

  const orders = (await listStandingOrders()).filter((order) => isStandingOrderDue(order, selectedDate));
  const generated = [];
  const items = await getItems();
  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const order of orders) {
    const run = await ensureStandingOrderRun(order, selectedDate, userName);
    const alreadyGenerated = run?.existing && await hasStandingOrderRunLines(run.id);
    if (alreadyGenerated) {
      const nextDate = nextStandingOrderDate(order, selectedDate);
      await airtable(`${tableId}/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: {
            "Last Generated Date": selectedDate,
            "Expected Arrival Date": nextDate || selectedDate,
            Active: order.schedule === "One Time" ? false : order.active
          }
        })
      });
      continue;
    }
    for (const line of order.items || []) {
      const item = itemById.get(line.itemId);
      if (!item) continue;
      const notes = [
        `Standing order: ${order.schedule}.`,
        order.name ? `Standing order name: ${order.name}.` : "",
        order.supplierName ? `Standing supplier: ${order.supplierName}.` : "",
        run?.id ? `Standing run id: ${run.id}.` : "",
        order.otherSchedule ? `Schedule detail: ${order.otherSchedule}.` : "",
        `Expected arrival: ${selectedDate}.`,
        order.notes
      ].filter(Boolean).join("\n");
      const request = await createRequest({
        itemId: item.id,
        quantityNeeded: line.quantity,
        urgencyLevel: "Low",
        storageLocation: item.storageLocation || "",
        inventoryArea: item.inventoryArea || "",
        inventorySubgroup: item.inventorySubgroup || "",
        shelfCode: item.shelfCode || "",
        notes
      }, `Standing Order - ${userName}`);

      const runLine = await createStandingOrderRunLine(run, order, item, line.quantity, request, notes);
      if (runLine?.id) {
        const updatedNotes = `${notes}\nStanding run line id: ${runLine.id}.`;
        await airtable(`${requestsTableId}/${request.id}`, {
          method: "PATCH",
          body: JSON.stringify({ fields: { Notes: updatedNotes } })
        });
        request.notes = updatedNotes;
      }
      generated.push(request);
    }
    const nextDate = nextStandingOrderDate(order, selectedDate);
    await airtable(`${tableId}/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          "Last Generated Date": selectedDate,
          "Expected Arrival Date": nextDate || selectedDate,
          Active: order.schedule === "One Time" ? false : order.active
        }
      })
    });
  }

  return generated;
}

async function updateAppUser(recordId, payload) {
  const tableId = await getAppUsersTableId();
  if (!tableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid app user record.");

  const schema = await getSchema();
  const currentUser = await findAppUserById(recordId);
  if (!currentUser) throw new Error("User was not found.");
  const fields = appUserUpdateFields(payload, currentUser, schema);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true })
  });
  cache.appUsers.expiresAt = 0;
  return normalizeAppUser(record);
}

async function deleteAppUser(recordId) {
  const tableId = await getAppUsersTableId();
  if (!tableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid app user record.");
  const result = await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
  cache.appUsers.expiresAt = 0;
  return { id: result.id || recordId, deleted: Boolean(result.deleted) };
}

async function listSchema() {
  const data = await airtable("tables", { meta: true });
  const normalizeFieldName = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const findFieldName = (tableName, ...candidates) => {
    const table = data.tables.find((entry) => entry.name === tableName);
    if (!table) return "";
    const fields = table.fields || [];
    for (const candidate of candidates) {
      const expected = normalizeFieldName(candidate);
      const match = fields.find((field) => normalizeFieldName(field.name) === expected);
      if (match) return match.name;
    }
    return "";
  };
  const requests = data.tables.find((table) => table.id === requestsTableId);
  const driverSheetLines = data.tables.find((table) => table.name === "Driver Sheet Lines");
  const appUsers = data.tables.find((table) => table.name === "App Users");
  const standingOrders = data.tables.find((table) => table.name === "Standing Orders");
  const standingOrderRuns = data.tables.find((table) => table.name === "Standing Order Runs");
  const standingOrderRunLines = data.tables.find((table) => table.name === "Standing Order Run Lines");
  const requestFields = new Set((requests?.fields || []).map((field) => field.name));
  const driverLineFields = new Set((driverSheetLines?.fields || []).map((field) => field.name));
  const appUserFields = new Set((appUsers?.fields || []).map((field) => field.name));
  const standingOrderFields = new Set((standingOrders?.fields || []).map((field) => field.name));
  const tableByName = new Map(data.tables.map((table) => [table.name, table.id]));
  const fieldsByTableName = new Map(data.tables.map((table) => [table.name, new Set((table.fields || []).map((field) => field.name))]));
  const lookupTables = Object.fromEntries(
    Object.entries(lookupConfigs).map(([key, config]) => [key, tableByName.get(config.tableName) || ""])
  );

  return {
    tables: {
      driverSheetLines: driverSheetLines?.id || "",
      stockCounts: tableByName.get("Stock Counts") || "",
      invoiceCaptures: tableByName.get("Invoice Captures") || "",
      invoiceLines: tableByName.get("Invoice Lines") || "",
      appUsers: tableByName.get("App Users") || "",
      standingOrders: tableByName.get("Standing Orders") || "",
      standingOrderRuns: standingOrderRuns?.id || "",
      standingOrderRunLines: standingOrderRunLines?.id || "",
      dailyGuestCounts: tableByName.get("Daily Guest Counts") || "",
      ...lookupTables
    },
    requests: {
      hasStorageLocation: requestFields.has("Storage Location"),
      hasInventoryArea: requestFields.has("Inventory Area")
    },
    driverLines: {
      hasDriver: driverLineFields.has("Driver"),
      hasDeliveryDay: driverLineFields.has("Delivery Day"),
      hasDeliveryDate: driverLineFields.has("Delivery Date"),
      hasStandingRunId: driverLineFields.has("Standing Order Run ID"),
      hasStandingRunLineId: driverLineFields.has("Standing Order Run Line ID")
    },
    standingOrders: {
      hasItemsJson: standingOrderFields.has("Items JSON"),
      hasInventoryItem: standingOrderFields.has("Inventory Item"),
      hasInventoryItemRecordId: standingOrderFields.has("Inventory Item Record ID"),
      hasItemName: standingOrderFields.has("Item Name"),
      hasQuantity: standingOrderFields.has("Quantity")
    },
    lookupFields: {
      storageLocations: {
        hasActive: fieldsByTableName.get("Storage Locations")?.has("Active") || false
      },
      shelfCodes: {
        storageLocationFieldName: findFieldName("Shelf Codes", "Storage Location", "Storage Locations"),
        storageLocationLinkFieldName: findFieldName("Shelf Codes", "Storage Location Link", "Storage Locations Link", "Storage Location Links"),
        hasStorageLocation: Boolean(findFieldName("Shelf Codes", "Storage Location", "Storage Locations")),
        hasStorageLocationLink: Boolean(findFieldName("Shelf Codes", "Storage Location Link", "Storage Locations Link", "Storage Location Links")),
        hasActive: fieldsByTableName.get("Shelf Codes")?.has("Active") || false
      }
    },
    appUsers: {
      hasTheme: appUserFields.has("Theme"),
      hasActive: appUserFields.has("Active"),
      hasForcePasswordChange: appUserFields.has("Force Password Change")
    }
  };
}

async function getSchema() {
  return cached("schema", 10 * 60 * 1000, listSchema);
}

async function ensureShelfCodeStorageLocationField(schema = null) {
  const currentSchema = schema || await getSchema();
  if (currentSchema.lookupFields.shelfCodes.hasStorageLocation || currentSchema.lookupFields.shelfCodes.hasStorageLocationLink) {
    return currentSchema;
  }

  const shelfCodesTableId = currentSchema.tables.shelfCodes;
  if (!shelfCodesTableId) throw new Error("Shelf Codes table was not found.");

  await airtable(`tables/${shelfCodesTableId}/fields`, {
    meta: true,
    method: "POST",
    body: JSON.stringify({
      name: "Storage Location",
      type: "singleLineText"
    })
  });

  cache.schema.expiresAt = 0;
  cache.lookups.expiresAt = 0;
  return getSchema();
}

async function listLookupRecords() {
  const schema = await getSchema();
  const result = {};

  for (const [key, config] of Object.entries(lookupConfigs)) {
    const tableId = schema.tables[key];
    const records = tableId ? await listAirtableRecords(tableId) : [];
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

function normalizeStorageLocation(record) {
  return {
    id: record.id,
    name: String(record.fields["Storage Location"] || "").trim(),
    active: record.fields.Active !== false
  };
}

function normalizeCategory(record) {
  return {
    id: record.id,
    name: String(record.fields.Category || "").trim()
  };
}

function normalizeShelfCode(record) {
  return {
    id: record.id,
    name: String(record.fields["Shelf Code"] || "").trim(),
    storageLocation: String(record.fields["Storage Location"] || record.fields["Storage Locations"] || "").trim(),
    storageLocationId: record.fields["Storage Location Link"]?.[0] || record.fields["Storage Locations Link"]?.[0] || record.fields["Storage Location Links"]?.[0] || "",
    active: record.fields.Active !== false
  };
}

async function listStorageLocationsAdmin() {
  const schema = await getSchema();
  const tableId = schema.tables.storageLocations;
  if (!tableId) throw new Error("Storage Locations table was not found.");
  const records = await listAirtableRecords(tableId, {
    "sort[0][field]": "Storage Location",
    "sort[0][direction]": "asc"
  });
  return records.map(normalizeStorageLocation).filter((entry) => entry.name);
}

async function listCategoriesAdmin() {
  const schema = await getSchema();
  const tableId = schema.tables.categories;
  if (!tableId) throw new Error("Categories table was not found.");
  const records = await listAirtableRecords(tableId, {
    "sort[0][field]": "Category",
    "sort[0][direction]": "asc"
  });
  return records.map(normalizeCategory).filter((entry) => entry.name);
}

async function listShelfCodesAdmin() {
  let schema = await getSchema();
  schema = await ensureShelfCodeStorageLocationField(schema);
  const tableId = schema.tables.shelfCodes;
  if (!tableId) throw new Error("Shelf Codes table was not found.");
  const records = await listAirtableRecords(tableId, {
    "sort[0][field]": "Shelf Code",
    "sort[0][direction]": "asc"
  });
  const locations = await listStorageLocationsAdmin();
  const locationById = new Map(locations.map((location) => [location.id, location.name]));
  const unique = new Map();
  for (const shelf of records
    .map(normalizeShelfCode)
    .map((shelf) => ({
      ...shelf,
      storageLocation: shelf.storageLocation || locationById.get(shelf.storageLocationId) || ""
    }))
    .filter((entry) => entry.name)) {
    const key = `${String(shelf.storageLocation || "").trim().toLowerCase()}::${String(shelf.name || "").trim().toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, shelf);
  }
  return [...unique.values()].sort((a, b) => {
    const location = a.storageLocation.localeCompare(b.storageLocation);
    if (location) return location;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

async function findExistingShelfCodeRecordId(name, storageLocation, excludeRecordId = "") {
  let schema = await getSchema();
  schema = await ensureShelfCodeStorageLocationField(schema);
  const tableId = schema.tables.shelfCodes;
  if (!tableId) return "";

  const wantedName = String(name || "").trim().toLowerCase();
  const wantedLocation = String(storageLocation || "").trim().toLowerCase();
  if (!wantedName) return "";

  const records = await listAirtableRecords(tableId, {
    "sort[0][field]": "Shelf Code",
    "sort[0][direction]": "asc"
  });
  const locations = await listStorageLocationsAdmin();
  const locationById = new Map(locations.map((location) => [location.id, location.name]));
  const match = records
    .map(normalizeShelfCode)
    .map((shelf) => ({
      ...shelf,
      storageLocation: shelf.storageLocation || locationById.get(shelf.storageLocationId) || ""
    }))
    .find((shelf) =>
      shelf.id !== excludeRecordId &&
      String(shelf.name || "").trim().toLowerCase() === wantedName &&
      String(shelf.storageLocation || "").trim().toLowerCase() === wantedLocation
    );
  return match?.id || "";
}

async function findExistingCategoryRecordId(name, excludeRecordId = "") {
  const wantedName = String(name || "").trim().toLowerCase();
  if (!wantedName) return "";
  const categories = await listCategoriesAdmin();
  const match = categories.find((category) =>
    category.id !== excludeRecordId &&
    String(category.name || "").trim().toLowerCase() === wantedName
  );
  return match?.id || "";
}

async function resolveShelfCodeRecord(name, storageLocation) {
  const shelfName = String(name || "").trim();
  const locationName = String(storageLocation || "").trim();
  if (!shelfName) return "";

  const shelves = await listShelfCodesAdmin();
  const match = shelves.find((shelf) =>
    shelf.name.toLowerCase() === shelfName.toLowerCase() &&
    (!locationName || String(shelf.storageLocation || "").toLowerCase() === locationName.toLowerCase())
  );
  if (match) return match.id;

  const created = await saveShelfCode({
    name: shelfName,
    storageLocation: locationName,
    active: true
  });
  return created.id;
}

async function saveStorageLocation(payload, recordId = "") {
  const schema = await getSchema();
  const tableId = schema.tables.storageLocations;
  if (!tableId) throw new Error("Storage Locations table was not found.");
  const name = String(payload.name || payload.storageLocation || "").trim();
  const active = payload.active !== false;
  if (!name) throw new Error("Storage location name is required.");
  const fields = { "Storage Location": name };
  if (schema.lookupFields.storageLocations.hasActive) fields.Active = active;

  const record = recordId
    ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return normalizeStorageLocation(record);
}

async function saveCategory(payload, recordId = "") {
  const schema = await getSchema();
  const tableId = schema.tables.categories;
  if (!tableId) throw new Error("Categories table was not found.");
  const name = String(payload.name || payload.category || "").trim();
  if (!name) throw new Error("Category name is required.");

  const duplicateId = await findExistingCategoryRecordId(name, recordId);
  if (duplicateId && !recordId) {
    recordId = duplicateId;
  } else if (duplicateId && recordId && duplicateId !== recordId) {
    throw new Error(`Category "${name}" already exists.`);
  }

  const fields = { Category: name };
  const record = recordId
    ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return normalizeCategory(record);
}

async function deleteCategory(recordId) {
  const schema = await getSchema();
  const tableId = schema.tables.categories;
  if (!tableId) throw new Error("Categories table was not found.");
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid category record.");
  }
  await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return { ok: true, recordId };
}

async function saveShelfCode(payload, recordId = "") {
  let schema = await getSchema();
  schema = await ensureShelfCodeStorageLocationField(schema);
  const tableId = schema.tables.shelfCodes;
  if (!tableId) throw new Error("Shelf Codes table was not found.");
  const name = String(payload.name || payload.shelfCode || "").trim();
  const storageLocation = String(payload.storageLocation || "").trim();
  const active = payload.active !== false;
  if (!name) throw new Error("Shelf code is required.");
  const duplicateId = await findExistingShelfCodeRecordId(name, storageLocation, recordId);
  if (duplicateId && !recordId) {
    recordId = duplicateId;
  } else if (duplicateId && recordId && duplicateId !== recordId) {
    throw new Error(`Shelf code "${name}" already exists for ${storageLocation}.`);
  }
  const fields = { "Shelf Code": name };
  if (schema.lookupFields.shelfCodes.hasActive) fields.Active = active;
  if (storageLocation) {
    if (schema.lookupFields.shelfCodes.hasStorageLocationLink) {
      const locationId = await findOrCreateLookupRecord("storageLocations", storageLocation);
      fields[schema.lookupFields.shelfCodes.storageLocationLinkFieldName || "Storage Location Link"] = locationId ? [locationId] : [];
    } else if (schema.lookupFields.shelfCodes.hasStorageLocation) {
      fields[schema.lookupFields.shelfCodes.storageLocationFieldName || "Storage Location"] = storageLocation;
    } else {
      throw new Error("Add Storage Location or Storage Location Link to the Shelf Codes table first.");
    }
  }

  const record = recordId
    ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return normalizeShelfCode(record);
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

function normalizeDriverLine(record) {
  return {
    id: record.id,
    sheetDate: record.fields["Sheet Date"] || "",
    requestRecordId: record.fields["Item Request Record ID"] || "",
    requestId: record.fields["Request ID"] || "",
    itemRecordId: record.fields["Inventory Item Record ID"] || "",
    itemName: record.fields["Item Name"] || "",
    supplierName: record.fields["Supplier Name"] || "",
    supplierContact: record.fields["Supplier Contact"] || "",
    quantity: record.fields.Quantity ?? null,
    unit: record.fields.Unit || "",
    inventoryArea: record.fields["Inventory Area"] || "",
    storageLocation: record.fields["Storage Location"] || "",
    inventorySubgroup: record.fields["Inventory Subgroup"] || "",
    shelfCode: record.fields["Shelf Code"] || "",
    ordered: Boolean(record.fields.Ordered),
    toDeliver: Boolean(record.fields["2Deliver"]),
    deliveryDay: record.fields["Delivery Day"] || record.fields["Delivery Date"] || "",
    driverName: record.fields.Driver || "",
    orderedAt: record.fields["Ordered Date/Time"] || "",
    orderedBy: record.fields["Ordered By"] || "",
    received: Boolean(record.fields.Received),
    receivedAt: record.fields["Received Date/Time"] || "",
    receivedBy: record.fields["Received By"] || "",
    requestStatus: record.fields["Request Status"] || "",
    standingRunId: record.fields["Standing Order Run ID"] || "",
    standingRunLineId: record.fields["Standing Order Run Line ID"] || "",
    notes: record.fields.Notes || ""
  };
}

function orderCategory(value) {
  return String(value?.inventorySubgroup || value?.category || value?.inventoryArea || "").trim();
}

function logicalOrderCompare(a, b) {
  const supplier = String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
  if (supplier) return supplier;
  const category = orderCategory(a).localeCompare(orderCategory(b));
  if (category) return category;
  const shelf = String(a.shelfCode || "").localeCompare(String(b.shelfCode || ""), undefined, { numeric: true });
  if (shelf) return shelf;
  return String(a.itemName || a.name || "").localeCompare(String(b.itemName || b.name || ""));
}

async function listRequestsByRecordIds(recordIds) {
  const uniqueIds = [...new Set(recordIds.filter((id) => /^rec[a-zA-Z0-9]+$/.test(id || "")))];
  const records = [];

  for (let index = 0; index < uniqueIds.length; index += 20) {
    const chunk = uniqueIds.slice(index, index + 20);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    records.push(...(await listAirtableRecords(requestsTableId, { filterByFormula: formula })));
  }

  return new Map(records.map((record) => [record.id, normalizeRequest(record)]));
}

async function listOrderReport(date) {
  const schema = await getSchema();
  const driverLinesTableId = schema.tables.driverSheetLines;
  if (!driverLinesTableId) throw new Error("Driver Sheet Lines table is not configured.");

  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);

  await listDriverSheet(selectedDate);
  const guestCount = await getDailyGuestCount(selectedDate);
  const lines = await listDriverSheetLines(driverLinesTableId, selectedDate);
  const requestById = await listRequestsByRecordIds(lines.map((line) => line.requestRecordId));
  const standingOrders = (await listStandingOrders())
    .sort((a, b) => {
      const dateCompare = String(a.expectedDate || "").localeCompare(String(b.expectedDate || ""));
      if (dateCompare) return dateCompare;
      const supplierCompare = String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
      if (supplierCompare) return supplierCompare;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  const rows = lines
    .map((line) => {
      const request = requestById.get(line.requestRecordId);
      const delivered = Boolean(line.received || request?.received);
      const ordered = Boolean(line.ordered);
      return {
        ...line,
        quantity: line.quantity ?? request?.quantity ?? null,
        unit: line.unit || "",
        requestedBy: request?.requestedBy || "",
        requestedAt: request?.requestedAt || "",
        urgency: request?.urgency || "",
        notes: line.notes || request?.notes || "",
        status: delivered ? "Delivered" : ordered ? "Picked / Ordered" : "Waiting",
        delivered,
        receivedAt: line.receivedAt || request?.receivedAt || "",
        receivedBy: line.receivedBy || request?.receivedBy || "",
        waiting: !delivered
      };
    })
    .sort((a, b) => {
      const logical = logicalOrderCompare(a, b);
      if (logical) return logical;
      const status = String(a.status || "").localeCompare(String(b.status || ""));
      if (status) return status;
      return String(a.requestId || "").localeCompare(String(b.requestId || ""));
    });

  return {
    date: selectedDate,
    summary: {
      guests: guestCount?.guests ?? null,
      totalLines: rows.length,
      orderedLines: rows.filter((row) => row.ordered).length,
      deliveredLines: rows.filter((row) => row.delivered).length,
      waitingLines: rows.filter((row) => row.waiting).length,
      toDeliverLines: rows.filter((row) => row.toDeliver).length
    },
    guestCount,
    rows,
    standingOrders
  };
}

async function listDriverSheet(date) {
  const schema = await getSchema();
  const driverLinesTableId = schema.tables.driverSheetLines;
  const items = await getItems();
  const suppliers = await getSuppliers();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  await generateStandingOrdersForDate(selectedDate);
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
  const records = await listAirtableRecords(requestsTableId, Object.fromEntries(query.entries()));
  const requests = records.map((record) => {
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

  let lineByRequestId = new Map();
  if (driverLinesTableId) {
    await persistDriverSheetLines(driverLinesTableId, selectedDate, requests);
    const lines = await listDriverSheetLines(driverLinesTableId, selectedDate);
    lineByRequestId = new Map(lines.map((line) => [line.requestRecordId, line]));
  }

  const mergedRequests = requests.map((request) => {
    const line = lineByRequestId.get(request.id);
    return {
      ...request,
      driverLineId: line?.id || "",
      ordered: Boolean(line?.ordered),
      toDeliver: Boolean(line?.toDeliver),
      deliveryDay: line?.deliveryDay || "",
      driverName: line?.driverName || "",
      orderedAt: line?.orderedAt || "",
      orderedBy: line?.orderedBy || "",
      delivered: Boolean(line?.received || request.received),
      receivedAt: line?.receivedAt || request.receivedAt || "",
      receivedBy: line?.receivedBy || request.receivedBy || "",
      supplierName: line?.supplierName || request.supplierName,
      supplierContact: line?.supplierContact || request.supplierContact
    };
  }).sort(logicalOrderCompare);

  return {
    date: selectedDate,
    driverName: [...lineByRequestId.values()].find((line) => line.driverName)?.driverName || "",
    requests: mergedRequests,
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      contact: supplier.contact
    }))
  };
}

async function assignDriverToSheet(date, driverName, user) {
  if (!user.permissions?.canAdminUsers) {
    throw new Error("Only admins can assign a driver.");
  }

  const schema = await getSchema();
  const tableId = schema.tables.driverSheetLines;
  if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");
  if (!schema.driverLines.hasDriver) throw new Error("Add a Driver field to the Driver Sheet Lines table first.");

  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  await listDriverSheet(selectedDate);
  const lines = await listDriverSheetLines(tableId, selectedDate);
  const cleanedDriver = String(driverName || "").trim();
  if (!cleanedDriver) throw new Error("Driver name is required.");

  for (const line of lines) {
    await airtable(`${tableId}/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { Driver: cleanedDriver } })
    });
  }

  return {
    date: selectedDate,
    driverName: cleanedDriver,
    updated: lines.length
  };
}

async function persistDriverSheetLines(tableId, sheetDate, requests) {
  const schema = await getSchema();
  const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
  const existing = { records: await listAirtableRecords(tableId, { filterByFormula: formula }) };
  const existingKeys = new Set(
    existing.records.map((record) => `${record.fields["Item Request Record ID"] || ""}|${record.fields["Sheet Date"] || ""}`)
  );

  for (const request of requests) {
    const key = `${request.id}|${sheetDate}`;
    if (existingKeys.has(key)) continue;

    const isStanding = String(request.requestedBy || "").includes("Standing Order") || String(request.notes || "").includes("Standing order:");
    const standingSupplier = standingSupplierFromNotes(request.notes);
    const standingRunId = standingRunIdFromNotes(request.notes);
    const standingRunLineId = standingRunLineIdFromNotes(request.notes);
    const fields = {
      "Sheet Line": `${sheetDate} - ${request.requestId || request.id}`,
      "Sheet Date": sheetDate,
      "Item Request Record ID": request.id,
      "Request ID": request.requestId || 0,
      "Inventory Item Record ID": request.itemId,
      "Item Name": request.itemName,
      "Supplier Name": standingSupplier || request.supplierName,
      "Supplier Contact": request.supplierContact,
      Quantity: request.quantity || 0,
      Unit: request.unit,
      "Inventory Area": request.inventoryArea || undefined,
      "Storage Location": request.storageLocation || undefined,
      "Inventory Subgroup": request.inventorySubgroup || "",
      "Shelf Code": request.shelfCode || "",
      "Request Status": request.status,
      Received: Boolean(request.received),
      "2Deliver": isStanding,
      Notes: request.notes || ""
    };
    if (isStanding && schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = sheetDate;
    if (isStanding && schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = sheetDate;
    if (standingRunId && schema.driverLines.hasStandingRunId) fields["Standing Order Run ID"] = standingRunId;
    if (standingRunLineId && schema.driverLines.hasStandingRunLineId) fields["Standing Order Run Line ID"] = standingRunLineId;

    const created = await airtable(tableId, {
      method: "POST",
      body: JSON.stringify({ fields })
    });
    if (standingRunLineId) {
      await patchStandingOrderRunLine(standingRunLineId, { "Driver Line Record ID": created.id });
    }
  }
}

async function listDriverSheetLines(tableId, sheetDate) {
  const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
  const records = await listAirtableRecords(tableId, { filterByFormula: formula });
  return records.map(normalizeDriverLine);
}

async function createRequest(payload, requestedByOverride = "") {
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
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
    Status: "Approved",
    Notes: notes
  };

  const record = await airtable(requestsTableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });

  cache.requests.expiresAt = 0;
  return normalizeCreatedRequest(record);
}

function createRequestFields(payload, schema, requestedByOverride = "") {
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");
  const storageLocation = String(payload.storageLocation || "");
  const inventoryArea = String(payload.inventoryArea || "");
  const inventorySubgroup = String(payload.inventorySubgroup || "");
  const shelfCode = String(payload.shelfCode || "");

  if (!itemId) throw new Error("Choose an item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");

  const fields = {
    "Requested Item": [itemId],
    "Quantity Needed": quantity,
    "Urgency Level": urgency,
    "Requested By": requestedBy,
    "Request Date/Time": new Date().toISOString(),
    Status: "Approved",
    Notes: notes
  };

  return fields;
}

async function createRequestsBatch(payload, requestedByOverride = "") {
  const requestedItems = Array.isArray(payload.requests) ? payload.requests : [];
  if (!requestedItems.length) throw new Error("Select at least one item.");
  if (requestedItems.length > 50) throw new Error("Submit 50 items or fewer at a time.");

  const created = [];
  for (const request of requestedItems) {
    created.push(await createRequest(request, requestedByOverride));
  }

  cache.requests.expiresAt = 0;
  return created;
}

async function createStandingOrder(payload, user) {
  const standingOrder = await saveStandingOrderDefinition(payload, user);
  const today = new Date().toISOString().slice(0, 10);
  const generated = standingOrder.expectedDate <= today
    ? await generateStandingOrdersForDate(today, user.name)
    : [];
  return { standingOrder, generated };
}

async function updateItemSettings(recordId, payload) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid item record.");
  }

  const minimum = Number(payload.minimumThreshold);
  const unit = String(payload.unit || "").trim().toLowerCase();
  const inventoryArea = String(payload.inventoryArea || "").trim();
  const storageLocation = String(payload.storageLocation || "").trim();
  const category = String(payload.category || "").trim();
  const shelfCode = String(payload.shelfCode || "").trim();
  const supplierId = String(payload.supplierId || "").trim();

  if (!Number.isFinite(minimum) || minimum < 0) {
    throw new Error("Minimum stock must be zero or greater.");
  }

  if (!allowedUnits.has(unit)) {
    throw new Error("Unit must be box, bag, item, or bottle.");
  }

  const unitRecordId = await findOrCreateLookupRecord("unitOfMeasurement", unit);
  const categoryRecordId = await findOrCreateLookupRecord("categories", category);
  const areaRecordId = await findOrCreateLookupRecord("inventoryAreas", inventoryArea);
  const storageLocationRecordId = await findOrCreateLookupRecord("storageLocations", storageLocation);
  const shelfRecordId = await resolveShelfCodeRecord(shelfCode, storageLocation);
  const fields = {
    "Minimum Threshold": minimum
  };

  if (unitRecordId) fields["Unit Of Measurement Link"] = [unitRecordId];
  fields["Category Link"] = categoryRecordId ? [categoryRecordId] : [];
  fields["Inventory Area Link"] = areaRecordId ? [areaRecordId] : [];
  fields["Storage Location Link"] = storageLocationRecordId ? [storageLocationRecordId] : [];
  fields["Shelf Code Link"] = shelfRecordId ? [shelfRecordId] : [];
  fields["Supplier/Vendor"] = /^rec[a-zA-Z0-9]+$/.test(supplierId) ? [supplierId] : [];

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

async function deleteInventoryItem(recordId) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid item record.");
  }
  await airtable(`${inventoryTableId}/${recordId}`, { method: "DELETE" });
  cache.items.expiresAt = 0;
  cache.requests.expiresAt = 0;
  return { ok: true, recordId };
}

async function updateItemPrimarySupplier(itemRecordId, supplier) {
  if (!/^rec[a-zA-Z0-9]+$/.test(itemRecordId || "")) {
    throw new Error("This driver line is not linked to an inventory item.");
  }
  if (!supplier?.id) {
    throw new Error("Choose a known supplier before changing the primary supplier.");
  }

  await airtable(`${inventoryTableId}/${itemRecordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        "Supplier/Vendor": [supplier.id],
        "Last Updated Date": new Date().toISOString()
      }
    })
  });

  cache.items.expiresAt = 0;
}

async function createInventoryItem(payload) {
  const itemName = String(payload.itemName || "").trim();
  const category = String(payload.category || "").trim();
  const storageLocation = String(payload.storageLocation || "").trim();
  const inventoryArea = String(payload.inventoryArea || "").trim();
  const shelfCode = String(payload.shelfCode || "TBD").trim();
  const supplierId = String(payload.supplierId || "").trim();
  const unit = String(payload.unit || "item").trim().toLowerCase();
  const currentQuantity = Number(payload.currentQuantity || 0);
  const minimum = Number(payload.minimumThreshold || 0);

  if (!itemName) throw new Error("Item name is required.");
  if (!allowedUnits.has(unit)) throw new Error("Unit must be box, bag, item, or bottle.");
  if (!Number.isFinite(currentQuantity) || currentQuantity < 0) throw new Error("Current stock must be zero or greater.");
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Minimum stock must be zero or greater.");

  const categoryId = await findOrCreateLookupRecord("categories", category);
  const storageLocationId = await findOrCreateLookupRecord("storageLocations", storageLocation);
  const inventoryAreaId = await findOrCreateLookupRecord("inventoryAreas", inventoryArea);
  const shelfId = await resolveShelfCodeRecord(shelfCode, storageLocation);
  const unitId = await findOrCreateLookupRecord("unitOfMeasurement", unit);

  const fields = {
    "Item Name": itemName,
    "Current Quantity": currentQuantity,
    "Minimum Threshold": minimum,
    "Last Updated Date": new Date().toISOString()
  };

  if (categoryId) fields["Category Link"] = [categoryId];
  if (storageLocationId) fields["Storage Location Link"] = [storageLocationId];
  if (inventoryAreaId) fields["Inventory Area Link"] = [inventoryAreaId];
  if (shelfId) fields["Shelf Code Link"] = [shelfId];
  if (unitId) fields["Unit Of Measurement Link"] = [unitId];
  if (/^rec[a-zA-Z0-9]+$/.test(supplierId)) fields["Supplier/Vendor"] = [supplierId];

  const record = await airtable(inventoryTableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });

  cache.items.expiresAt = 0;
  cache.lookups.expiresAt = 0;
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

function normalizeOcrRule(record) {
  return {
    id: record.id,
    supplierName: record.fields["Supplier Name"] || "",
    ruleType: record.fields["Rule Type"] || "",
    ocrMatchText: record.fields["OCR Match Text"] || "",
    targetField: record.fields["Target Field"] || "",
    inventoryItemId: record.fields["Inventory Item Record ID"] || "",
    inventoryItemName: record.fields["Inventory Item Name"] || "",
    active: Boolean(record.fields.Active),
    notes: record.fields.Notes || ""
  };
}

function airtableFormulaText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listOcrRules(supplierName) {
  const supplier = String(supplierName || "").trim().toLowerCase();
  const formula = supplier
    ? `AND({Active}=1, LOWER({Supplier Name})='${airtableFormulaText(supplier)}')`
    : "{Active}=1";
  const query = new URLSearchParams({
    pageSize: "100",
    filterByFormula: formula,
    "sort[0][field]": "Supplier Name",
    "sort[0][direction]": "asc"
  });
  const data = await airtable(`${invoiceOcrRulesTableId}?${query}`);
  return data.records.map(normalizeOcrRule);
}

async function createOcrRule(payload, userName) {
  const supplierName = String(payload.supplierName || "").trim();
  const ruleType = String(payload.ruleType || "").trim();
  const ocrMatchText = String(payload.ocrMatchText || "").replace(/\s+/g, " ").trim();
  const targetField = String(payload.targetField || "").trim();
  const inventoryItemId = String(payload.inventoryItemId || "").trim();
  const inventoryItemName = String(payload.inventoryItemName || "").trim();
  const notes = String(payload.notes || "").trim();

  if (!supplierName) throw new Error("Enter the supplier before teaching OCR.");
  if (!["Header Field", "Line Item"].includes(ruleType)) throw new Error("Invalid OCR rule type.");
  if (!ocrMatchText || ocrMatchText.length < 3) throw new Error("OCR match text is too short.");
  if (!["Supplier", "Invoice Number", "Invoice Total", "Inventory Item"].includes(targetField)) {
    throw new Error("Invalid OCR target field.");
  }
  if (ruleType === "Line Item" && !inventoryItemId) throw new Error("Choose an inventory item for line-item rules.");

  const existing = await listOcrRules(supplierName);
  const duplicate = existing.find((rule) =>
    rule.ruleType === ruleType
    && rule.targetField === targetField
    && rule.inventoryItemId === inventoryItemId
    && rule.ocrMatchText.toLowerCase() === ocrMatchText.toLowerCase()
  );
  if (duplicate) return duplicate;

  const record = await airtable(invoiceOcrRulesTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Rule Name": `${supplierName} - ${targetField} - ${ocrMatchText.slice(0, 40)}`,
        "Supplier Name": supplierName,
        "Rule Type": ruleType,
        "OCR Match Text": ocrMatchText,
        "Target Field": targetField,
        "Inventory Item Record ID": inventoryItemId,
        "Inventory Item Name": inventoryItemName,
        Active: true,
        Notes: [notes, `Created from web app by ${userName}`].filter(Boolean).join("\n")
      }
    })
  });

  return normalizeOcrRule(record);
}

async function emailInvoicePicture(payload, userName) {
  requireEmailConfig();

  const attachment = attachmentFromDataUrl(payload.dataUrl, payload.fileName);
  const supplier = String(payload.supplierName || "").trim();
  const invoiceNumber = String(payload.invoiceNumber || "").trim();
  const notes = String(payload.notes || "").trim();
  const subjectParts = ["Invoice"];
  if (supplier) subjectParts.push(supplier);
  if (invoiceNumber) subjectParts.push(`#${invoiceNumber}`);

  const text = [
    "Invoice photo sent from Kitchen Stock.",
    "",
    `Sent by: ${userName}`,
    `Supplier: ${supplier || "(not entered)"}`,
    `Invoice number: ${invoiceNumber || "(not entered)"}`,
    notes ? `Notes: ${notes}` : ""
  ].filter(Boolean).join("\n");

  if (brevoApiKey) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: "Kitchen Stock",
          email: mailFrom
        },
        to: [{ email: accountingInbox }],
        subject: subjectParts.join(" - "),
        textContent: text,
        attachment: [{
          name: attachment.filename,
          content: attachment.content.toString("base64")
        }]
      })
    });

    const responseText = await response.text();
    const responseData = responseText ? JSON.parse(responseText) : {};
    if (!response.ok) {
      throw new Error(`Brevo email failed: ${responseData.message || response.statusText}`);
    }

    return {
      to: accountingInbox,
      messageId: responseData.messageId || "",
      provider: "Brevo API"
    };
  }

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
    text,
    attachments: [attachment]
  });

  return {
    to: accountingInbox,
    messageId: info.messageId || "",
    provider: "SMTP"
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

async function deliverRequest(recordId, userName) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid request record.");
  }

  const requestRecord = await airtable(`${requestsTableId}/${recordId}`);
  const request = normalizeRequest(requestRecord);
  if (request.received || request.status === "Fulfilled") {
    return request;
  }

  const quantity = Number(request.quantity || 0);
  if (!request.itemId) throw new Error("Request has no linked inventory item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Request quantity is not valid.");

  const items = await getItems();
  const item = items.find((candidate) => candidate.id === request.itemId);
  if (!item) throw new Error("Linked inventory item was not found.");

  const currentQuantity = Number(item.quantity || 0);
  const newQuantity = currentQuantity + quantity;
  await createStockCount({
    itemId: item.id,
    countedQuantity: newQuantity,
    notes: `Delivered from order request ${request.requestId || request.id}: added ${quantity} ${item.unit || ""}.`
  }, userName);

  return markRequestReceived(recordId, userName);
}

async function updateDriverLine(recordId, payload, userName) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid driver line record.");
  }

  const schema = await getSchema();
  const tableId = schema.tables.driverSheetLines;
  if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");

  const fields = {};

  if (Object.prototype.hasOwnProperty.call(payload, "ordered")) {
    const ordered = Boolean(payload.ordered);
    fields.Ordered = ordered;
    fields["Ordered Date/Time"] = ordered ? new Date().toISOString() : null;
    fields["Ordered By"] = ordered ? userName : "";
  }

  if (Object.prototype.hasOwnProperty.call(payload, "toDeliver")) {
    const toDeliver = Boolean(payload.toDeliver);
    fields["2Deliver"] = toDeliver;
    if (toDeliver) {
      const deliveryDay = String(payload.deliveryDay || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDay)) {
        throw new Error("Choose the delivery day for 2Deliver items.");
      }
      if (schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = deliveryDay;
      else if (schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = deliveryDay;
      else throw new Error("Add a Delivery Day field to the Driver Sheet Lines table first.");
    } else {
      if (schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = null;
      if (schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "supplierName")) {
    const supplierName = String(payload.supplierName || "").trim();
    const suppliers = await getSuppliers();
    const supplier = suppliers.find((entry) => entry.name.toLowerCase() === supplierName.toLowerCase());
    fields["Supplier Name"] = supplierName || "Unassigned Supplier";
    fields["Supplier Contact"] = supplier?.contact || "";

    if (payload.updatePrimarySupplier) {
      if (!supplier) throw new Error("Choose a known supplier before changing the primary supplier.");
      const currentLine = normalizeDriverLine(await airtable(`${tableId}/${recordId}`));
      await updateItemPrimarySupplier(currentLine.itemRecordId, supplier);
    }
  }

  if (!Object.keys(fields).length) {
    throw new Error("Nothing to update.");
  }

  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });

  return normalizeDriverLine(record);
}

async function deliverDriverLine(recordId, requestRecordId, userName) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid driver line record.");
  }
  if (!/^rec[a-zA-Z0-9]+$/.test(requestRecordId || "")) {
    throw new Error("Invalid request record.");
  }

  const schema = await getSchema();
  const tableId = schema.tables.driverSheetLines;
  if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");

  const existingLineRecord = await airtable(`${tableId}/${recordId}`);
  const existingLine = normalizeDriverLine(existingLineRecord);
  const request = await deliverRequest(requestRecordId, userName);
  const receivedAt = new Date().toISOString();
  const runId = existingLine.standingRunId || standingRunIdFromNotes(existingLine.notes) || standingRunIdFromNotes(request.notes);
  const runLineId = existingLine.standingRunLineId || standingRunLineIdFromNotes(existingLine.notes) || standingRunLineIdFromNotes(request.notes);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Received: true,
        "Received Date/Time": receivedAt,
        "Received By": userName,
        "Request Status": "Fulfilled"
      }
    })
  });

  if (runLineId) {
    await patchStandingOrderRunLine(runLineId, {
      Received: true,
      "Received At": receivedAt,
      "Received By": userName,
      Status: "Received",
      "Driver Line Record ID": recordId,
      "Request Record ID": requestRecordId
    });
  }
  if (runId) {
    await closeStandingOrderRunIfComplete(runId, userName);
  }

  cache.requests.expiresAt = 0;
  return {
    request,
    line: normalizeDriverLine(record)
  };
}

async function deleteRequest(recordId) {
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid request record.");
  }

  const result = await airtable(`${requestsTableId}/${recordId}`, {
    method: "DELETE"
  });

  cache.requests.expiresAt = 0;
  return {
    id: result.id || recordId,
    deleted: Boolean(result.deleted)
  };
}

async function canDeleteRequest(recordId, user) {
  if (user.permissions?.canDeleteAnyOrder) return true;
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) return false;
  const record = await airtable(`${requestsTableId}/${recordId}`);
  const requestedBy = String(record.fields?.["Requested By"] || "").trim().toLowerCase();
  return requestedBy && requestedBy === String(user.name || "").trim().toLowerCase();
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
      const user = await findAppUserByName(name);

      if (!user || user.password !== password) {
        send(res, 401, { error: "Invalid username or password." });
        return;
      }

      send(res, 200, storeSession(user));
      return;
    }

    if (req.method === "POST" && req.url === "/api/change-password") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const payload = await readJson(req);
      const updatedUser = await changeOwnPassword(user.name, payload.currentPassword, payload.newPassword, {
        forceChange: Boolean(user.mustChangePassword)
      });
      send(res, 200, storeSession(updatedUser));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/me")) {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const freshUser = await refreshUserFromDirectory(user);
      if (freshUser.active === false) {
        send(res, 403, { error: "This user is no longer active." });
        return;
      }
      send(res, 200, storeSession(freshUser));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/app-users")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      send(res, 200, { users: (await getAppUsers()).map((appUser) => publicUserForAdmin(appUser, user)) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/app-users") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      const payload = await readJson(req);
      if (!canChangeAppUser(user, { role: "user" }, payload.role)) {
        send(res, 403, { error: "Only God can create admin or god users." });
        return;
      }
      const created = await createAppUser(payload);
      send(res, 201, { user: publicUserForAdmin(created, user) });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/app-users/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const target = await findAppUserById(recordId);
      if (!target) {
        send(res, 404, { error: "User was not found." });
        return;
      }
      if (!canChangeAppUser(user, target, payload.role)) {
        send(res, 403, { error: "Only God can change admin roles. Admins can manage power users and users only." });
        return;
      }
      const updated = await updateAppUser(recordId, payload);
      send(res, 200, { user: publicUserForAdmin(updated, user) });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/app-users/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      const recordId = req.url.split("/")[3];
      const target = await findAppUserById(recordId);
      if (!target) {
        send(res, 404, { error: "User was not found." });
        return;
      }
      if (String(target.name || "").toLowerCase() === String(user.name || "").toLowerCase()) {
        send(res, 403, { error: "You cannot delete your own user." });
        return;
      }
      if (!canDeleteAppUser(user, target)) {
        send(res, 403, { error: "Only God can delete admin users. Admins can delete power users and users only." });
        return;
      }
      const result = await deleteAppUser(recordId);
      send(res, 200, { result });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/items")) {
      if (!requireUser(req, res)) return;
      send(res, 200, { items: await getItems() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/item-form-options")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can add inventory items.")) return;
      send(res, 200, await itemFormOptions());
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/storage-locations")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, { storageLocations: await listStorageLocationsAdmin() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/categories")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, { categories: await listCategoriesAdmin() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/categories") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const category = await saveCategory(await readJson(req));
      send(res, 201, { category });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/categories/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const category = await saveCategory(await readJson(req), recordId);
      send(res, 200, { category });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/setup/categories/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const result = await deleteCategory(recordId);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/storage-locations") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const storageLocation = await saveStorageLocation(await readJson(req));
      send(res, 201, { storageLocation });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/storage-locations/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const storageLocation = await saveStorageLocation(await readJson(req), recordId);
      send(res, 200, { storageLocation });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/shelf-codes")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, {
        shelfCodes: await listShelfCodesAdmin(),
        storageLocations: await listStorageLocationsAdmin()
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/shelf-codes") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const shelfCode = await saveShelfCode(await readJson(req));
      send(res, 201, { shelfCode });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/shelf-codes/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const shelfCode = await saveShelfCode(await readJson(req), recordId);
      send(res, 200, { shelfCode });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/requests")) {
      if (!requireUser(req, res)) return;
      send(res, 200, { requests: await getRequests() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      if (!requireUser(req, res)) return;
      const [items, requests, standingOrders] = await Promise.all([getItems(), listOpenRequests(), listStandingOrders()]);
      send(res, 200, {
        items,
        requests,
        standingOrders: standingOrders
          .filter((order) => order.active !== false)
          .sort((a, b) => {
            const dateCompare = String(a.expectedDate || "").localeCompare(String(b.expectedDate || ""));
            if (dateCompare) return dateCompare;
            const supplierCompare = String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
            if (supplierCompare) return supplierCompare;
            return String(a.name || "").localeCompare(String(b.name || ""));
          })
      });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/driver-sheet")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listDriverSheet(url.searchParams.get("date")));
      return;
    }

    if (req.method === "PATCH" && req.url === "/api/driver-sheet/driver") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can assign a driver.")) return;
      const payload = await readJson(req);
      send(res, 200, await assignDriverToSheet(payload.date, payload.driverName, user));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/receiving-sheet")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      const sheet = await listDriverSheet(url.searchParams.get("date"));
      send(res, 200, {
        ...sheet,
        requests: sheet.requests.filter((request) => !request.delivered)
      });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/order-report")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listOrderReport(url.searchParams.get("date")));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/daily-guests")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, { guestCount: await getDailyGuestCount(url.searchParams.get("date")) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/daily-guests") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can enter daily guest counts.")) return;
      const guestCount = await saveDailyGuestCount(await readJson(req), user);
      send(res, 200, { guestCount });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/health")) {
      send(res, 200, {
        ok: true,
        email: {
          provider: brevoApiKey ? "Brevo API" : "SMTP",
          hasBrevoApiKey: Boolean(brevoApiKey),
          hasMailFrom: Boolean(mailFrom),
          hasAccountingInbox: Boolean(accountingInbox),
          smtpConfigured: Boolean(smtpHost && smtpUser && smtpPass),
          render: isRender
        },
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
      const request = await createRequest(await readJson(req), user.name);
      send(res, 201, { request });
      return;
    }

    if (req.method === "POST" && req.url === "/api/requests/batch") {
      const user = requireUser(req, res);
      if (!user) return;
      const requests = await createRequestsBatch(await readJson(req), user.name);
      send(res, 201, { requests });
      return;
    }

    if (req.method === "POST" && req.url === "/api/standing-orders") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can create standing orders.")) return;
      const result = await createStandingOrder(await readJson(req), user);
      send(res, 201, result);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/standing-orders")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can view standing orders.")) return;
      send(res, 200, { standingOrders: await listStandingOrders() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/standing-order-runs")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can view standing order runs.")) return;
      send(res, 200, { runs: await listStandingOrderRuns() });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/standing-orders/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can update standing orders.")) return;
      const recordId = req.url.split("/")[3];
      const standingOrder = await updateStandingOrderRecord(recordId, await readJson(req));
      send(res, 200, { standingOrder });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/items/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can edit inventory setup.")) return;
      const recordId = req.url.split("/")[3];
      const item = await updateItemSettings(recordId, await readJson(req));
      send(res, 200, { item });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/items/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can delete inventory items.")) return;
      const recordId = req.url.split("/")[3];
      const result = await deleteInventoryItem(recordId);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/items") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can add inventory items.")) return;
      const item = await createInventoryItem(await readJson(req));
      send(res, 201, { item });
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
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const invoice = await createInvoiceCapture(await readJson(req), user.name);
      send(res, 201, { invoice });
      return;
    }

    if (req.method === "POST" && req.url === "/api/invoice-lines") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const invoiceLine = await createInvoiceLine(await readJson(req), user.name);
      send(res, 201, { invoiceLine });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/ocr-rules")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const url = new URL(req.url, "http://localhost");
      const rules = await listOcrRules(url.searchParams.get("supplier"));
      send(res, 200, { rules });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ocr-rules") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const payload = await readJson(req);
      const rule = await createOcrRule(payload, user.name);
      send(res, 201, { rule });
      return;
    }

    if (req.method === "POST" && req.url === "/api/email-invoice") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canSendInvoiceToAccounting, "Only admins can send invoices to accounting.")) return;
      const result = await emailInvoicePicture(await readJson(req), user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ocr-invoice") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const result = await ocrSpaceParseImage(await readJson(req));
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/receive")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const request = await deliverRequest(recordId, user.name);
      send(res, 200, { request });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const request = await deliverRequest(recordId, user.name);
      send(res, 200, { request });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/driver-lines/")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const line = await updateDriverLine(recordId, await readJson(req), user.name);
      send(res, 200, { line });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/driver-lines/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const result = await deliverDriverLine(recordId, String(payload.requestId || ""), user.name);
      send(res, 200, result);
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/requests/")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      if (!(await canDeleteRequest(recordId, user))) {
        send(res, 403, { error: "Regular users can only remove order lines they added themselves." });
        return;
      }
      const result = await deleteRequest(recordId);
      send(res, 200, { result });
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
