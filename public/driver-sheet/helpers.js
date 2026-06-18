export function isStandingOrderRequest(request) {
  return Boolean(String(request?.standingRunId || "").trim())
    || String(request?.requestedBy || "").toLowerCase().includes("standing order")
    || String(request?.notes || "").toLowerCase().includes("standing order");
}

export function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
      .join("-"))
    .join(" ");
}

export function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function localDateKey(value) {
  const stamp = String(value || "").trim();
  if (!stamp) return "";
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return stamp.slice(0, 10);
  const offset = parsed.getTimezoneOffset();
  return new Date(parsed.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function scheduledDeliveryDay(request) {
  return String(request?.deliveryDay || "").trim();
}

export function hasFutureScheduledDelivery(request, today = todayLocal()) {
  const deliveryDay = scheduledDeliveryDay(request);
  return Boolean(deliveryDay) && deliveryDay > today;
}

export function requestIsOlderThanDays(request, days) {
  const requestedDay = localDateKey(request?.requestedAt);
  if (!requestedDay) return false;
  if (hasFutureScheduledDelivery(request)) return false;
  const today = new Date(`${todayLocal()}T00:00:00`);
  const requested = new Date(`${requestedDay}T00:00:00`);
  if (Number.isNaN(today.getTime()) || Number.isNaN(requested.getTime())) return false;
  const ageDays = Math.floor((today.getTime() - requested.getTime()) / 86400000);
  return ageDays > days;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function groupRequests(requests) {
  const groups = new Map();

  for (const request of requests) {
    const supplier = request.supplierName || "Unassigned Supplier";
    const category = request.category || "Unassigned Category";

    if (!groups.has(supplier)) {
      groups.set(supplier, {
        supplier,
        contact: request.supplierContact || "",
        categories: new Map()
      });
    }

    const supplierEntry = groups.get(supplier);
    if (!supplierEntry.categories.has(category)) {
      supplierEntry.categories.set(category, {
        category,
        requests: []
      });
    }

    supplierEntry.categories.get(category).requests.push(request);
  }

  return groups;
}

export function logicalRequestCompare(a, b) {
  const category = String(a.category || "").localeCompare(String(b.category || ""));
  if (category) return category;
  const shelf = String(a.shelfCode || "").localeCompare(String(b.shelfCode || ""), undefined, { numeric: true });
  if (shelf) return shelf;
  return String(a.itemName || "").localeCompare(String(b.itemName || ""));
}

export function supplierOptions(selectedSupplier, knownSuppliers = []) {
  const selected = selectedSupplier || "";
  const hasSelected = knownSuppliers.some((supplier) => supplier.name === selected);
  const options = [
    ...(selected && !hasSelected ? [{ name: selected }] : []),
    ...knownSuppliers
  ];

  return options
    .map((supplier) => {
      const name = supplier.name || "";
      return `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

export function unitOptions(selectedUnit) {
  const current = String(selectedUnit || "item").trim().toLowerCase() || "item";
  return ["box", "bag", "item", "bottle"]
    .map((unit) => `<option value="${escapeHtml(unit)}"${unit === current ? " selected" : ""}>${escapeHtml(unit)}</option>`)
    .join("");
}

export function formatQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "").trim();
  return Number.isInteger(number) ? String(number) : String(number);
}

export function plainTextFileName(label) {
  return String(label || "supplier")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "supplier";
}

export function buildPlainTextSheet(requests, supplierFilter = "") {
  const grouped = new Map();
  const orderedRequests = [...(requests || [])]
    .filter((request) => !supplierFilter || String(request.supplierName || "Unassigned Supplier").trim() === supplierFilter)
    .sort((left, right) => {
      const supplier = String(left.supplierName || "").localeCompare(String(right.supplierName || ""), undefined, { sensitivity: "base" });
      if (supplier) return supplier;
      return String(left.itemName || "").localeCompare(String(right.itemName || ""), undefined, { numeric: true, sensitivity: "base" });
    });

  for (const request of orderedRequests) {
    const supplier = String(request.supplierName || "Unassigned Supplier").trim() || "Unassigned Supplier";
    if (!grouped.has(supplier)) grouped.set(supplier, []);
    grouped.get(supplier).push(request);
  }

  return [...grouped.entries()]
    .map(([supplier, supplierRequests]) => {
      const lines = supplierRequests.map((request) => `${formatQuantity(request.quantity)} x ${String(request.unit || "item").trim() || "item"} ${String(request.itemName || "").trim()}`.trim());
      return [
        supplier,
        "",
        "Bon dia,",
        "Can i please order the following items:",
        "",
        ...lines,
        "",
        "thank in advance"
      ].join("\n");
    })
    .join("\n\n");
}
