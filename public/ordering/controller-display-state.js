export function createOrderingDisplayState(options) {
  const {
    searchInput,
    areaFilter,
    locationFilter,
    requestScopeFilter,
    windowObject,
    getAllItems,
    getRecentRequests,
    getStandingOrders,
    getSelected,
    getSessionUser,
    getSessionRole,
    getOrderingSummaryFilter,
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
    itemCategory,
    sameUser,
    requestUser
  } = options;

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
      isOpenAttentionRequest,
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
      isOpenAttentionRequest,
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

  return {
    hasSearchTerm,
    requestMatchesScope,
    displayRoleMode,
    requestOpenStatsForItem,
    isStandingDue,
    orderingItemMatchesSummary,
    orderingRequestMatchesSummary,
    confirmDuplicateSave,
    entryUnit,
    addItemHrefFromSearch,
    defaultQuantity,
    filterItems,
    itemSearchScore,
    categoryStats,
    itemCategory
  };
}
