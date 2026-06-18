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
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function itemCategory(item) {
  return item.category || "Unsorted";
}

export function itemUnit(item) {
  return item.unit || "item";
}

export function shelfSortValue(item) {
  return normalize(item.shelfCode || "TBD").replace(/^shelf\s+/i, "");
}

export function populateSelect(select, values, firstLabel) {
  const current = select.value;
  select.innerHTML = [`<option value="">${escapeHtml(firstLabel)}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join("");
  if (values.includes(current)) select.value = current;
}

export function filterStockItems(items, filters) {
  return items
    .filter((item) => !filters.location || item.storageLocation === filters.location)
    .filter((item) => !filters.area || item.inventoryArea === filters.area)
    .filter((item) => !filters.category || itemCategory(item) === filters.category)
    .sort((a, b) => {
      const shelf = shelfSortValue(a).localeCompare(shelfSortValue(b), undefined, { numeric: true });
      if (shelf) return shelf;
      const category = itemCategory(a).localeCompare(itemCategory(b));
      if (category) return category;
      return a.name.localeCompare(b.name);
    });
}

export function locationOptions(items) {
  return [...new Set(items.map((item) => item.storageLocation).filter(Boolean))].sort();
}

export function areaOptions(items) {
  return [...new Set(items.map((item) => item.inventoryArea).filter(Boolean))].sort();
}

export function categoryOptions(items) {
  return [...new Set(items.map(itemCategory).filter(Boolean))].sort();
}
