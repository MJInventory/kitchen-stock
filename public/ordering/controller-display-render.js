export function createOrderingDisplayRender(options) {
  const {
    searchInput,
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
    windowObject,
    getAllItems,
    getRecentRequests,
    getStandingOrders,
    getNotifications,
    getSelected,
    getSessionUser,
    getSessionPermissions,
    getActiveCategory,
    setActiveCategory,
    getPendingJumpItemId,
    setPendingJumpItemId,
    getPendingJumpCategory,
    setPendingJumpCategory,
    todayLocal,
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
    hasValidRequestItemId,
    sameUser,
    hasSearchTerm,
    requestMatchesScope,
    orderingRequestMatchesSummary,
    displayRoleMode,
    isStandingDue,
    filterItems,
    itemSearchScore,
    categoryStats,
    requestOpenStatsForItem,
    addItemHrefFromSearch,
    defaultQuantity,
    itemUnit,
    entryUnit,
    itemCategory,
    orderingSummaryCards,
    orderingMode,
    renderOrderingSummaryFilter,
    getOrderingSummaryFilter
  } = options;

  function updateSaveButton() {
    const count = getSelected().size;
    submitButton.textContent = `${count} Saved`;
    submitButton.disabled = count === 0;
  }

  function renderSelectedChips() {
    renderSelectedChipsView({
      selectedChips,
      selected: getSelected(),
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
      notifications: getNotifications()
    });
  }

  function jumpToItem(itemId, category = "") {
    const item = getAllItems().find((candidate) => String(candidate.id) === String(itemId));
    if (!item) return;
    setPendingJumpItemId(String(item.id));
    setPendingJumpCategory(category || itemCategory(item));
    searchInput.value = "";
    setActiveCategory(getPendingJumpCategory() || itemCategory(item));
    categoryView.hidden = true;
    productView.hidden = false;
    render();
    const row = productList.querySelector(`.product-row[data-item-id="${String(item.id || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
    if (!row) return;
    row.classList.add("jump-highlight");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    windowObject.setTimeout(() => row.classList.remove("jump-highlight"), 2400);
  }

  function applyPendingJump() {
    if (!getPendingJumpItemId()) return;
    jumpToItem(getPendingJumpItemId(), getPendingJumpCategory());
    setPendingJumpItemId("");
    setPendingJumpCategory("");
    if (windowObject.history?.replaceState) {
      windowObject.history.replaceState({}, "", "/ordering.html");
    }
  }

  function renderOrderingSummary() {
    renderOrderingSummaryBlock({
      renderOrderingSummaryView,
      orderingSummaryCards,
      orderingMode,
      displayRoleMode,
      today: todayLocal(),
      recentRequests: getRecentRequests(),
      selected: getSelected(),
      sessionUser: getSessionUser(),
      sameUser,
      allItems: getAllItems(),
      standingOrders: getStandingOrders(),
      isStandingDue,
      orderingSummaryFilter: getOrderingSummaryFilter()
    });
  }

  function renderDailyOrder() {
    renderDailyOrderBlock({
      renderDailyOrderView,
      dailyOrderCount,
      dailyOrderList,
      today: todayLocal(),
      recentRequests: getRecentRequests(),
      hasValidRequestItemId,
      requestMatchesScope,
      orderingRequestMatchesSummary,
      allItems: getAllItems(),
      sameUser,
      sessionPermissions: getSessionPermissions(),
      sessionUser: getSessionUser()
    });
  }

  function renderStandingOrders() {
    renderStandingOrdersBlock({
      renderStandingOrdersView,
      standingOrderCount,
      standingOrderList,
      standingOrders: getStandingOrders()
    });
  }

  function renderCategories() {
    renderCategoriesBlock({
      renderCategoriesView,
      categoryGrid,
      filterItems,
      selected: getSelected(),
      categoryStats,
      requestOpenStatsForItem
    });
  }

  function renderProductList() {
    renderProductListBlock({
      renderProductListView,
      activeCategory: getActiveCategory(),
      categoryTitle,
      categoryMeta,
      backButton,
      productList,
      filterItems,
      hasSearchTerm,
      itemSearchScore,
      selected: getSelected(),
      defaultQuantity,
      itemUnit,
      requestOpenStatsForItem,
      addItemHrefFromSearch,
      sessionPermissions: getSessionPermissions()
    });
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
        get: getActiveCategory,
        set: setActiveCategory
      }
    });
  }

  return {
    updateSaveButton,
    renderSelectedChips,
    renderNotifications,
    jumpToItem,
    applyPendingJump,
    renderOrderingSummary,
    renderDailyOrder,
    renderStandingOrders,
    renderCategories,
    renderProductList,
    render
  };
}
