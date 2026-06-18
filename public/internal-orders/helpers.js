export function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw.split(/\s+/).map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(" ");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function itemMeta(item) {
  return [item.inventoryArea, item.storageLocation, item.shelfCode].filter(Boolean).join(" / ");
}

export function itemCategory(item) {
  return String(item?.category || "").trim() || "Uncategorized";
}

export function itemStockItems(item) {
  return Math.floor((Number(item.quantity || 0) || 0) * 12);
}
