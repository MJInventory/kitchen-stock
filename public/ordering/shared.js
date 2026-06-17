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

export function sameUser(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

export function readUserSettings() {
  try {
    return JSON.parse(localStorage.getItem("kitchenStockSettings") || "{}");
  } catch {
    return {};
  }
}

export function openOrderThresholdDays() {
  const parsed = Number.parseInt(String(readUserSettings().openOrderDays ?? 7), 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, parsed));
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

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchTokens(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

export function itemUnit(item) {
  return item?.unit || "item";
}

export function itemMeta(item) {
  return [item?.inventoryArea, item?.storageLocation, item?.shelfCode].filter(Boolean).join(" / ");
}

export function stockMeta(item) {
  return `Current ${item?.quantity ?? 0} ${itemUnit(item)} / min ${item?.minimum ?? 0}`;
}
