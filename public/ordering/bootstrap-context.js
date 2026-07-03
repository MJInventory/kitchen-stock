import { readKitchenSession } from "/session-shell.js";

export function createOrderingBootstrapContext({
  window = globalThis.window,
  document = globalThis.document,
  localStorage = globalThis.localStorage
} = {}) {
  const refs = {
    loginScreen: document.querySelector("#loginScreen"),
    loginForm: document.querySelector("#loginForm"),
    usernameInput: document.querySelector("#usernameInput"),
    passwordInput: document.querySelector("#passwordInput"),
    loginMessage: document.querySelector("#loginMessage"),
    currentUser: document.querySelector("#currentUser"),
    areaFilter: document.querySelector("#areaFilter"),
    locationFilter: document.querySelector("#locationFilter"),
    refreshButton: document.querySelector("#refreshButton"),
    submitButton: document.querySelector("#submitButton"),
    featureMenu: document.querySelector("#featureMenu"),
    backofficeMenu: document.querySelector("#backofficeMenu"),
    searchInput: document.querySelector("#searchInput"),
    requestScopeFilter: document.querySelector("#requestScopeFilter"),
    selectedChips: document.querySelector("#selectedChips"),
    categoryView: document.querySelector("#categoryView"),
    categoryGrid: document.querySelector("#categoryGrid"),
    productView: document.querySelector("#productView"),
    productList: document.querySelector("#productList"),
    categoryTitle: document.querySelector("#categoryTitle"),
    categoryMeta: document.querySelector("#categoryMeta"),
    backButton: document.querySelector("#backButton"),
    dailyOrderCount: document.querySelector("#dailyOrderCount"),
    dailyOrderList: document.querySelector("#dailyOrderList"),
    standingOrderCount: document.querySelector("#standingOrderCount"),
    standingOrderList: document.querySelector("#standingOrderList"),
    notificationCount: document.querySelector("#notificationCount"),
    notificationList: document.querySelector("#notificationList"),
    notificationPanel: document.querySelector(".notification-panel"),
    readAllNotificationsButton: document.querySelector("#readAllNotificationsButton"),
    orderingMode: document.querySelector("#orderingMode"),
    orderingSummaryCards: document.querySelector("#orderingSummaryCards"),
    message: document.querySelector("#message")
  };

  const pageParams = new URLSearchParams(window.location.search);
  const session = readKitchenSession(localStorage);

  const state = {
    allItems: [],
    recentRequests: [],
    standingOrders: [],
    notifications: [],
    summary: null,
    activeCategory: "",
    selected: new Map(),
    sessionToken: session.token,
    sessionUser: session.user,
    sessionRole: session.role,
    sessionPermissions: session.permissions,
    orderingSummaryFilter: "all",
    bootstrapCacheKey: "kitchenStockOrderingBootstrap",
    pendingJumpItemId: String(pageParams.get("itemId") || "").trim(),
    pendingJumpCategory: String(pageParams.get("category") || "").trim(),
    pendingJumpRequestId: String(pageParams.get("requestId") || "").trim(),
    focusedRequestId: String(pageParams.get("requestId") || "").trim()
  };

  return {
    refs,
    state,
    pageParams
  };
}
