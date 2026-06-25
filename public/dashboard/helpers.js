import {
  escapeHtml,
  formatUserDisplay,
  sameUser,
  todayLocal
} from "../ordering/shared.js";
import {
  isOpenAttentionRequest,
  isOlderOpenRequest,
  isStandingOrder as isStandingOrderRequest,
  requestDay,
  requestUser
} from "../ordering/request-status.js";

export { escapeHtml, formatUserDisplay, sameUser, todayLocal };

export function itemForRequest(request, allItems) {
  return allItems.find((item) => item.id === request?.itemId) || null;
}

export function requestCategory(request, allItems) {
  return itemForRequest(request, allItems)?.category || request?.category || "";
}

export function isOperationalRole(sessionPermissions) {
  return Boolean(sessionPermissions.canAddInventoryItems || sessionPermissions.canAdminUsers);
}

export function displayRoleMode(sessionRole) {
  if (sessionRole === "god") return "God view";
  if (sessionRole === "admin") return "Admin view";
  if (sessionRole === "power-user") return "Power user view";
  return "Team view";
}

export function selectedFilterValue(element) {
  return String(element?.value || "").trim();
}

export function buildOrderJumpHref(request, allItems) {
  const item = itemForRequest(request, allItems);
  const params = new URLSearchParams();
  if (request?.itemId) params.set("itemId", String(request.itemId));
  if (item?.category || requestCategory(request, allItems)) params.set("category", item?.category || requestCategory(request, allItems));
  return `/ordering.html?${params.toString()}`;
}

export function populateDailyAreaFilter({ dailyAreaFilter, recentRequests, requestArea }) {
  if (!dailyAreaFilter) return;
  const areas = [...new Set(recentRequests.map((request) => requestArea(request)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const selected = selectedFilterValue(dailyAreaFilter);
  dailyAreaFilter.innerHTML = [
    '<option value="">All Areas</option>',
    ...areas.map((area) => `<option value="${escapeHtml(area)}"${area === selected ? " selected" : ""}>${escapeHtml(area)}</option>`)
  ].join("");
  dailyAreaFilter.value = areas.includes(selected) ? selected : "";
}

export function populateDailyUserFilter({
  dailyUserFilter,
  recentRequests,
  sessionUser,
  sessionPermissions
}) {
  if (!dailyUserFilter) return;
  const users = [...new Set(recentRequests.map((request) => requestUser(request)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  const selected = selectedFilterValue(dailyUserFilter);
  const defaultSelection = !selected && !isOperationalRole(sessionPermissions) ? "__mine__" : selected;
  dailyUserFilter.innerHTML = [
    '<option value="">All Users</option>',
    `<option value="__mine__"${defaultSelection === "__mine__" ? " selected" : ""}>My Orders</option>`,
    ...users.map((user) => `<option value="${escapeHtml(user)}"${user === defaultSelection ? " selected" : ""}>${escapeHtml(formatUserDisplay(user))}</option>`)
  ].join("");
  dailyUserFilter.value = defaultSelection === "__mine__" || users.includes(defaultSelection) ? defaultSelection : "";
}

export function requesterMatches(request, { dailyScopeFilter, dailyUserFilter, sessionUser }) {
  const scope = selectedFilterValue(dailyScopeFilter);
  if (scope === "__mine__") return sameUser(requestUser(request), sessionUser);
  if (scope === "__team__") return !sameUser(requestUser(request), sessionUser);
  const selectedUser = selectedFilterValue(dailyUserFilter);
  if (!selectedUser) return true;
  if (selectedUser === "__mine__") return sameUser(requestUser(request), sessionUser);
  return sameUser(requestUser(request), selectedUser);
}

export function matchesDashboardOwnerFilter(request, { dashboardOwnerFilter, sessionUser }) {
  if (dashboardOwnerFilter === "mine") return sameUser(requestUser(request), sessionUser);
  return true;
}

export function isDashboardClosedRequest(request, today = todayLocal()) {
  const status = String(request?.status || "").trim().toLowerCase();
  if (Boolean(request?.delivered) || Boolean(request?.received)) return true;
  return status === "completed" || status === "closed" || status === "fulfilled" || status === "delivered";
}

export function isDashboardOpenRequest(request, today = todayLocal()) {
  if (isDashboardClosedRequest(request, today)) return false;
  const status = String(request?.status || "").trim().toLowerCase();
  if (status.includes("not closed")) return true;
  if (status === "scheduled" || status === "open") return true;
  if (Boolean(request?.toDeliver)) return true;
  return true;
}

export function matchesDashboardStatusFilter(request, { dashboardStatusFilter, today = todayLocal() }) {
  if (dashboardStatusFilter === "closed") return isDashboardClosedRequest(request, today);
  return isDashboardOpenRequest(request, today);
}

export function renderPushStatus(enablePushButton, detail = {}) {
  if (!enablePushButton) return;
  const supported = Boolean(detail.supported);
  const enabled = Boolean(detail.enabled);
  const subscribed = Boolean(detail.subscribed);
  const permission = detail.permission || "default";
  const shouldShow = supported && enabled && (!subscribed || permission !== "granted");
  enablePushButton.hidden = !shouldShow;
  enablePushButton.disabled = permission === "denied";
  if (permission === "denied") enablePushButton.textContent = "Notifications blocked in browser";
  else if (subscribed) enablePushButton.textContent = "Phone notifications enabled";
  else enablePushButton.textContent = "Enable phone notifications";
}
