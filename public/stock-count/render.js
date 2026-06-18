import {
  areaOptions,
  categoryOptions,
  escapeHtml,
  filterStockItems,
  itemCategory,
  itemUnit,
  locationOptions,
  populateSelect
} from "./helpers.js";

export function syncLocationPicker({ current, values, firstLabel, button, list }) {
  const options = [{ value: "", label: firstLabel }, ...values.map((value) => ({ value, label: value }))];
  button.textContent = current || firstLabel;
  list.innerHTML = options
    .map(
      (option) => `
        <button
          class="location-picker-option${option.value === current ? " selected" : ""}"
          type="button"
          role="option"
          aria-selected="${option.value === current ? "true" : "false"}"
          data-value="${escapeHtml(option.value)}"
        >
          ${escapeHtml(option.label)}
        </button>
      `
    )
    .join("");
}

export function renderFilters({ items, locationFilter, areaFilter, categoryFilter, locationPickerButton, locationPickerList }) {
  const locations = locationOptions(items);
  const areas = areaOptions(items);
  const categories = categoryOptions(items);

  populateSelect(locationFilter, locations, "Choose Storage Location");
  populateSelect(areaFilter, areas, "All Areas");
  populateSelect(categoryFilter, categories, "All Categories");

  if (!locationFilter.value && locations.length) {
    locationFilter.value = locations[0];
  }

  syncLocationPicker({
    current: locationFilter.value,
    values: locations,
    firstLabel: "Choose Storage Location",
    button: locationPickerButton,
    list: locationPickerList
  });
}

export function updateCountSummary({ items, filters, draftCounts, locationMeta, saveAllButton }) {
  const visible = filterStockItems(items, filters);
  const changed = visible.filter((item) => draftCounts.has(item.id)).length;
  locationMeta.textContent = `${visible.length} items${changed ? ` / ${changed} changed` : ""}`;
  saveAllButton.textContent = changed ? `Save ${changed} Count${changed === 1 ? "" : "s"}` : "Save Counts";
}

export function renderList({
  items,
  filters,
  draftCounts,
  draftNotes,
  locationTitle,
  locationMeta,
  saveAllButton,
  stockCountList
}) {
  const visible = filterStockItems(items, filters);
  const location = filters.location || "All Storage Locations";

  locationTitle.textContent = location;
  updateCountSummary({ items, filters, draftCounts, locationMeta, saveAllButton });

  if (!visible.length) {
    stockCountList.innerHTML = '<p class="empty-sheet">No items match this location.</p>';
    return;
  }

  stockCountList.innerHTML = visible
    .map((item) => {
      const countValue = draftCounts.has(item.id) ? draftCounts.get(item.id) : "";
      const notesValue = draftNotes.get(item.id) || "";
      const low = item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0);
      return `
        <article class="product-row stock-count-row" data-item-id="${escapeHtml(item.id)}">
          <div class="stock-count-marker">${escapeHtml(item.shelfCode || "TBD")}</div>
          <div class="product-main stock-count-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml([item.inventoryArea, item.storageLocation, itemCategory(item)].filter(Boolean).join(" / "))}</span>
            <small>Current ${escapeHtml(item.quantity ?? 0)} ${escapeHtml(itemUnit(item))}${item.minimum !== null ? ` / min ${escapeHtml(item.minimum)}` : ""}</small>
            ${low ? "<em>Below minimum</em>" : ""}
          </div>
          <div class="product-controls stock-count-controls">
            <button class="step-count" type="button" data-step="-1">-</button>
            <input class="count-input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${escapeHtml(item.quantity ?? 0)}" value="${escapeHtml(countValue)}" aria-label="Count ${escapeHtml(item.name)}">
            <button class="step-count" type="button" data-step="1">+</button>
            <span>${escapeHtml(itemUnit(item))}</span>
          </div>
          <label class="stock-count-note-wrap">
            <span>Note</span>
            <input class="count-note" type="text" placeholder="Add note for this count" value="${escapeHtml(notesValue)}" aria-label="Note for ${escapeHtml(item.name)}">
          </label>
        </article>
      `;
    })
    .join("");
}
