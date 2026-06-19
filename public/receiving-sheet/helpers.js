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

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function groupBySupplier(requests) {
  const groups = new Map();
  for (const request of requests) {
    const supplier = request.supplierName || "Unassigned Supplier";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(request);
  }
  return groups;
}

export function logicalRequestCompare(a, b) {
  const storage = String(a.storageLocation || "").localeCompare(String(b.storageLocation || ""));
  if (storage) return storage;
  const shelf = String(a.shelfCode || "").localeCompare(String(b.shelfCode || ""), undefined, { numeric: true });
  if (shelf) return shelf;
  return String(a.itemName || "").localeCompare(String(b.itemName || ""));
}

export function receivingOriginClass(request) {
  switch (String(request.originType || "").trim()) {
    case "standing":
      return "receiving-origin-standing";
    case "automatic":
      return "receiving-origin-automatic";
    case "partial":
      return "receiving-origin-partial";
    default:
      return "receiving-origin-user";
  }
}

export function receivingOriginTitle(request) {
  const originType = String(request.originType || "").trim();
  if (originType === "standing") return "Standing order";
  if (originType === "automatic") return "Automatic minimum-stock order";
  if (originType === "partial") return "Partial remainder from an earlier delivery";

  const requestedBy = String(
    request.requestedBy
    || request.requestedByUsername
    || request.owner
    || ""
  ).trim();
  return requestedBy ? `User order by ${formatUserDisplay(requestedBy)}` : "User order";
}

export function supplierNoteMap(supplierNotes) {
  return new Map((supplierNotes || []).map((note) => [String(note.supplierName || "").trim().toLowerCase(), note]));
}

export function supplierOptions(selectedSupplier, suppliers = []) {
  const selected = selectedSupplier || "";
  const hasSelected = suppliers.some((supplier) => supplier.name === selected);
  const options = [
    ...(selected && !hasSelected ? [{ name: selected }] : []),
    ...suppliers
  ];

  return options
    .map((supplier) => {
      const name = supplier.name || "";
      return `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`;
    })
    .join("");
}
