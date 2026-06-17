import {
  escapeHtml,
  formatUserDisplay,
  itemMeta,
  itemUnit,
  localDateKey,
  normalize,
  openOrderThresholdDays,
  sameUser,
  searchTokens,
  stockMeta,
  todayLocal
} from "./ordering/shared.js";
import {
  groupRequestsByCategory,
  groupRequestsForOrderSheet,
  itemCategory,
  itemNameFromRequest,
  logicalRequestCompare,
  requestSortValue
} from "./ordering/request-grouping.js";
import {
  displayRoleMode as displayRoleModeValue,
  hasSearchTerm as hasSearchTermValue,
  hasValidRequestItemId,
  isStandingDue as isStandingDueValue,
  orderingItemMatchesSummary as orderingItemMatchesSummaryValue,
  orderingRequestMatchesSummary as orderingRequestMatchesSummaryValue,
  requestMatchesScope as requestMatchesScopeValue,
  requestOpenStatsForItem as requestOpenStatsForItemValue
} from "./ordering/summary-filters.js";
import {
  duplicateSourceLabel,
  expectedDateFromRequest,
  hasFutureScheduledDelivery,
  isAutoMinimumRequest,
  isInternalShortageRequest,
  isOlderOpenRequest,
  isStandingOrder,
  requestArea,
  requestDay,
  requestLocation,
  requestStatusChips,
  requestUser,
  scheduledDeliveryDay
} from "./ordering/request-status.js";
import {
  addItemHrefFromSearchValue,
  buildSelectedFromRequests,
  computeCategoryStats,
  defaultQuantityForItem,
  filterOrderingItems,
  optimisticRequestFromSelection,
  scoreOrderingItemSearch
} from "./ordering/controller-helpers.js";
import {
  applyOrderingBootstrapData,
  loadOrderingBootstrapCache,
  saveOrderingBootstrapCache
} from "./ordering/bootstrap-cache.js";
import {
  deleteDailyOrderAction,
  deliverDailyOrderAction,
  markNotificationsReadAction,
  submitOrderingSelection,
  updateCurrentStockAction
} from "./ordering/controller-actions.js";
import {
  renderCategories as renderCategoriesView,
  renderDailyOrder as renderDailyOrderView,
  renderNotifications as renderNotificationsView,
  renderOrderingSummary as renderOrderingSummaryView,
  renderProductList as renderProductListView,
  renderSelectedChips as renderSelectedChipsView,
  renderStandingOrders as renderStandingOrdersView
} from "./ordering/render.js";
import {
  renderCategoriesBlock,
  renderDailyOrderBlock,
  renderNotificationsBlock,
  renderOrderingPageBlock,
  renderOrderingSummaryBlock,
  renderProductListBlock,
  renderStandingOrdersBlock
} from "./ordering/controller-renderers.js";
import {
  collectSelectedOrderingEntries,
  confirmDuplicateSelectionSave,
  ensureOrderingRowSelection,
  selectOrderingItem,
  syncOrderingProductRow,
  toggleOrderingProduct
} from "./ordering/controller-selection.js";
import {
  refreshOrderingSession,
  saveOrderingSession,
  setUiMessage,
  showOrderingApp,
  showOrderingLogin
} from "./ordering/controller-session.js";
import { attachOrderingInteractions } from "./ordering/interactions.js";

const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const refreshButton = document.querySelector("#refreshButton");
const submitButton = document.querySelector("#submitButton");
const featureMenu = document.querySelector("#featureMenu");
const backofficeMenu = document.querySelector("#backofficeMenu");
const searchInput = document.querySelector("#searchInput");
const requestScopeFilter = document.querySelector("#requestScopeFilter");
const selectedChips = document.querySelector("#selectedChips");
const categoryView = document.querySelector("#categoryView");
const categoryGrid = document.querySelector("#categoryGrid");
const productView = document.querySelector("#productView");
const productList = document.querySelector("#productList");
const categoryTitle = document.querySelector("#categoryTitle");
const categoryMeta = document.querySelector("#categoryMeta");
const backButton = document.querySelector("#backButton");
const dailyOrderCount = document.querySelector("#dailyOrderCount");
const dailyOrderList = document.querySelector("#dailyOrderList");
const standingOrderCount = document.querySelector("#standingOrderCount");
const standingOrderList = document.querySelector("#standingOrderList");
const notificationCount = document.querySelector("#notificationCount");
const notificationList = document.querySelector("#notificationList");
const notificationPanel = document.querySelector(".notification-panel");
const readAllNotificationsButton = document.querySelector("#readAllNotificationsButton");
const orderingMode = document.querySelector("#orderingMode");
const orderingSummaryCards = document.querySelector("#orderingSummaryCards");
const message = document.querySelector("#message");
const pageParams = new URLSearchParams(window.location.search);

