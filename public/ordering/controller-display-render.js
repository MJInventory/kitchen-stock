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
    getSummary,
    getSelected,
    getSessionUser,
    getSessionPermissions,
    getActiveCategory,
    setActiveCategory,
    getPendingJumpItemId,
    setPendingJumpItemId,
    getPendingJumpCategory,
    setPendingJumpCategory,
    getPendingJumpRequestId,
    setPendingJumpRequestId,
    getFocusedRequestId,
    setFocusedRequestId,
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
    isOlderOpenRequest,
    filterItems,
    itemSearchScore,
    categoryStats,
    requestOpenStatsForItem,
    addItemHrefFromSearch,
    defaultQuantity,
    itemUnit,
    getUnitOptions,
    entryUnit,
    itemCategory,
    orderingSummaryCards,
    orderingMode,
    renderOrderingSummaryFilter,
    getOrderingSummaryFilter
  } = options;

  function updateSaveButton() {
    const count = getSelected().size;
    if (!submitButton) return;
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

  function jumpToItem(itemId, category = "", requestId = "") {
    const item = getAllItems().find((candidate) => String(candidate.id) === String(itemId));
    if (!item) return;
    setPendingJumpItemId(String(item.id));
    setPendingJumpCategory(category || itemCategory(item));
    setPendingJumpRequestId(String(requestId || "").trim());
    setFocusedRequestId(String(requestId || "").trim());
    const selected = getSelected();
    const targetRequest = (String(requestId || "").trim()
      ? getRecentRequests().find((request) => String(request?.id || "").trim() === String(requestId || "").trim())
      : null);
    if (targetRequest) {
      selected.set(String(item.id), {
        item,
        requestId: targetRequest.id,
        quantity: Math.max(1, Number(targetRequest.quantity || targetRequest.quantityNeeded || 1)),
        urgency: targetRequest.urgency || targetRequest.urgencyLevel || "Medium",
        unit: targetRequest.unit || targetRequest.orderUnit || itemUnit(item),
        deleteRequested: false
      });
    } else if (!selected.has(String(item.id))) {
      selected.set(String(item.id), {
        item,
        quantity: defaultQuantity(item),
        urgency: "Medium",
        unit: itemUnit(item),
        deleteRequested: false
      });
    }
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
    jumpToItem(getPendingJumpItemId(), getPendingJumpCategory(), getPendingJumpRequestId());
    setPendingJumpItemId("");
    setPendingJumpCategory("");
    setPendingJumpRequestId("");
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
      orderingSummary: getSummary(),
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
      sessionUser: getSessionUser(),
      isOlderOpenRequest
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
      unitOptions: getUnitOptions,
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
