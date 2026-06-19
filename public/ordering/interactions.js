import {
  bindOrderingBootstrap,
  bindOrderingCategoryNavigation,
  bindOrderingDailyOrder,
  bindOrderingFilters,
  bindOrderingLogin,
  bindOrderingMenusAndRefresh,
  bindOrderingNotifications,
  bindOrderingProductList,
  bindOrderingSelectedChips
} from "./interaction-bindings.js";

export function attachOrderingInteractions(params) {
  const {
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
    activeCategoryRef,
    categoryView,
    productView,
    render,
    backButton,
    productList,
    toggleProduct,
    updateCurrentStock,
    ensureRowSelection,
    allItemsRef,
    setMessage,
    syncProductRow,
    selectedRef,
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
    orderingSummaryFilterRef,
    searchInput,
    sessionToken,
    sessionUser,
    updateSaveButton,
    loadBootstrapCache,
    applyBootstrapData,
    applyPendingJump
  } = params;

  bindOrderingLogin({
    loginForm,
    usernameInput,
    passwordInput,
    setLoginMessage,
    saveSession,
    showApp,
    refresh,
    showLogin
  });

  bindOrderingMenusAndRefresh({
    featureMenu,
    backofficeMenu,
    refreshButton,
    refresh,
    setMessage,
    readAllNotificationsButton,
    markNotificationsRead
  });

  submitButton?.addEventListener("click", () => submitSelected());

  bindOrderingCategoryNavigation({
    categoryGrid,
    activeCategoryRef,
    categoryView,
    productView,
    render,
    backButton
  });

  bindOrderingProductList({
    productList,
    toggleProduct,
    updateCurrentStock,
    allItemsRef,
    selectedRef,
    selectItem,
    syncProductRow,
    render,
    ensureRowSelection,
    submitSelected,
    setMessage
  });

  bindOrderingSelectedChips({
    selectedChips,
    selectedRef,
    render
  });

  bindOrderingDailyOrder({
    dailyOrderList,
    jumpToItem,
    deliverDailyOrder,
    deleteDailyOrder,
    setMessage
  });

  bindOrderingNotifications({
    notificationList,
    markNotificationsRead,
    setMessage
  });

  bindOrderingFilters({
    areaFilter,
    locationFilter,
    productView,
    activeCategoryRef,
    categoryView,
    render,
    hasSearchTerm,
    requestScopeFilter,
    renderOrderingSummary,
    renderDailyOrder,
    renderCategories,
    renderProductList,
    orderingSummaryCards,
    orderingSummaryFilterRef,
    searchInput
  });

  bindOrderingBootstrap({
    sessionToken,
    sessionUser,
    showApp,
    loadBootstrapCache,
    applyBootstrapData,
    applyPendingJump,
    setMessage,
    refreshSession,
    refresh,
    showLogin,
    updateSaveButton
  });
}
