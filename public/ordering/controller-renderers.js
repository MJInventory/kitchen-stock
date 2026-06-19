export function renderOrderingSummaryBlock({
  renderOrderingSummaryView,
  orderingSummaryCards,
  orderingMode,
  displayRoleMode,
  today,
  recentRequests,
  selected,
  sessionUser,
  sameUser,
  allItems,
  standingOrders,
  isStandingDue,
  orderingSummaryFilter
}) {
  renderOrderingSummaryView({
    orderingSummaryCards,
    orderingMode,
    displayRoleMode,
    today,
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

export function renderNotificationsBlock({
  renderNotificationsView,
  notificationList,
  notificationCount,
  notificationPanel,
  readAllNotificationsButton,
  notifications
}) {
  renderNotificationsView({
    notificationList,
    notificationCount,
    notificationPanel,
    readAllNotificationsButton,
    notifications
  });
}

export function renderDailyOrderBlock({
  renderDailyOrderView,
  dailyOrderCount,
  dailyOrderList,
  today,
  recentRequests,
  hasValidRequestItemId,
  requestMatchesScope,
  orderingRequestMatchesSummary,
  allItems,
  sameUser,
  sessionPermissions,
  sessionUser,
  isOlderOpenRequest
}) {
  renderDailyOrderView({
    dailyOrderCount,
    dailyOrderList,
    today,
    recentRequests,
    hasValidRequestItemId,
    requestMatchesScope,
    orderingRequestMatchesSummary,
    allItems,
    sameUser,
    sessionPermissions,
    sessionUser,
    isOlderOpenRequest
  });
}

export function renderStandingOrdersBlock({
  renderStandingOrdersView,
  standingOrderCount,
  standingOrderList,
  standingOrders
}) {
  renderStandingOrdersView({ standingOrderCount, standingOrderList, standingOrders });
}

export function renderCategoriesBlock({
  renderCategoriesView,
  categoryGrid,
  filterItems,
  selected,
  categoryStats,
  requestOpenStatsForItem
}) {
  renderCategoriesView({
    categoryGrid,
    filterItems,
    selected,
    categoryStats,
    requestOpenStatsForItem
  });
}

export function renderProductListBlock({
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
}) {
  renderProductListView({
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
  });
}

export function renderOrderingPageBlock({
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
  activeCategoryRef
}) {
  const searchMode = hasSearchTerm();
  if (searchMode) {
    activeCategoryRef.set("");
    categoryView.hidden = true;
    productView.hidden = false;
    renderProductList();
  } else if (productView.hidden) {
    backButton.hidden = false;
    renderCategories();
  } else {
    backButton.hidden = false;
    renderProductList();
  }
  renderSelectedChips();
  renderOrderingSummary();
  renderDailyOrder();
  renderStandingOrders();
  renderNotifications();
  updateSaveButton();
}
