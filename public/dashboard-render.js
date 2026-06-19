import { escapeHtml, formatNotificationDate } from "./dashboard/render-shared.js";
export { renderDailyOrder, renderOpenOrders, renderStandingOrders } from "./dashboard/render-orders.js";

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
  dashboardSummary,
  recentRequests,
  requestUser,
  sameUser,
  sessionUser,
  requestDay,
  today,
  isStandingOrderRequest,
  isOpenAttentionRequest,
  isOlderOpenRequest,
  allItems,
  standingOrders,
  notifications,
  dashboardFilter
}) {
  if (!dashboardCards || !dashboardMode) return;
  dashboardMode.textContent = displayRoleMode();
  const unresolved = recentRequests.filter((request) => !request.received && request.status !== "Fulfilled");
  const myOpen = dashboardSummary?.dashboard?.mine ?? unresolved.filter((request) => sameUser(requestUser(request), sessionUser)).length;
  const teamToday = dashboardSummary?.dashboard?.today ?? unresolved.filter((request) => requestDay(request) === today && !isStandingOrderRequest(request)).length;
  const olderOpen = dashboardSummary?.dashboard?.older ?? unresolved.filter((request) => isOpenAttentionRequest(request, today)).length;
  const belowMin = dashboardSummary?.dashboard?.below ?? allItems.filter((item) => Number(item.quantity || 0) < Number(item.minimum || 0)).length;
  const standingDue = dashboardSummary?.dashboard?.standing ?? standingOrders.filter((order) => {
    const expected = String(order.expectedDate || "").trim();
    return expected && expected <= today;
  }).length;
  const unread = dashboardSummary?.dashboard?.unread ?? notifications.filter((note) => !note.isRead).length;

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
