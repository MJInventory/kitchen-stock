import { escapeHtml } from "./shared.js";
import { groupRequestsByCategory, itemCategory, itemNameFromRequest, logicalRequestCompare } from "./request-grouping.js";
import { isOlderOpenRequest, requestStatusChips, requestUser, isStandingOrder } from "./request-status.js";

function formatNotificationDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderStatusChips(chips = []) {
  if (!chips.length) return "";
  return `<div class="status-chip-row">${chips.map(([label, tone]) => `<span class="status-chip ${tone}">${escapeHtml(label)}</span>`).join("")}</div>`;
}

export function renderOrderingSummary({
  orderingSummaryCards,
  orderingMode,
  displayRoleMode,
  today,
  recentRequests,
  selected,
  sessionUser,
  sameUser,
  allItems,
  standingOrders,
  isStandingDue,
  orderingSummaryFilter
}) {
  if (!orderingSummaryCards || !orderingMode) return;
  orderingMode.textContent = displayRoleMode();
  const unresolved = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !isStandingOrder(request));

  const summary = [
    ["Saved by me", selected.size, "Items you are actively editing right now", "saved"],
    ["My open", unresolved.filter((request) => sameUser(requestUser(request), sessionUser)).length, "Still open with your name on them", "mine"],
    ["Team open", unresolved.filter((request) => !sameUser(requestUser(request), sessionUser)).length, "Open lines from everybody else", "team"],
    ["Older open", unresolved.filter((request) => isOlderOpenRequest(request, today)).length, "Still waiting from previous days", "older"],
    ["Below minimum", allItems.filter((item) => Number(item.quantity || 0) < Number(item.minimum || 0)).length, "Items already below their minimum", "below"],
    ["Standing due", standingOrders.filter((order) => isStandingDue(order, today)).length, "Standing orders due now or overdue", "standing"]
  ];

  orderingSummaryCards.innerHTML = summary
    .filter(([, value, , filterKey]) => Number(value || 0) > 0 || orderingSummaryFilter === filterKey)
    .map(([label, value, hint, filterKey]) => `
    <button class="dashboard-card dashboard-filter-card${orderingSummaryFilter === filterKey ? " active" : ""}" type="button" data-ordering-filter="${escapeHtml(filterKey)}" aria-pressed="${orderingSummaryFilter === filterKey ? "true" : "false"}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(hint)}</small>
    </button>
  `).join("");

  if (!orderingSummaryCards.innerHTML) {
    orderingSummaryCards.innerHTML = '<p class="empty-sheet">Nothing needs attention right now.</p>';
  }
}

export function renderSelectedChips({ selectedChips, selected, entryUnit }) {
  selectedChips.innerHTML = [...selected.values()]
    .slice(0, 12)
    .map((entry) => `
      <button class="selected-chip" type="button" data-remove-id="${entry.item.id}">
        <span>${escapeHtml(entry.item.name)}</span>
        <small>${entry.quantity} ${escapeHtml(entryUnit(entry))}</small>
      </button>
    `)
    .join("");
}

export function renderNotifications({
  notificationList,
  notificationCount,
  notificationPanel,
  readAllNotificationsButton,
  notifications
}) {
  if (!notificationList || !notificationCount) return;
  const unread = notifications.filter((note) => !note.isRead);
  if (notificationPanel) notificationPanel.hidden = unread.length === 0;
  notificationCount.textContent = `${unread.length} unread`;
  if (readAllNotificationsButton) readAllNotificationsButton.disabled = unread.length === 0;
  if (!unread.length) {
    notificationList.innerHTML = "";
    return;
  }
  notificationList.innerHTML = unread
    .slice(0, 20)
    .map((note) => `
      <article class="notification-row" data-notification-id="${escapeHtml(note.id)}">
        <div>
          <strong>${escapeHtml(note.title || "Notification")}</strong>
          <span>${escapeHtml(note.body || "")}</span>
          <small>${escapeHtml(formatNotificationDate(note.createdAt))}</small>
        </div>
        <button class="icon-button mark-notification-read" type="button">Mark read</button>
      </article>
    `)
    .join("");
}

export function renderDailyOrder({
  dailyOrderCount,
  dailyOrderList,
  today,
  recentRequests,
  hasValidRequestItemId,
  requestMatchesScope,
  orderingRequestMatchesSummary,
  allItems,
  sameUser,
  sessionPermissions,
  sessionUser
}) {
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !isStandingOrder(request))
    .filter(hasValidRequestItemId)
    .filter(requestMatchesScope)
    .filter((request) => orderingRequestMatchesSummary(request, today))
    .sort(logicalRequestCompare);
  dailyOrderCount.textContent = `${activeRequests.length} active`;
  const grouped = groupRequestsByCategory(activeRequests.slice(0, 100), allItems);
  dailyOrderList.innerHTML = grouped
    .map(([categoryName, categoryRequests]) => `
      <section class="sheet-group">
        <div class="driver-supplier">
          <div class="driver-supplier-title">
            <h3>${escapeHtml(categoryName)}</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Remove</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              ${categoryRequests.map((request) => `
                <tr data-request-id="${escapeHtml(request.id)}" data-item-id="${escapeHtml(request.itemId)}" data-jump-category="${escapeHtml(categoryName)}">
                  <td><button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Received</button></td>
                  <td>${sessionPermissions.canDeleteAnyOrder || sameUser(request.requestedBy, sessionUser) ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Remove</button>` : ""}</td>
                  <td>
                    <button class="order-sheet-item-link" type="button" data-jump-item-id="${escapeHtml(request.itemId)}" data-jump-category="${escapeHtml(categoryName)}">${escapeHtml(itemNameFromRequest(request, allItems))}</button>
                    ${renderStatusChips(requestStatusChips(request, sessionUser, today))}
                  </td>
                  <td>${escapeHtml(request.quantity)}</td>
                  <td>${escapeHtml(request.unit || "item")}</td>
                  <td>${escapeHtml(request.urgency || "Medium")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `)
    .join("");

  if (!dailyOrderList.innerHTML) {
    dailyOrderList.innerHTML = '<p class="empty-sheet">No active orders yet.</p>';
  }
}

export function renderStandingOrders({ standingOrderCount, standingOrderList, standingOrders }) {
  standingOrderCount.textContent = `${standingOrders.length} scheduled`;
  if (!standingOrders.length) {
    standingOrderList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    return;
  }
  standingOrderList.innerHTML = standingOrders
    .slice(0, 100)
    .map((order) => `
      <a class="daily-order-row daily-order-link" href="/standing-orders.html?orderId=${encodeURIComponent(order.id)}">
        <div>
          <strong>${escapeHtml(order.supplierName || order.name || "Standing Order")}</strong>
          <span>${escapeHtml([
            order.expectedDate ? `Delivery ${order.expectedDate}` : "",
            order.schedule || "",
            order.items?.length ? `${order.items.length} item(s)` : ""
          ].filter(Boolean).join(" / "))}</span>
        </div>
      </a>
    `)
    .join("");
}

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
              Stock
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
