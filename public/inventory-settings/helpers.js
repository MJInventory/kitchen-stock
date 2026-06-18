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

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

export function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function sortOptionRecords(records) {
  return [...(records || [])].sort((left, right) => {
    const leftLabel = String(left.displayName || left.name || "").toLowerCase();
    const rightLabel = String(right.displayName || right.name || "").toLowerCase();
    return leftLabel.localeCompare(rightLabel, undefined, { numeric: true });
  });
}

export function optionList(records, selectedValue, placeholder = "") {
  return [
    placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "",
    ...sortOptionRecords(records).map((record) => {
      const value = record.name ?? record.displayName ?? "";
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(record.displayName || record.name || value)}</option>`;
    })
  ].join("");
}

export function compareItems(left, right) {
  return normalize(left.name).localeCompare(normalize(right.name), undefined, { numeric: true });
}
