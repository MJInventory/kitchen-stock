import http from "node:http";
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

const cache = {
  items: { expiresAt: 0, value: null, pending: null },
  requests: { expiresAt: 0, value: null, pending: null }
};

const metrics = {
  airtableCalls: 0,
  cacheHits: { items: 0, requests: 0 }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

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

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${path}`, {
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

function normalizeCreatedRequest(record) {
  return {
    id: record.id,
    requestId: record.fields["Request ID"],
    itemId: record.fields["Requested Item"]?.[0] || "",
    quantity: record.fields["Quantity Needed"] ?? null,
    urgency: record.fields["Urgency Level"] || "",
    requestedBy: record.fields["Requested By"] || "",
    status: record.fields.Status || "",
    notes: record.fields.Notes || "",
    requestedAt: record.fields["Request Date/Time"] || ""
  };
}

async function createRequest(payload) {
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");

  if (!itemId) throw new Error("Choose an item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");

  const record = await airtable(requestsTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Requested Item": [itemId],
        "Quantity Needed": quantity,
        "Urgency Level": urgency,
        "Requested By": requestedBy,
        "Request Date/Time": new Date().toISOString(),
        Status: "Pending",
        Notes: notes
      }
    })
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
    if (req.method === "GET" && req.url.startsWith("/api/items")) {
      send(res, 200, { items: await getItems() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/requests")) {
      send(res, 200, { requests: await getRequests() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      const [items, requests] = await Promise.all([getItems(), getRequests()]);
      send(res, 200, { items, requests });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/health")) {
      send(res, 200, {
        ok: true,
        metrics,
        cache: {
          itemsCached: Boolean(cache.items.value),
          requestsCached: Boolean(cache.requests.value)
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/requests") {
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
