import {
  buildOrderJumpHref,
  displayRoleMode,
  isDashboardOpenRequest,
  formatUserDisplay,
  isOperationalRole,
  matchesDashboardOwnerFilter,
  matchesDashboardStatusFilter,
  populateDailyAreaFilter,
  populateDailyUserFilter,
  renderPushStatus,
  requestCategory,
  requesterMatches,
  sameUser,
  selectedFilterValue,
  todayLocal
} from "./helpers.js";
import { logicalRequestCompare } from "../ordering/request-grouping.js";
import {
  isOpenAttentionRequest,
  isOlderOpenRequest,
  isStandingOrder as isStandingOrderRequest,
  requestArea as resolveRequestArea,
  requestDay,
  requestLocation as resolveRequestLocation,
  requestStatusChips,
  requestUser
} from "../ordering/request-status.js";
import {
  renderDailyOrder,
  renderNotifications,
  renderOpenOrders,
  renderStandingOrders
} from "../dashboard-render.js";
import {
  applyAuthenticatedShell,
  applyLoggedOutShell,
  persistKitchenSession,
  readKitchenSession
} from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";
import { bindAuthenticatedBootstrap } from "/session-bootstrap.js";

export function initDashboardPage() {
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
  const message = document.querySelector("#message");

  const initialSession = readKitchenSession();
  let allItems = [];
  let recentRequests = [];
  let standingOrders = [];
  let notifications = [];
  let summary = null;
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
  let sessionRole = initialSession.role;
  let sessionPermissions = initialSession.permissions;
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
    const saved = persistKitchenSession(data, {
      currentToken: sessionToken,
      applyTheme: window.applyKitchenTheme,
      setupPush: window.setupKitchenPush
    });
    sessionToken = saved.token;
    sessionUser = saved.user;
    sessionRole = saved.role;
    sessionPermissions = saved.permissions;
  }

  function showApp() {
    applyAuthenticatedShell({
      loginScreen,
      currentUser,
      sessionUser,
      formatUserDisplay
    });
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
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
    sessionRole = "user";
    sessionPermissions = {};
  }

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      window.location.href = "/change-password.html";
    }
  });

  function renderAll() {
    const today = todayLocal();
    renderNotifications({
      notificationList,
      notificationCount,
      notificationPanel,
      readAllNotificationsButton,
      notifications
    });
    renderDailyOrder({
      dailyOrderCount,
      dailyOrderList,
      recentRequests,
      selectedArea: selectedFilterValue(dailyAreaFilter),
      requestArea,
      requesterMatches: (request) => requesterMatches(request, { dailyScopeFilter, dailyUserFilter, sessionUser }),
      dashboardStatusFilter: "open",
      matchesDashboardOwnerFilter: (request) => matchesDashboardOwnerFilter(request, { dashboardOwnerFilter: "all", sessionUser }),
      matchesDashboardStatusFilter,
      requestDay,
      today,
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
      dashboardStatusFilter: "open",
      matchesDashboardOwnerFilter: (request) => matchesDashboardOwnerFilter(request, { dashboardOwnerFilter: "all", sessionUser }),
      matchesDashboardStatusFilter,
      isOpenAttentionRequest,
      isOlderOpenRequest,
      today,
      logicalRequestCompare: (left, right) => logicalRequestCompare(left, right, allItems),
      allItems,
      requestDay,
      requestCategory: (request) => requestCategory(request, allItems),
      requestLocation,
      requestStatusChips: (request, currentToday) => requestStatusChips(request, sessionUser, currentToday),
      buildOrderJumpHref: (request) => buildOrderJumpHref(request, allItems),
      overdueRowClass: (request, currentToday) => isOlderOpenRequest(request, currentToday) ? "overdue-order-row" : ""
    });
    renderStandingOrders({
      standingOrderCount,
      standingOrderList,
      standingOrders,
      isOperationalRole: isOperationalRole(sessionPermissions),
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
    summary = data.summary || null;
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

  bindKitchenLogin({
    loginForm,
    usernameInput,
    passwordInput,
    setLoginMessage,
    onSuccess: async (data) => {
      saveSession(data);
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      passwordInput.value = "";
      setLoginMessage("");
      showApp();
      await refresh();
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
    renderPushStatus(enablePushButton, event.detail || {});
  });

  bindAuthenticatedBootstrap({
    hasSession: () => Boolean(sessionToken && sessionUser),
    showApp: () => {
      showApp();
      renderPushStatus(enablePushButton, window.kitchenPushStatus || {});
    },
    showLogin,
    load: refresh,
    onError: (error) => setMessage(error.message, true)
  });
}