let allItems = [];
let recentRequests = [];
let standingOrders = [];
let notifications = [];
let activeCategory = "";
let selected = new Map();
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionRole = localStorage.getItem("kitchenStockRole") || "user";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let orderingSummaryFilter = "all";
const bootstrapCacheKey = "kitchenStockOrderingBootstrap";
let pendingJumpItemId = String(pageParams.get("itemId") || "").trim();
let pendingJumpCategory = String(pageParams.get("category") || "").trim();

function setMessage(text, isError = false) {
  setUiMessage(message, text, isError);
}

function setLoginMessage(text, isError = false) {
  setUiMessage(loginMessage, text, isError);
}

function showApp() {
  showOrderingApp({
    loginScreen,
    sessionPermissions,
    currentUser,
    sessionUser,
    featureMenu,
    backofficeMenu,
    formatUserDisplay,
    windowObject: window,
    documentObject: document
  });
}

function saveSession(data) {
  const nextSession = saveOrderingSession(data, {
    sessionToken,
    localStorageObject: localStorage,
    applyTheme: window.applyKitchenTheme,
    setupPush: window.setupKitchenPush
  });
  sessionToken = nextSession.token;
  sessionUser = nextSession.user;
  sessionRole = nextSession.role;
  sessionPermissions = nextSession.permissions;
}

