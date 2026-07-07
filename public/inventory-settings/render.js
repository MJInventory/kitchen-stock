import { compareItems, escapeHtml, normalize, optionList, sortOptionRecords } from "./helpers.js";

export function fillFilter(select, records, selectedValue, allLabel) {
  select.innerHTML = `<option value="">${allLabel}</option>` + records
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .map((record) => `<option value="${escapeHtml(record.name)}"${record.name === selectedValue ? " selected" : ""}>${escapeHtml(record.name)}</option>`)
    .join("");
}

export function shelvesForLocation(location, shelfCodes = []) {
  const wanted = normalize(location);
  return (shelfCodes || []).filter((shelf) => {
    if (!wanted) return true;
    return normalize(shelf.storageLocation) === wanted;
  });
}

export function renderItems({
  items,
  dirtyIds,
  draftValues,
  optionsData,
  areaValue,
  locationValue,
  searchValue,
  itemSettingsList
}) {
  const filtered = items
    .map((item) => ({ ...item, ...(draftValues.get(item.id) || {}) }))
    .filter((item) => {
      const areaMatches = !areaValue || item.inventoryArea === areaValue;
      const locationMatches = !locationValue || item.storageLocation === locationValue;
      const haystack = [
        item.name,
        item.supplierName,
        item.inventoryArea,
        item.storageLocation,
        item.category,
        item.shelfCode,
        item.unit
      ].map(normalize).join(" ");
      const searchMatches = !searchValue || haystack.includes(searchValue);
      return areaMatches && locationMatches && searchMatches;
    })
    .sort(compareItems);

  const priceChipLabel = (value) => {
    if (value === null || value === undefined || value === "") return "No price";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "No price";
    return `Price ${amount.toFixed(2)}`;
  };

  itemSettingsList.innerHTML = filtered
    .map((item) => `
      <article class="settings-item${dirtyIds.has(item.id) ? " dirty" : ""}" data-item-id="${item.id}">
        <div class="settings-item-header">
          <div class="settings-item-heading">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.supplierName || "Unassigned Supplier")}</span>
          </div>
          <div class="settings-item-meta-row">
            <span class="settings-item-meta-chip">${escapeHtml(item.inventoryArea || "No area")}</span>
            <span class="settings-item-meta-chip">${escapeHtml(item.storageLocation || "No location")}</span>
            <span class="settings-item-meta-chip">${escapeHtml(item.category || "No category")}</span>
            <span class="settings-item-meta-chip">${escapeHtml(item.shelfCode ? `Shelf ${item.shelfCode}` : "No shelf")}</span>
            <span class="settings-item-meta-chip">Current ${escapeHtml(item.quantity ?? "")} ${escapeHtml(item.unit || "")}</span>
            <span class="settings-item-meta-chip">${escapeHtml(priceChipLabel(item.unitPrice))}</span>
          </div>
        </div>
        <label>
          Item name
          <input class="item-name-input" type="text" value="${escapeHtml(item.name)}">
        </label>
        <label>
          Area
          <select class="area-select">
            ${optionList(optionsData.inventoryAreas || [], item.inventoryArea)}
          </select>
        </label>
        <label>
          Location
          <select class="location-select">
            ${optionList(optionsData.storageLocations || [], item.storageLocation)}
          </select>
        </label>
        <label>
          Category
          <select class="category-select">
            ${optionList(optionsData.categories || [], item.category)}
          </select>
        </label>
        <label>
          Shelf code
          <select class="shelf-select">
            ${optionList(shelvesForLocation(item.storageLocation, optionsData.shelfCodes), item.shelfCode, "Choose shelf")}
          </select>
        </label>
        <label>
          Primary supplier
          <select class="supplier-select">
            <option value="">Unassigned</option>
            ${sortOptionRecords(optionsData.suppliers || []).map((supplier) => `<option value="${escapeHtml(supplier.id)}"${supplier.id === item.supplierId ? " selected" : ""}>${escapeHtml(supplier.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          Minimum stock
          <input class="minimum-input" type="number" min="0" step="1" value="${item.minimum ?? 0}">
        </label>
        <label>
          Unit price
          <input class="price-input compact-price-input" type="number" min="0" step="0.01" value="${item.unitPrice === null || item.unitPrice === undefined ? "" : escapeHtml(item.unitPrice)}">
        </label>
        <label>
          Unit
          <select class="unit-select">
            ${optionList(optionsData.units || [], item.unit, "Choose unit")}
          </select>
        </label>
        <button class="danger-button delete-item-button" type="button">Delete item</button>
      </article>
    `)
    .join("");

  if (!filtered.length) {
    itemSettingsList.innerHTML = '<p class="empty-sheet">No matching items.</p>';
  }
}
