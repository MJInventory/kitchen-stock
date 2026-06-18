import {
  buildOrderJumpHref,
  displayRoleMode,
  isOperationalRole,
  itemForRequest,
  populateDailyAreaFilter,
  populateDailyUserFilter,
  renderPushStatus,
  requestCategory,
  requesterMatches,
  requestMatchesDashboardFilter,
  sameUser,
  selectedFilterValue,
  todayLocal
} from "./dashboard/helpers.js";
import { logicalRequestCompare } from "./ordering/request-grouping.js";
import {
  isOlderOpenRequest,
  isStandingOrder as isStandingOrderRequest,
  requestArea as resolveRequestArea,
  requestDay,
  requestLocation as resolveRequestLocation,
  requestStatusChips,
  requestUser
} from "./ordering/request-status.js";
import {
  renderDailyOrder,
  renderDashboardCards,
  renderNotifications,
  renderOpenOrders,
  renderStandingOrders
} from "./dashboard-render.js";

const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const featureMenu = document.querySelector("#featureMenu");
const backofficeMenu = document.querySelector("#backofficeMenu");
const dailyScopeFilter = document.querySelector("#dailyScopeFilter");
const dailyAreaFilter = document.querySelector("#dailyAreaFilter");
const dailyUserFilter = document.querySelector("#dailyUserFilter");
const dailyOrderCount = document.querySelector("#dailyOrderCount");
const dailyOrderList = document.querySelector("#dailyOrderList");
const openOrderCount = document.querySelector("#openOrderCount");
const openOrderList = document.querySelector("#openOrderList");
const standingOrderCount = document.querySelector("#standingOrderCount");
const standingOrderList = document.querySelector("#standingOrderList");
const notificationCount = document.querySelector("#notificationCount");
const notificationList = document.querySelector("#notificationList");
const notificationPanel = document.querySelector(".notification-panel");
const readAllNotificationsButton = document.querySelector("#readAllNotificationsButton");
const enablePushButton = document.querySelector("#enablePushButton");
const dashboardMode = document.querySelector("#dashboardMode");
const dashboardCards = document.querySelector("#dashboardCards");
const message = document.querySelector("#message");

let allItems = [];
let recentRequests = [];
let standingOrders = [];
let notifications = [];
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionRole = localStorage.getItem("kitchenStockRole") || "user";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let dashboardFilter = "all";

function requestArea(request) {
  return resolveRequestArea(request, allItems);
}

function requestLocation(request) {
  return resolveRequestLocation(request, allItems);
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function saveSession(data) {
  sessionToken = data.token || sessionToken;
  sessionUser = data.user.name;
  sessionRole = data.user.role || "user";
  sessionPermissions = data.user.permissions || {};
  localStorage.setItem("kitchenStockToken", sessionToken);
  localStorage.setItem("kitchenStockUser", sessionUser);
  localStorage.setItem("kitchenStockRole", sessionRole);
  localStorage.setItem("kitchenStockPermissions", JSON.stringify(sessionPermissions));
  localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
  window.applyKitchenTheme?.(data.user.theme || "dark");
  window.setupKitchenPush?.();
}

function showApp() {
  loginScreen.hidden = true;
  if (currentUser) {
    currentUser.textContent = formatUserDisplay(sessionUser);
    currentUser.hidden = false;
  }
  window.refreshKitchenMenus?.();
  document.querySelectorAll("[data-permission]").forEach((element) => {
    element.hidden = !sessionPermissions[element.dataset.permission];
  });
  document.querySelectorAll("#featureMenu option[data-permission]").forEach((option) => {
    option.hidden = !sessionPermissions[option.dataset.permission];
    option.disabled = !sessionPermissions[option.dataset.permission];
  });
  if (featureMenu) featureMenu.value = "/";
}

function showLogin() {
  loginScreen.hidden = false;
  if (currentUser) {
    currentUser.textContent = "";
    currentUser.hidden = true;
  }
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
  localStorage.removeItem("kitchenStockRole");
  localStorage.removeItem("kitchenStockPermissions");
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    ...options
  });
  const data = await response.json();
  if (response.status === 401) showLogin();
  if (response.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") {
    window.location.href = "/change-password.html";
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}


