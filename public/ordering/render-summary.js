import { escapeHtml } from "./shared.js";
import { renderStatusChips, formatNotificationDate } from "./render-shared.js";
import { groupRequestsByCategory, itemNameFromRequest, logicalRequestCompare } from "./request-grouping.js";
import { isOlderOpenRequest, requestStatusChips, isStandingOrder } from "./request-status.js";

export function renderOrderingSummary({
  orderingSummaryCards,
  orderingMode,
  displayRoleMode,
  orderingSummary,
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
  const summaryCounts = orderingSummary?.ordering || {};

  const summary = [
    ["Saved by me", selected.size, "Items you are actively editing right now", "saved"],
    ["My open", Number(summaryCounts.mine || 0), "Still open with your name on them", "mine"],
    ["Team open", Number(summaryCounts.team || 0), "Open lines from everybody else", "team"],
    ["Older open", Number(summaryCounts.older || 0), "Still waiting from previous days", "older"],
    ["Below minimum", Number(summaryCounts.below || 0), "Items already below their minimum", "below"],
    ["Standing due", Number(summaryCounts.standing || 0), "Standing orders due now or overdue", "standing"]
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
  sessionUser,
  isOlderOpenRequest
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
                <tr class="${request.partialReceipt ? "receiving-origin-partial" : (isOlderOpenRequest(request, today) ? "driver-overdue-row" : "")}" data-request-id="${escapeHtml(request.id)}" data-item-id="${escapeHtml(request.itemId)}" data-jump-category="${escapeHtml(categoryName)}">
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
