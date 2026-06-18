import {
  escapeHtml,
  formatUserDisplay,
  itemCategory,
  itemMeta,
  itemStockItems,
  normalize
} from "./helpers.js";

export function populateFilters({ allItems, areaFilter, locationFilter }) {
  const areas = [...new Set(allItems.map((item) => item.inventoryArea).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const locations = [...new Set(allItems.map((item) => item.storageLocation).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  areaFilter.innerHTML = ['<option value="">All Areas</option>', ...areas.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  locationFilter.innerHTML = ['<option value="">All Locations</option>', ...locations.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
}

export function filterItems({ allItems, searchValue, areaValue, locationValue }) {
  const term = normalize(searchValue);
  const area = String(areaValue || "").trim();
  const location = String(locationValue || "").trim();
  return allItems
    .filter((item) => !area || item.inventoryArea === area)
    .filter((item) => !location || item.storageLocation === location)
    .filter((item) => {
      if (!term) return true;
      return normalize([item.name, item.category, item.inventoryArea, item.storageLocation, item.shelfCode].join(" ")).includes(term);
    })
    .sort((a, b) => {
      const category = itemCategory(a).localeCompare(itemCategory(b), undefined, { sensitivity: "base" });
      if (category) return category;
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
    });
}

export function updateSaveButton({ selected, submitButton }) {
  const total = [...selected.values()].reduce((sum, entry) => sum + Number(entry.quantityItems || 0), 0);
  submitButton.textContent = total ? `${total} item(s) ready` : "0 Saved";
  submitButton.disabled = selected.size === 0;
}

export function renderSelectedChips({ selected, selectedChips }) {
  selectedChips.innerHTML = [...selected.values()]
    .slice(0, 12)
    .map((entry) => `
      <button class="selected-chip" type="button" data-remove-id="${escapeHtml(entry.item.id)}">
        <span>${escapeHtml(entry.item.name)}</span>
        <small>${escapeHtml(entry.quantityItems)} items</small>
      </button>
    `)
    .join("");
}

export function renderCategories({ items, selected, categoryGrid }) {
  const groups = new Map();
  for (const item of items) {
    const category = itemCategory(item);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  categoryGrid.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([category, groupItems]) => {
      const selectedCount = groupItems.filter((item) => selected.has(item.id)).length;
      return `
        <button class="category-card" type="button" data-category="${escapeHtml(category)}">
          <span class="category-open">Open</span>
          <strong>${escapeHtml(category)}</strong>
          <small>${escapeHtml(`${groupItems.length} products${selectedCount ? ` / ${selectedCount} selected` : ""}`)}</small>
        </button>
      `;
    })
    .join("");

  if (!categoryGrid.innerHTML) {
    categoryGrid.innerHTML = '<p class="empty-sheet">No products match this search.</p>';
  }
}

export function renderCatalog({
  items,
  selected,
  categoryTitle,
  categoryMeta,
  backButton,
  catalogList,
  searchTermActive,
  activeCategory
}) {
  categoryTitle.textContent = searchTermActive ? "Search Results" : (activeCategory || "Pick From Inventory");
  categoryMeta.textContent = `${items.length} item${items.length === 1 ? "" : "s"}${selected.size ? ` / ${selected.size} selected` : ""}`;
  backButton.hidden = searchTermActive;
  catalogList.innerHTML = items.map((item) => {
    const entry = selected.get(item.id);
    const chosen = Boolean(entry);
    const qty = entry?.quantityItems ?? 1;
    return `
      <article class="product-row${chosen ? " selected" : ""}" data-item-id="${escapeHtml(item.id)}">
        <button class="product-check" type="button" aria-label="Select ${escapeHtml(item.name)}">${chosen ? "&#10003;" : ""}</button>
        <div class="product-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml([itemCategory(item), itemMeta(item)].filter(Boolean).join(" / "))}</span>
          <small>Current stock about ${escapeHtml(itemStockItems(item))} item(s) / ${escapeHtml(item.quantity ?? 0)} ${escapeHtml(item.unit || "box")} / min ${escapeHtml(item.minimum ?? 0)}</small>
        </div>
        <div class="product-controls internal-order-controls">
          <label class="stock-adjust">
            Need
            <input class="qty-input" type="number" min="1" step="1" value="${escapeHtml(qty)}">
          </label>
          <span class="micro-note">items</span>
        </div>
      </article>
    `;
  }).join("");
  if (!catalogList.innerHTML) {
    catalogList.innerHTML = '<p class="empty-sheet">No inventory items match this search.</p>';
  }
}

export function renderInternalOrders({ internalOrders, internalOrderList, internalCount, internalDrafts }) {
  internalCount.textContent = `${internalOrders.length} open`;
  if (!internalOrders.length) {
    internalOrderList.innerHTML = '<p class="empty-sheet">No internal requests open.</p>';
    return;
  }
  const groups = new Map();
  for (const order of internalOrders) {
    const key = formatUserDisplay(order.requestedBy || "Team");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  internalOrderList.innerHTML = [...groups.entries()].map(([requester, orders]) => `
    <section class="daily-order-group">
      <div class="daily-order-group-heading">
        <h3>${escapeHtml(requester)}</h3>
        <span>${escapeHtml(`${orders.length} order${orders.length === 1 ? "" : "s"}`)}</span>
      </div>
      <div class="daily-order-group-list">
        ${orders.map((order) => `
          <article class="daily-order-row internal-order-row editable" data-batch-id="${escapeHtml(order.id)}">
            <div class="internal-order-header">
              <div>
                <strong>${escapeHtml(`${order.lines.length} item(s) / ${order.status}`)}</strong>
                <span>${escapeHtml(order.requestedAt ? new Date(order.requestedAt).toLocaleString() : "")}</span>
              </div>
              <div class="status-chip-row">
                <span class="status-chip ${order.status === "ready" ? "today" : order.status === "partial" ? "high" : "older"}">${escapeHtml(order.status)}</span>
              </div>
            </div>
            <div class="internal-order-lines">
              ${order.lines.map((line) => {
                const savedDraft = internalDrafts.get(order.id)?.get(line.id) || {};
                const quantity = savedDraft.quantityItems ?? line.requestedItemQuantity;
                const removeRequested = Boolean(savedDraft.removeRequested);
                return `
                  <div class="internal-order-line${removeRequested ? " remove-requested" : ""}" data-line-id="${escapeHtml(line.id)}">
                    <div class="internal-order-line-main">
                      <strong>${escapeHtml(line.itemName)}</strong>
                      <span>${escapeHtml([line.category, line.inventoryArea, line.storageLocation, line.shelfCode].filter(Boolean).join(" / "))}</span>
                      <small>Requested ${escapeHtml(quantity)} item(s) / picked ${escapeHtml(line.pickedItemQuantity)} / current about ${escapeHtml(line.currentStockItems)} item(s)</small>
                    </div>
                    <label class="internal-order-line-qty">
                      Qty
                      <input class="internal-line-qty-input" type="number" min="1" step="1" value="${escapeHtml(quantity)}">
                    </label>
                    <label class="check-label internal-order-line-remove">
                      <input class="internal-line-remove-input" type="checkbox" ${removeRequested ? "checked" : ""}>
                      Remove line
                    </label>
                  </div>
                `;
              }).join("")}
            </div>
            <div class="daily-order-actions internal-order-actions">
              <button class="deliver-order-button save-internal-order" type="button">Save changes</button>
              <button class="delete-order-button remove-internal-order" type="button">Remove order</button>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}