function renderAll() {
  const today = todayLocal();
  renderNotifications({
    notificationList,
    notificationCount,
    notificationPanel,
    readAllNotificationsButton,
    notifications
  });
  renderDashboardCards({
    dashboardCards,
    dashboardMode,
    displayRoleMode: () => displayRoleMode(sessionRole),
    isOperationalRole: () => isOperationalRole(sessionPermissions),
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
  });
  renderDailyOrder({
    dailyOrderCount,
    dailyOrderList,
    recentRequests,
    selectedArea: selectedFilterValue(dailyAreaFilter),
    requestArea,
    requesterMatches: (request) => requesterMatches(request, { dailyScopeFilter, dailyUserFilter, sessionUser }),
    requestDay,
    today,
    requestMatchesDashboardFilter: (request, currentToday) => requestMatchesDashboardFilter(request, { dashboardFilter, allItems, sessionUser, today: currentToday }),
    logicalRequestCompare: (left, right) => logicalRequestCompare(left, right, allItems),
    allItems,
    requestCategory: (request) => requestCategory(request, allItems),
    requestLocation,
    requestStatusChips: (request, currentToday) => requestStatusChips(request, sessionUser, currentToday),
    buildOrderJumpHref: (request) => buildOrderJumpHref(request, allItems)
  });
  renderOpenOrders({
    openOrderCount,
    openOrderList,
    recentRequests,
    selectedArea: selectedFilterValue(dailyAreaFilter),
    requestArea,
    requesterMatches: (request) => requesterMatches(request, { dailyScopeFilter, dailyUserFilter, sessionUser }),
    isOlderOpenRequest,
    today,
    requestMatchesDashboardFilter: (request, currentToday) => requestMatchesDashboardFilter(request, { dashboardFilter, allItems, sessionUser, today: currentToday }),
    logicalRequestCompare: (left, right) => logicalRequestCompare(left, right, allItems),
    allItems,
    requestDay,
    requestCategory: (request) => requestCategory(request, allItems),
    requestLocation,
    requestStatusChips: (request, currentToday) => requestStatusChips(request, sessionUser, currentToday),
    buildOrderJumpHref: (request) => buildOrderJumpHref(request, allItems)
  });
  renderStandingOrders({
    standingOrderCount,
    standingOrderList,
    standingOrders,
    isOperationalRole: isOperationalRole(),
    dashboardFilter,
    today
  });
}

async function refresh() {
  setMessage("Loading today's orders...");
  const data = await api("/api/bootstrap");
  allItems = data.items || [];
  recentRequests = data.requests || [];
  standingOrders = data.standingOrders || [];
  notifications = data.notifications || [];
  populateDailyAreaFilter({ dailyAreaFilter, recentRequests, requestArea });
  populateDailyUserFilter({ dailyUserFilter, recentRequests, sessionUser, sessionPermissions });
  renderAll();
  setMessage("");
}

async function markNotificationsRead(ids = []) {
  const data = await api("/api/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  notifications = data.notifications || [];
  renderAll();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginMessage("Logging in...");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not log in.");
    saveSession(data);
    if (data.user.mustChangePassword) {
      window.location.href = "/change-password.html";
      return;
    }
    passwordInput.value = "";
    setLoginMessage("");
    showApp();
    await refresh();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

dashboardCards?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-dashboard-filter]");
  if (!card?.dataset.dashboardFilter) return;
  dashboardFilter = card.dataset.dashboardFilter;
  renderAll();
  if (dashboardFilter === "unread" && notificationPanel) {
    notificationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

logoutButton?.addEventListener("click", showLogin);
refreshButton?.addEventListener("click", () => refresh().catch((error) => setMessage(error.message, true)));
dailyScopeFilter?.addEventListener("change", () => {
  if (dailyScopeFilter.value === "__mine__") dailyUserFilter.value = "__mine__";
  else if (dailyScopeFilter.value === "__team__" && dailyUserFilter.value === "__mine__") dailyUserFilter.value = "";
  renderAll();
});
dailyAreaFilter?.addEventListener("change", renderAll);
dailyUserFilter?.addEventListener("change", renderAll);
[featureMenu, backofficeMenu].forEach((menu) => menu?.addEventListener("change", (event) => {
  if (event.target.value) window.location.href = event.target.value;
}));

notificationList?.addEventListener("click", (event) => {
  const button = event.target.closest(".mark-notification-read");
  if (!button) return;
  const row = button.closest("[data-notification-id]");
  if (!row?.dataset.notificationId) return;
  button.disabled = true;
  markNotificationsRead([row.dataset.notificationId]).catch((error) => {
    setMessage(error.message, true);
    button.disabled = false;
  });
});

readAllNotificationsButton?.addEventListener("click", () => {
  readAllNotificationsButton.disabled = true;
  markNotificationsRead().catch((error) => {
    setMessage(error.message, true);
  }).finally(() => {
    readAllNotificationsButton.disabled = false;
  });
});

enablePushButton?.addEventListener("click", () => {
  enablePushButton.disabled = true;
  Promise.resolve(window.enableKitchenPush?.())
    .catch((error) => setMessage(error.message || "Could not enable phone notifications.", true))
    .finally(() => {
      window.setTimeout(() => {
        enablePushButton.disabled = false;
      }, 600);
    });
});

window.addEventListener("kitchen-push-status", (event) => {
  renderPushStatus(event.detail || {});
});

if (sessionToken && sessionUser) {
  showApp();
  renderPushStatus(enablePushButton, window.kitchenPushStatus || {});
  refresh().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
