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

export function groupByRequester(orders) {
  const map = new Map();
  for (const order of orders) {
    const key = order.requestedBy || "Team";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(order);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
