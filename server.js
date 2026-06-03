import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

const baseId = "appAFvMwWZb2PPWUz";
const inventoryTableId = "tblEuIXG6gxEiD5oU";
const requestsTableId = "tblUHh1jWhqMFEfjd";
const token = process.env.AIRTABLE_TOKEN;
const port = Number(process.env.PORT || 3000);
const itemCacheMs = Number(process.env.ITEM_CACHE_MS || 10 * 60 * 1000);
const requestCacheMs = Number(process.env.REQUEST_CACHE_MS || 20 * 1000);
const authSecret = process.env.AUTH_SECRET || "change-this-secret-in-render";
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const userConfig = process.env.APP_USERS || "";

const cache = {
  items: { expiresAt: 0, value: null, pending: null },
  requests: { expiresAt: 0, value: null, pending: null },
  schema: { expiresAt: 0, value: null, pending: null }
};

const metrics = {
  airtableCalls: 0,
  cacheHits: { items: 0, requests: 0, schema: 0 }
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
  const data = await airtable(`${inventoryTableId}?pageSize=100`);
  return data.records
    .map((record) => ({
      id: record.id,
      name: record.fields["Item Name"] || "",
      category: record.fields.Category || "",
      storageLocation: record.fields["Storage Location"] || "",
      inventoryArea: record.fields["Inventory Area"] || "",
      quantity: record.fields["Current Quantity"] ?? null,
      unit: record.fields["Unit of Measure"] || "",
      minimum: record.fields["Minimum Threshold"] ?? null
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
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
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

async function getRequests() {
  return cached("requests", requestCacheMs, listRequests);
}

async function listSchema() {
  const data = await airtable("tables", { meta: true });
  const requests = data.tables.find((table) => table.id === requestsTableId);
  const requestFields = new Set((requests?.fields || []).map((field) => field.name));

  return {
    requests: {
      hasStorageLocation: requestFields.has("Storage Location"),
      hasInventoryArea: requestFields.has("Inventory Area")
    }
  };
}

async function getSchema() {
  return cached("schema", 10 * 60 * 1000, listSchema);
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
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
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
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
    notes: record.fields.Notes || "",
    requestedAt: record.fields["Request Date/Time"] || ""
  };
}

async function listDriverSheet(date) {
  const items = await getItems();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  const formula = `AND(IS_SAME({Request Date/Time}, '${selectedDate}', 'day'), OR({Status}='Pending', {Status}='Approved'))`;
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
      storageLocation: request.storageLocation || item?.storageLocation || "",
      inventoryArea: request.inventoryArea || item?.inventoryArea || ""
    };
  });

  return { date: selectedDate, requests };
}

async function createRequest(payload) {
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");
  const storageLocation = String(payload.storageLocation || "");
  const inventoryArea = String(payload.inventoryArea || "");

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

  const record = await airtable(requestsTableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });

  cache.requests.expiresAt = 0;
  return normalizeCreatedRequest(record);
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

    await serveStatic(req, res);
  } catch (error) {
    send(res, 400, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Kitchen inventory web app running at http://localhost:${port}`);
});
