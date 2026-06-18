import { escapeHtml } from "./ordering/shared.js";
import {
  groupRequestsByCategory,
  itemNameFromRequest
} from "./ordering/request-grouping.js";

function formatNotificationDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderStatusChips(chips = []) {
  return `<div class="status-chip-row">${chips.map(([label, tone]) => `<span class="status-chip ${tone}">${escapeHtml(label)}</span>`).join("")}</div>`;
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

export function renderDashboardCards({
  dashboardCards,
  dashboardMode,
  displayRoleMode,
  isOperationalRole,
  recentRequests,
  requestUser,
  sameUser,
  sessionUser,
  requestDay,
  today,
  isStandingOrderRequest,
  isOlderOpenRequest,
  allItems,
  standingOrders,
  notifications,
  dashboardFilter
}) {
  if (!dashboardCards || !dashboardMode) return;
  dashboardMode.textContent = displayRoleMode();
  const unresolved = recentRequests.filter((request) => !request.received && request.status !== "Fulfilled");
  const myOpen = unresolved.filter((request) => sameUser(requestUser(request), sessionUser)).length;
  const teamToday = unresolved.filter((request) => requestDay(request) === today && !isStandingOrderRequest(request)).length;
  const olderOpen = unresolved.filter((request) => isOlderOpenRequest(request, today)).length;
  const belowMin = allItems.filter((item) => Number(item.quantity || 0) < Number(item.minimum || 0)).length;
  const standingDue = standingOrders.filter((order) => {
    const expected = String(order.expectedDate || "").trim();
    return expected && expected <= today;
  }).length;
  const unread = notifications.filter((note) => !note.isRead).length;

  const cards = isOperationalRole()
    ? [
      ["Today active", teamToday, "Open order lines still waiting today", "today"],
      ["My open", myOpen, "Items with your name still open", "mine"],
      ["Older open", olderOpen, "Still waiting from previous days", "older"],
      ["Below minimum", belowMin, "Inventory items currently under minimum", "below"],
      ["Standing due", standingDue, "Standing orders due now or overdue", "standing"],
      ["Unread", unread, "Notifications waiting for action", "unread"]
    ]
    : [
      ["My open", myOpen, "Items you still have open", "mine"],
      ["Today active", teamToday, "Open order lines still waiting today", "today"],
      ["Older open", olderOpen, "Still waiting from previous days", "older"],
      ["Unread", unread, "Notifications waiting for you", "unread"]
    ];

  dashboardCards.innerHTML = cards
    .filter(([, value, , filterKey]) => Number(value || 0) > 0 || dashboardFilter === filterKey)
    .map(([label, value, hint, filterKey]) => `
    <button class="dashboard-card dashboard-filter-card${dashboardFilter === filterKey ? " active" : ""}" type="button" data-dashboard-filter="${escapeHtml(filterKey)}" aria-pressed="${dashboardFilter === filterKey ? "true" : "false"}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(hint)}</small>
    </button>
  `).join("");

  if (!dashboardCards.innerHTML) {
    dashboardCards.innerHTML = '<p class="empty-sheet">Nothing needs attention right now.</p>';
  }
}

export function renderDailyOrder({
  dailyOrderCount,
  dailyOrderList,
  recentRequests,
  selectedArea,
  requestArea,
  requesterMatches,
  requestDay,
  today,
  requestMatchesDashboardFilter,
  logicalRequestCompare,
  allItems,
  requestCategory,
  requestLocation,
  requestStatusChips,
  buildOrderJumpHref
}) {
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !String(request?.requestedBy || "").toLowerCase().includes("standing order"))
    .filter((request) => !selectedArea || requestArea(request) === selectedArea)
    .filter(requesterMatches)
    .filter((request) => requestDay(request) === today)
    .filter((request) => requestMatchesDashboardFilter(request, today))
    .sort(logicalRequestCompare);
  dailyOrderCount.textContent = `${activeRequests.length} active`;
  const grouped = groupRequestsByCategory(activeRequests.slice(0, 100), allItems);
  dailyOrderList.innerHTML = grouped
    .map(([category, requests]) => `
      <section class="daily-order-group">
        <div class="daily-order-group-heading">
          <h3>${escapeHtml(category)}</h3>
          <span>${requests.length} item${requests.length === 1 ? "" : "s"}</span>
        </div>
        <div class="daily-order-group-list">
          ${requests.map((request) => `
            <a class="daily-order-row daily-order-link" href="${escapeHtml(buildOrderJumpHref(request))}">
              <div>
                <strong>${escapeHtml(itemNameFromRequest(request, allItems))}</strong>
                <span>${escapeHtml([
                  request.quantity,
                  requestCategory(request),
                  requestArea(request),
                  requestLocation(request)
                ].filter(Boolean).join(" / "))}</span>
                ${renderStatusChips(requestStatusChips(request, today))}
              </div>
            </a>
          `).join("")}
        </div>
      </section>
    `)
    .join("");

  if (!dailyOrderList.innerHTML) {
    dailyOrderList.innerHTML = '<p class="empty-sheet">No active orders yet.</p>';
  }
}

