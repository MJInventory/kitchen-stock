import { escapeHtml } from "./shared.js";

export function formatNotificationDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function renderStatusChips(chips = []) {
  if (!chips.length) return "";
  return `<div class="status-chip-row">${chips.map(([label, tone]) => `<span class="status-chip ${tone}">${escapeHtml(label)}</span>`).join("")}</div>`;
}
