import { escapeHtml } from "./shared.js";
import { itemCategory } from "./request-grouping.js";
import { renderStatusChips } from "./render-shared.js";

export function renderCategories({
  categoryGrid,
  filterItems,
  selected,
  categoryStats,
  requestOpenStatsForItem
}) {
  const items = filterItems();
  const groups = new Map();

  for (const item of items) {
    const category = itemCategory(item);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  categoryGrid.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, groupItems]) => {
      const stats = categoryStats(category, groupItems);
      const openMine = groupItems.reduce((sum, item) => sum + requestOpenStatsForItem(item.id).mine, 0);
      const openTeam = groupItems.reduce((sum, item) => sum + requestOpenStatsForItem(item.id).team, 0);
      const subtitle = [
        `${groupItems.length} products`,
        stats.chosen ? `${stats.chosen} selected` : "",
        stats.low ? `${stats.low} below min` : "",
        openMine ? `${openMine} my open` : "",
        openTeam ? `${openTeam} team open` : ""
      ].filter(Boolean).join(" / ");
      return `
        <button class="category-card" type="button" data-category="${escapeHtml(category)}">
          <span class="category-open">Open</span>
          <strong>${escapeHtml(category)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </button>
      `;
    })
    .join("");

  if (!categoryGrid.innerHTML) {
    categoryGrid.innerHTML = '<p class="empty-sheet">No products match this search.</p>';
  }
}

export function renderProductList({
  activeCategory,
  categoryTitle,
  categoryMeta,
  backButton,
  productList,
  filterItems,
  hasSearchTerm,
  itemSearchScore,
  selected,
  defaultQuantity,
  itemUnit,
  requestOpenStatsForItem,
  addItemHrefFromSearch,
  sessionPermissions
}) {
  const items = filterItems()
    .filter((item) => !activeCategory || itemCategory(item) === activeCategory);
  const selectedCount = items.filter((item) => selected.has(item.id)).length;

  const searchMode = hasSearchTerm();
  const sortedItems = [...items].sort((a, b) => {
    if (searchMode) {
      const scoreDiff = itemSearchScore(b) - itemSearchScore(a);
      if (scoreDiff) return scoreDiff;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  categoryTitle.textContent = searchMode ? "Search Results" : (activeCategory || "All Products");
  categoryMeta.textContent = `${items.length} products${selectedCount ? ` / ${selectedCount} selected` : ""}`;
  backButton.hidden = searchMode;
  productList.innerHTML = sortedItems
    .map((item) => {
      const entry = selected.get(item.id);
      const checked = Boolean(entry);
      const quantity = entry?.quantity ?? defaultQuantity(item);
      const urgency = entry?.urgency || (Number(item.quantity || 0) < Number(item.minimum || 0) ? "High" : "Medium");
      const lowStock = item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0);
      const hasExistingOrder = Boolean(entry?.requestId);
      const deleteRequested = Boolean(entry?.deleteRequested);
      const openStats = requestOpenStatsForItem(item.id);
      const chips = [];
      if (lowStock) chips.push([`Below min ${item.quantity ?? 0}/${item.minimum ?? 0}`, "critical"]);
      if (openStats.mine) chips.push([`${openStats.mine} my open`, "mine"]);
      if (openStats.team) chips.push([`${openStats.team} team open`, "team"]);
      return `
        <article class="product-row${checked ? " selected" : ""}" data-item-id="${item.id}">
          <button class="product-check" type="button" aria-label="Select ${escapeHtml(item.name)}">${checked ? "&#10003;" : ""}</button>
          <div class="product-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml([
              item.inventoryArea,
              item.storageLocation,
              item.category,
              item.shelfCode
            ].filter(Boolean).join(" / ") || itemCategory(item))}</span>
            <small>${escapeHtml(`Current ${item.quantity ?? 0} ${itemUnit(item)} / Min ${item.minimum ?? 0}`)}</small>
            ${renderStatusChips(chips)}
          </div>
          <div class="product-controls">
            <label class="stock-adjust">
              <span class="stock-adjust-label">Stock</span>
              <input class="stock-input" type="number" min="0" step="0.01" value="${item.quantity ?? 0}">
              <button class="stock-save" type="button">Set</button>
            </label>
            <button class="qty-minus" type="button" aria-label="Decrease">-</button>
            <input class="qty-input" type="number" min="0" step="1" value="${quantity}">
            <button class="qty-plus" type="button" aria-label="Increase">+</button>
            <select class="unit-input" aria-label="Order unit">
              ${["box", "bag", "item", "bottle"].map((unit) => `<option value="${unit}"${unit === (entry?.unit || itemUnit(item)) ? " selected" : ""}>${unit}</option>`).join("")}
            </select>
            <select class="urgency-input" aria-label="Urgency">
              ${["Low", "Medium", "High", "Critical"].map((level) => `<option${level === urgency ? " selected" : ""}>${level}</option>`).join("")}
            </select>
            <button class="row-save-button" type="button">${hasExistingOrder ? "Update" : "Save"}</button>
            ${hasExistingOrder ? `
              <label class="product-delete-toggle">
                <input class="delete-request-input" type="checkbox"${deleteRequested ? " checked" : ""}>
                <span>Delete order</span>
              </label>
            ` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  if (!sortedItems.length) {
    const addButton = hasSearchTerm() && sessionPermissions.canAddInventoryItems
      ? `<a class="button" href="${escapeHtml(addItemHrefFromSearch())}">Add "${escapeHtml(document.querySelector("#searchInput")?.value?.trim() || "")}"</a>`
      : "";
    productList.innerHTML = `
      <div class="empty-sheet empty-sheet-action">
        <p>No products found.</p>
        ${addButton}
      </div>
    `;
  }
}