export function renderOpenOrders({
  openOrderCount,
  openOrderList,
  recentRequests,
  selectedArea,
  requestArea,
  requesterMatches,
  isOlderOpenRequest,
  today,
  requestMatchesDashboardFilter,
  logicalRequestCompare,
  allItems,
  requestDay,
  requestCategory,
  requestLocation,
  requestStatusChips,
  buildOrderJumpHref,
  overdueRowClass = () => ""
}) {
  const openRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !selectedArea || requestArea(request) === selectedArea)
    .filter(requesterMatches)
    .filter((request) => isOlderOpenRequest(request, today))
    .filter((request) => requestMatchesDashboardFilter(request, today))
    .sort(logicalRequestCompare);

  openOrderCount.textContent = `${openRequests.length} open`;
  const grouped = groupRequestsByCategory(openRequests.slice(0, 100), allItems);
  openOrderList.innerHTML = grouped
    .map(([category, requests]) => `
      <section class="daily-order-group">
        <div class="daily-order-group-heading">
          <h3>${escapeHtml(category)}</h3>
          <span>${requests.length} item${requests.length === 1 ? "" : "s"}</span>
        </div>
        <div class="daily-order-group-list">
          ${requests.map((request) => `
              <a class="daily-order-row daily-order-link ${escapeHtml(overdueRowClass(request, today))}" href="${escapeHtml(buildOrderJumpHref(request))}">
                <div>
                  <strong>${escapeHtml(itemNameFromRequest(request, allItems))}</strong>
                  <span>${escapeHtml([
                    request.quantity,
                    requestCategory(request),
                    requestArea(request),
                    requestLocation(request),
                    requestDay(request) ? `Requested ${requestDay(request)}` : ""
                  ].filter(Boolean).join(" / "))}</span>
                  ${renderStatusChips(requestStatusChips(request, today))}
                </div>
              </a>
            `).join("")}
        </div>
      </section>
    `)
    .join("");

  if (!openOrderList.innerHTML) {
    openOrderList.innerHTML = '<p class="empty-sheet">No older open orders.</p>';
  }
}

export function renderStandingOrders({
  standingOrderCount,
  standingOrderList,
  standingOrders,
  isOperationalRole,
  dashboardFilter,
  today
}) {
  const onlyDue = dashboardFilter === "standing";
  const baseOrders = onlyDue
    ? standingOrders.filter((order) => {
      const expected = String(order.expectedDate || "").trim();
      return expected && expected <= today;
    })
    : standingOrders;
  const visibleOrders = isOperationalRole ? baseOrders : baseOrders.slice(0, 6);
  standingOrderCount.textContent = `${standingOrders.length} scheduled`;
  if (!visibleOrders.length) {
    standingOrderList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    return;
  }
  standingOrderList.innerHTML = visibleOrders
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
          ${renderStatusChips([
            ["Standing", "standing"],
            [String(order.expectedDate || "") <= today ? "Due now" : "Scheduled", String(order.expectedDate || "") <= today ? "high" : "today"]
          ])}
        </div>
      </a>
    `)
    .join("");
}