function showLogin() {
  showOrderingLogin({
    loginScreen,
    currentUser,
    localStorageObject: localStorage
  });
  sessionToken = "";
  sessionUser = "";
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

async function queueApi(path, options = {}, meta = {}) {
  if (!window.kitchenOfflineQueue?.request) return api(path, options);
  return window.kitchenOfflineQueue.request(path, options, {
    allowQueue: true,
    token: sessionToken,
    ...meta
  });
}

async function refreshSession() {
  return refreshOrderingSession({
    api,
    sessionToken,
    saveSession,
    showApp,
    windowObject: window
  });
}

function hasSearchTerm() {
  return hasSearchTermValue(searchInput.value);
}

function selectedRequestScope() {
  return String(requestScopeFilter?.value || "").trim();
}

function requestMatchesScope(request) {
  return requestMatchesScopeValue(request, {
    scope: selectedRequestScope(),
    sessionUser,
    sameUser,
    requestUser
  });
}

function displayRoleMode() {
  return displayRoleModeValue(sessionRole);
}

function requestOpenStatsForItem(itemId) {
  return requestOpenStatsForItemValue(itemId, {
    recentRequests,
    sameUser,
    requestUser,
    sessionUser,
    isStandingOrder
  });
}

function isStandingDue(order, today = todayLocal()) {
  return isStandingDueValue(order, today);
}

function orderingItemMatchesSummary(item, today = todayLocal()) {
  return orderingItemMatchesSummaryValue(item, {
    orderingSummaryFilter,
    today,
    requestOpenStatsForItem,
    selected,
    recentRequests,
    isStandingOrder,
    isOlderOpenRequest,
    standingOrders
  });
}

function orderingRequestMatchesSummary(request, today = todayLocal()) {
  return orderingRequestMatchesSummaryValue(request, {
    orderingSummaryFilter,
    today,
    allItems,
    selected,
    sameUser,
    sessionUser,
    requestUser,
    isOlderOpenRequest
  });
}

function confirmDuplicateSave(entries) {
  return confirmDuplicateSelectionSave(entries, {
    recentRequests,
    requestDay,
    today: todayLocal(),
    isStandingOrder,
    expectedDateFromRequest,
    duplicateSourceLabel,
    windowObject: window
  });
}

function renderOrderingSummary() {
  renderOrderingSummaryBlock({
    renderOrderingSummaryView,
    orderingSummaryCards,
    orderingMode,
    displayRoleMode,
    today: todayLocal(),
    recentRequests,
    selected,
    sessionUser,
    sameUser,
    allItems,
    standingOrders,
    isStandingDue,
    orderingSummaryFilter
  });
}

function loadBootstrapCache() {
  return loadOrderingBootstrapCache(bootstrapCacheKey);
}

function saveBootstrapCache(data) {
  saveOrderingBootstrapCache(bootstrapCacheKey, data);
}

function applyBootstrapData(data = {}) {
  applyOrderingBootstrapData(data, ({ items, requests, standingOrders: runs, notifications: messages }) => {
    allItems = items;
    recentRequests = requests;
    standingOrders = runs;
    notifications = messages;
  });
  selected = buildSelectedFromRecentRequests();
  render();
}

function entryUnit(entry) {
  return entry?.unit || itemUnit(entry?.item || {});
}

function addItemHrefFromSearch() {
  return addItemHrefFromSearchValue({
    searchValue: searchInput.value,
    area: areaFilter.value,
    location: locationFilter.value
  });
}

function defaultQuantity(item) {
  return defaultQuantityForItem(item);
}

function filterItems() {
  return filterOrderingItems({
    items: allItems,
    area: areaFilter.value,
    location: locationFilter.value,
    search: searchInput.value,
    normalize,
    searchTokens,
    orderingItemMatchesSummary,
    today: todayLocal()
  });
}

function itemSearchScore(item) {
  return scoreOrderingItemSearch(item, searchInput.value, normalize);
}

function categoryStats(category, items) {
  return computeCategoryStats(category, items, selected);
}

function updateSaveButton() {
  const count = selected.size;
  submitButton.textContent = `${count} Saved`;
  submitButton.disabled = count === 0;
}

function renderSelectedChips() {
  renderSelectedChipsView({
    selectedChips,
    selected,
    entryUnit
  });
}

function renderNotifications() {
  renderNotificationsBlock({
    renderNotificationsView,
    notificationList,
    notificationCount,
    notificationPanel,
    readAllNotificationsButton,
    notifications
  })
}

function jumpToItem(itemId, category = "") {
  const item = allItems.find((candidate) => String(candidate.id) === String(itemId));
  if (!item) return;
  pendingJumpItemId = String(item.id);
  pendingJumpCategory = category || itemCategory(item);
  searchInput.value = "";
  activeCategory = pendingJumpCategory || itemCategory(item);
  categoryView.hidden = true;
  productView.hidden = false;
  render();
  const row = productList.querySelector(`.product-row[data-item-id="${String(item.id || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
  if (!row) return;
  row.classList.add("jump-highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => row.classList.remove("jump-highlight"), 2400);
}

function applyPendingJump() {
  if (!pendingJumpItemId) return;
  jumpToItem(pendingJumpItemId, pendingJumpCategory);
  pendingJumpItemId = "";
  pendingJumpCategory = "";
  if (window.history?.replaceState) {
    window.history.replaceState({}, "", "/ordering.html");
  }
}

function renderDailyOrder() {
  renderDailyOrderBlock({
    renderDailyOrderView,
    dailyOrderCount,
    dailyOrderList,
    today: todayLocal(),
    recentRequests,
    hasValidRequestItemId,
    requestMatchesScope,
    orderingRequestMatchesSummary,
    allItems,
    sameUser,
    sessionPermissions,
    sessionUser
  })
}

function renderStandingOrders() {
  renderStandingOrdersBlock({
    renderStandingOrdersView,
    standingOrderCount,
    standingOrderList,
    standingOrders
  });
}

function renderCategories() {
  renderCategoriesBlock({
    renderCategoriesView,
    categoryGrid,
    filterItems,
    selected,
    categoryStats,
    requestOpenStatsForItem
  })
}

function renderProductList() {
  renderProductListBlock({
    renderProductListView,
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
  })
}

function render() {
  renderOrderingPageBlock({
    hasSearchTerm,
    categoryView,
    productView,
    backButton,
    renderCategories,
    renderProductList,
    renderSelectedChips,
    renderOrderingSummary,
    renderDailyOrder,
    renderStandingOrders,
    renderNotifications,
    updateSaveButton,
    activeCategoryRef: {
      get: () => activeCategory,
      set: (value) => {
        activeCategory = value;
      }
    }
  });
}

function selectItem(item, quantity = defaultQuantity(item), urgency = "Medium") {
  selectOrderingItem(selected, item, quantity, urgency, defaultQuantity, itemUnit);
}

function buildSelectedFromRecentRequests() {
  return buildSelectedFromRequests({
    recentRequests,
    allItems,
    today: todayLocal(),
    sameUser,
    sessionUser,
    localDateKey,
    itemUnit,
    hasValidRequestItemId,
    isStandingOrder
  });
}

function syncProductRow(row) {
  syncOrderingProductRow(row, allItems, selected, itemUnit);
}

function optimisticRequestFromEntry(entry, index = 0) {
  return optimisticRequestFromSelection({
    entry,
    index,
    sessionUser,
    itemUnit
  });
}

function toggleProduct(row) {
  toggleOrderingProduct(row, {
    allItems,
    selected,
    selectItem,
    syncProductRow,
    render,
    itemUnit
  });
}

async function refresh(silent = false) {
  if (!silent) setMessage("Loading products...");
  const data = await api("/api/bootstrap");
  applyBootstrapData(data);
  applyPendingJump();
  saveBootstrapCache(data);
  setMessage("");
}

function collectSelectedEntries(itemIds = null) {
  return collectSelectedOrderingEntries(selected, itemIds);
}

async function submitSelected(itemIds = null) {
  const result = await submitOrderingSelection({
    itemIds,
    selected,
    submitButton,
    setMessage,
    queueApi,
    confirmDuplicateSave,
    itemUnit,
    sessionUser,
    optimisticRequestFromEntry,
    recentRequests,
    buildSelectedFromRecentRequests: (requestsOverride = recentRequests) => {
      const previous = recentRequests;
      recentRequests = requestsOverride;
      const rebuilt = buildSelectedFromRecentRequests();
      recentRequests = previous;
      return rebuilt;
    },
    render: (nextRequests, nextSelected) => {
      recentRequests = nextRequests;
      selected = nextSelected;
      render();
    },
    updateSaveButton,
    refresh
  });
  recentRequests = result.recentRequests;
  selected = result.selected;
}

function ensureRowSelection(row) {
  return ensureOrderingRowSelection(row, {
    allItems,
    selected,
    selectItem,
    syncProductRow
  });
}

async function deleteDailyOrder(requestId) {
  const result = await deleteDailyOrderAction({
    requestId,
    api,
    recentRequests,
    buildSelectedFromRecentRequests: (requestsOverride = recentRequests) => {
      const previous = recentRequests;
      recentRequests = requestsOverride;
      const rebuilt = buildSelectedFromRecentRequests();
      recentRequests = previous;
      return rebuilt;
    },
    render: (nextRequests, nextSelected) => {
      recentRequests = nextRequests;
      selected = nextSelected;
      render();
    },
    setMessage
  });
  recentRequests = result.recentRequests;
  selected = result.selected;
}

async function deliverDailyOrder(requestId) {
  await deliverDailyOrderAction({
    requestId,
    api,
    refresh,
    setMessage
  });
}

async function updateCurrentStock(itemId, countedQuantity) {
  const result = await updateCurrentStockAction({
    itemId,
    countedQuantity,
    queueApi,
    allItems,
    selected
  });
  allItems = result.allItems;
  selected = result.selected;
}

async function markNotificationsRead(ids = []) {
  notifications = await markNotificationsReadAction({
    ids,
    api,
    renderNotifications: (nextNotifications) => {
      notifications = nextNotifications;
      renderNotifications();
    }
  });
}

attachOrderingInteractions({
  loginForm,
  usernameInput,
  passwordInput,
  setLoginMessage,
  saveSession,
  showApp,
  showLogin,
  refresh,
  refreshSession,
  submitButton,
  submitSelected,
  featureMenu,
  backofficeMenu,
  refreshButton,
  categoryGrid,
  activeCategoryRef: {
    get: () => activeCategory,
    set: (value) => {
      activeCategory = value;
    }
  },
  categoryView,
  productView,
  render,
  backButton,
  productList,
  toggleProduct,
  updateCurrentStock,
  ensureRowSelection,
  allItemsRef: () => allItems,
  setMessage,
  syncProductRow,
  selectedRef: () => selected,
  selectItem,
  selectedChips,
  dailyOrderList,
  jumpToItem,
  deliverDailyOrder,
  deleteDailyOrder,
  notificationList,
  markNotificationsRead,
  readAllNotificationsButton,
  areaFilter,
  locationFilter,
  hasSearchTerm,
  requestScopeFilter,
  renderOrderingSummary,
  renderDailyOrder,
  renderCategories,
  renderProductList,
  orderingSummaryCards,
  orderingSummaryFilterRef: {
    get: () => orderingSummaryFilter,
    set: (value) => {
      orderingSummaryFilter = value;
    }
  },
  searchInput,
  sessionToken: () => sessionToken,
  sessionUser: () => sessionUser,
  updateSaveButton,
  loadBootstrapCache,
  applyBootstrapData,
  applyPendingJump
});








