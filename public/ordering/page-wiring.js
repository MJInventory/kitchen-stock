import {
  formatUserDisplay,
  itemUnit,
  localDateKey,
  normalize,
  sameUser,
  searchTokens,
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
  isOpenAttentionRequest,
  isOlderOpenRequest,
  isStandingOrder,
  requestDay,
  requestUser
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

export function wireOrderingPage({ window, document, localStorage, refs, state }) {
  const {
    loginScreen,
    loginForm,
    usernameInput,
    passwordInput,
    loginMessage,
    currentUser,
    areaFilter,
    locationFilter,
    refreshButton,
    submitButton,
    featureMenu,
    backofficeMenu,
    searchInput,
    requestScopeFilter,
    selectedChips,
    categoryView,
    categoryGrid,
    productView,
    productList,
    categoryTitle,
    categoryMeta,
    backButton,
    dailyOrderCount,
    dailyOrderList,
    standingOrderCount,
    standingOrderList,
    notificationCount,
    notificationList,
    notificationPanel,
    readAllNotificationsButton,
    orderingMode,
    orderingSummaryCards,
    message
  } = refs;
  let {
    allItems,
    recentRequests,
    standingOrders,
    notifications,
    summary,
    activeCategory,
    selected,
    sessionToken,
    sessionUser,
    sessionRole,
    sessionPermissions,
    orderingSummaryFilter,
    bootstrapCacheKey,
    pendingJumpItemId,
    pendingJumpCategory
  } = state;

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
    renderOrderingSummary,
    defaultQuantity,
    confirmDuplicateSave,
    updateSaveButton,
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
    getSummary: () => summary,
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
    isOpenAttentionRequest,
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
    renderOrderingPageBlock,
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
      summary = data.summary || null;
    });
    selected = buildSelectedFromRecentRequests();
    render();
  }

  const {
    selectItem,
    toggleProduct,
    buildSelectedFromRecentRequests,
    syncProductRow,
    refresh,
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
    groupRequestsByCategory,
    groupRequestsForOrderSheet,
    itemNameFromRequest,
    requestSortValue,
    logicalRequestCompare,
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
