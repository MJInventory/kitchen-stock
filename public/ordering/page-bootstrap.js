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
} from "./shared.js";
import {
  groupRequestsByCategory,
  groupRequestsForOrderSheet,
  itemCategory,
  itemNameFromRequest,
  logicalRequestCompare,
  requestSortValue
} from "./request-grouping.js";
import {
  displayRoleMode as displayRoleModeValue,
  hasSearchTerm as hasSearchTermValue,
  hasValidRequestItemId,
  isStandingDue as isStandingDueValue,
  orderingItemMatchesSummary as orderingItemMatchesSummaryValue,
  orderingRequestMatchesSummary as orderingRequestMatchesSummaryValue,
  requestMatchesScope as requestMatchesScopeValue,
  requestOpenStatsForItem as requestOpenStatsForItemValue
} from "./summary-filters.js";
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
} from "./request-status.js";
import {
  addItemHrefFromSearchValue,
  buildSelectedFromRequests,
  computeCategoryStats,
  defaultQuantityForItem,
  filterOrderingItems,
  optimisticRequestFromSelection,
  scoreOrderingItemSearch
} from "./controller-helpers.js";
import {
  applyOrderingBootstrapData,
  loadOrderingBootstrapCache,
  saveOrderingBootstrapCache
} from "./bootstrap-cache.js";
import {
  deleteDailyOrderAction,
  deliverDailyOrderAction,
  markNotificationsReadAction,
  submitOrderingSelection,
  updateCurrentStockAction
} from "./controller-actions.js";
import {
  renderCategories as renderCategoriesView,
  renderDailyOrder as renderDailyOrderView,
  renderNotifications as renderNotificationsView,
  renderOrderingSummary as renderOrderingSummaryView,
  renderProductList as renderProductListView,
  renderSelectedChips as renderSelectedChipsView,
  renderStandingOrders as renderStandingOrdersView
} from "./render.js";
import {
  renderCategoriesBlock,
  renderDailyOrderBlock,
  renderNotificationsBlock,
  renderOrderingPageBlock,
  renderOrderingSummaryBlock,
  renderProductListBlock,
  renderStandingOrdersBlock
} from "./controller-renderers.js";
import { createOrderingDisplayController } from "./controller-display.js";
import {
  collectSelectedOrderingEntries,
  confirmDuplicateSelectionSave,
  ensureOrderingRowSelection,
  syncOrderingProductRow,
  toggleOrderingProduct
} from "./controller-selection.js";
import {
  refreshOrderingSession,
  saveOrderingSession,
  setUiMessage,
  showOrderingApp,
  showOrderingLogin
} from "./controller-session.js";
import { createOrderingRuntime } from "./controller-runtime.js";
import { createOrderingFlowController } from "./controller-flow.js";
import { attachOrderingInteractions } from "./interactions.js";

