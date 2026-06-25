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
  recentRequests,
  requestUser,
  matchesDashboardOwnerFilter,
  matchesDashboardStatusFilter,
  sameUser,
  sessionUser,
  dashboardStatusFilter,
  dashboardOwnerFilter,
  today
}) {
  if (!dashboardCards || !dashboardMode) return;
  dashboardMode.textContent = displayRoleMode();
  const requests = Array.isArray(recentRequests) ? recentRequests : [];
  const openCount = requests
    .filter((request) => matchesDashboardOwnerFilter(request, { dashboardOwnerFilter, sessionUser }))
    .filter((request) => matchesDashboardStatusFilter(request, { dashboardStatusFilter: "open", today }))
    .length;
  const closedCount = requests
    .filter((request) => matchesDashboardOwnerFilter(request, { dashboardOwnerFilter, sessionUser }))
    .filter((request) => matchesDashboardStatusFilter(request, { dashboardStatusFilter: "closed", today }))
    .length;
  const mineCount = requests
    .filter((request) => matchesDashboardStatusFilter(request, { dashboardStatusFilter, today }))
    .filter((request) => matchesDashboardOwnerFilter(request, { dashboardOwnerFilter: "mine", sessionUser }))
    .length;
  const allCount = requests
    .filter((request) => matchesDashboardStatusFilter(request, { dashboardStatusFilter, today }))
    .length;
  const nextStatus = dashboardStatusFilter === "open" ? "closed" : "open";
  const nextOwner = dashboardOwnerFilter === "mine" ? "all" : "mine";

  dashboardCards.innerHTML = `
    <button class="dashboard-card dashboard-filter-card active" type="button" data-dashboard-status-filter="${escapeHtml(nextStatus)}" aria-pressed="true">
      <strong>${escapeHtml(dashboardStatusFilter === "open" ? openCount : closedCount)}</strong>
      <span>${escapeHtml(dashboardStatusFilter === "open" ? "Open Items" : "Closed Items")}</span>
      <small>${escapeHtml(dashboardStatusFilter === "open" ? "Click to show completed, closed, and delivered items" : "Click to show not closed, scheduled, and 2Deliver items")}</small>
    </button>
    <button class="dashboard-card dashboard-filter-card active" type="button" data-dashboard-owner-filter="${escapeHtml(nextOwner)}" aria-pressed="true">
      <strong>${escapeHtml(dashboardOwnerFilter === "mine" ? mineCount : allCount)}</strong>
      <span>${escapeHtml(dashboardOwnerFilter === "mine" ? "My Orders" : "All Users Orders")}</span>
      <small>${escapeHtml(dashboardOwnerFilter === "mine" ? "Click to show all users orders for the current status" : "Click to show only your orders for the current status")}</small>
    </button>
  `;
}
