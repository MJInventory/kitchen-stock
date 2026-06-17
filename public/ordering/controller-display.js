export function createOrderingDisplayController({
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
  windowObject,
  getAllItems,
  getRecentRequests,
  getStandingOrders,
  getNotifications,
  getSelected,
  getSessionUser,
  getSessionRole,
  getSessionPermissions,
  getOrderingSummaryFilter,
  getActiveCategory,
  setActiveCategory,
  getPendingJumpItemId,
  setPendingJumpItemId,
  getPendingJumpCategory,
  setPendingJumpCategory,
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
}) {
  function hasSearchTerm() {
    return hasSearchTermValue(searchInput.value);
  }

  function selectedRequestScope() {
    return String(requestScopeFilter?.value || "").trim();
  }

  function requestMatchesScope(request) {
    return requestMatchesScopeValue(request, {
      scope: selectedRequestScope(),
      sessionUser: getSessionUser(),
      sameUser,
      requestUser
    });
  }

  function displayRoleMode() {
    return displayRoleModeValue(getSessionRole());
  }

  function requestOpenStatsForItem(itemId) {
    return requestOpenStatsForItemValue(itemId, {
      recentRequests: getRecentRequests(),
      sameUser,
      requestUser,
      sessionUser: getSessionUser(),
      today: todayLocal(),
      requestDay,
      isStandingOrder
    });
  }

  function isStandingDue(order, today = todayLocal()) {
    return isStandingDueValue(order, today);
  }

  function orderingItemMatchesSummary(item, today = todayLocal()) {
    return orderingItemMatchesSummaryValue(item, {
      orderingSummaryFilter: getOrderingSummaryFilter(),
      today,
      requestOpenStatsForItem,
      selected: getSelected(),
      recentRequests: getRecentRequests(),
      isStandingOrder,
      isOlderOpenRequest,
      standingOrders: getStandingOrders()
    });
  }

  function orderingRequestMatchesSummary(request, today = todayLocal()) {
    return orderingRequestMatchesSummaryValue(request, {
      orderingSummaryFilter: getOrderingSummaryFilter(),
      today,
      allItems: getAllItems(),
      selected: getSelected(),
      sameUser,
      sessionUser: getSessionUser(),
      requestUser,
      isOlderOpenRequest
    });
  }

  function confirmDuplicateSave(entries) {
    return confirmDuplicateSelectionSave(entries, {
      recentRequests: getRecentRequests(),
      requestDay,
      today: todayLocal(),
      isStandingOrder,
      expectedDateFromRequest,
      duplicateSourceLabel,
      windowObject
    });
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
      items: getAllItems(),
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
    return computeCategoryStats(category, items, getSelected());
  }

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
  };
}