export function startOrderingPage({ window = globalThis.window, document = globalThis.document, localStorage = globalThis.localStorage } = {}) {
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

const {
  setMessage,
  setLoginMessage,
  showApp,
  saveSession,
  showLogin,
  api,
  queueApi,
  refreshSession
} = createOrderingRuntime({
  loginScreen,
  currentUser,
  featureMenu,
  backofficeMenu,
  loginMessage,
  message,
  formatUserDisplay,
  setUiMessage,
  showOrderingApp,
  saveOrderingSession,
  showOrderingLogin,
  refreshOrderingSession,
  localStorageObject: localStorage,
  windowObject: window,
  documentObject: document,
  getSessionToken: () => sessionToken,
  getSessionUser: () => sessionUser,
  getSessionPermissions: () => sessionPermissions,
  setSessionState: (nextSession) => {
    sessionToken = nextSession.token || "";
    sessionUser = nextSession.user || "";
    sessionRole = nextSession.role || "user";
    sessionPermissions = nextSession.permissions || {};
  }
});

const {
  hasSearchTerm,
  requestMatchesScope,
  displayRoleMode,
  requestOpenStatsForItem,
  isStandingDue,
  orderingItemMatchesSummary,
  orderingRequestMatchesSummary,
  confirmDuplicateSave,
  renderOrderingSummary,
  entryUnit,
  addItemHrefFromSearch,
  defaultQuantity,
  filterItems,
  itemSearchScore,
  categoryStats,
  updateSaveButton,
  renderSelectedChips,
  renderNotifications,
  jumpToItem,
  applyPendingJump,
  renderDailyOrder,
  renderStandingOrders,
  renderCategories,
  renderProductList,
  render
} = createOrderingDisplayController({
  searchInput,
  areaFilter,
  locationFilter,
  requestScopeFilter,
  orderingMode,
  orderingSummaryCards,
  selectedChips,
  notificationList,
  notificationCount,
  notificationPanel,
  readAllNotificationsButton,
  dailyOrderCount,
  dailyOrderList,
  standingOrderCount,
  standingOrderList,
  categoryGrid,
  categoryView,
  productView,
  backButton,
  productList,
  categoryTitle,
  categoryMeta,
  submitButton,
  windowObject: window,
  getAllItems: () => allItems,
  getRecentRequests: () => recentRequests,
  getStandingOrders: () => standingOrders,
  getNotifications: () => notifications,
  getSelected: () => selected,
  getSessionUser: () => sessionUser,
  getSessionRole: () => sessionRole,
  getSessionPermissions: () => sessionPermissions,
  getOrderingSummaryFilter: () => orderingSummaryFilter,
  getActiveCategory: () => activeCategory,
  setActiveCategory: (value) => {
    activeCategory = value;
  },
  getPendingJumpItemId: () => pendingJumpItemId,
  setPendingJumpItemId: (value) => {
    pendingJumpItemId = value;
  },
  getPendingJumpCategory: () => pendingJumpCategory,
  setPendingJumpCategory: (value) => {
    pendingJumpCategory = value;
  },
  todayLocal,
  hasSearchTermValue,
  requestMatchesScopeValue,
  displayRoleModeValue,
  requestOpenStatsForItemValue,
  isStandingDueValue,
  orderingItemMatchesSummaryValue,
  orderingRequestMatchesSummaryValue,
  confirmDuplicateSelectionSave,
  requestDay,
  expectedDateFromRequest,
  duplicateSourceLabel,
  isStandingOrder,
  isOlderOpenRequest,
  addItemHrefFromSearchValue,
  defaultQuantityForItem,
  filterOrderingItems,
  normalize,
  searchTokens,
  scoreOrderingItemSearch,
  computeCategoryStats,
  itemUnit,
  renderOrderingSummaryBlock,
  renderOrderingSummaryView,
  renderSelectedChipsView,
  renderNotificationsBlock,
  renderNotificationsView,
  renderDailyOrderBlock,
  renderDailyOrderView,
  renderStandingOrdersBlock,
  renderStandingOrdersView,
  renderCategoriesBlock,
  renderCategoriesView,
  renderProductListBlock,
  renderProductListView,
  itemCategory,
  sameUser,
  requestUser,
  hasValidRequestItemId
});

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

const {
  selectItem,
  buildSelectedFromRecentRequests,
  syncProductRow,
  optimisticRequestFromEntry,
  toggleProduct,
  refresh,
  collectSelectedEntries,
  submitSelected,
  ensureRowSelection,
  deleteDailyOrder,
  deliverDailyOrder,
  updateCurrentStock,
  markNotificationsRead
} = createOrderingFlowController({
  submitButton,
  getAllItems: () => allItems,
  setAllItems: (value) => {
    allItems = value;
  },
  getRecentRequests: () => recentRequests,
  setRecentRequests: (value) => {
    recentRequests = value;
  },
  getSelected: () => selected,
  setSelected: (value) => {
    selected = value;
  },
  getNotifications: () => notifications,
  setNotifications: (value) => {
    notifications = value;
  },
  getSessionUser: () => sessionUser,
  todayLocal,
  defaultQuantity,
  itemUnit,
  sameUser,
  localDateKey,
  hasValidRequestItemId,
  isStandingOrder,
  buildSelectedFromRequests,
  syncOrderingProductRow,
  optimisticRequestFromSelection,
  toggleOrderingProduct,
  collectSelectedOrderingEntries,
  submitOrderingSelection,
  ensureOrderingRowSelection,
  deleteDailyOrderAction,
  deliverDailyOrderAction,
  updateCurrentStockAction,
  markNotificationsReadAction,
  api,
  queueApi,
  setMessage,
  render,
  refreshOrderingDisplay: (data) => {
    applyBootstrapData(data);
    applyPendingJump();
    saveBootstrapCache(data);
  },
  renderNotifications,
  confirmDuplicateSave,
  updateSaveButton
});

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









}
