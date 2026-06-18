export function bindOrderingMenusAndRefresh({
  featureMenu,
  backofficeMenu,
  refreshButton,
  refresh,
  setMessage,
  readAllNotificationsButton,
  markNotificationsRead
}) {
  [featureMenu, backofficeMenu].forEach((menu) => menu?.addEventListener("change", (event) => {
    if (event.target.value) window.location.href = event.target.value;
  }));

  refreshButton?.addEventListener("click", () => refresh().catch((error) => setMessage(error.message, true)));
  window.addEventListener("kitchen-offline-queue-synced", () => {
    refresh(true).catch((error) => setMessage(error.message, true));
  });

  readAllNotificationsButton?.addEventListener("click", () => {
    readAllNotificationsButton.disabled = true;
    markNotificationsRead().catch((error) => {
      setMessage(error.message, true);
    }).finally(() => {
      readAllNotificationsButton.disabled = false;
    });
  });
}

export function bindOrderingCategoryNavigation({
  categoryGrid,
  activeCategoryRef,
  categoryView,
  productView,
  render,
  backButton
}) {
  categoryGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".category-card");
    if (!card) return;
    activeCategoryRef.set(card.dataset.category);
    categoryView.hidden = true;
    productView.hidden = false;
    render();
  });

  backButton.addEventListener("click", () => {
    activeCategoryRef.set("");
    productView.hidden = true;
    categoryView.hidden = false;
    render();
  });
}

export function bindOrderingFilters({
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
}) {
  [areaFilter, locationFilter].forEach((control) => {
    control.addEventListener("input", () => {
      if (!productView.hidden && !hasSearchTerm()) {
        activeCategoryRef.set("");
        productView.hidden = true;
        categoryView.hidden = false;
      }
      render();
    });
  });

  requestScopeFilter?.addEventListener("change", () => {
    renderOrderingSummary();
    renderDailyOrder();
    renderCategories();
    if (!productView.hidden || hasSearchTerm()) renderProductList();
  });

  orderingSummaryCards?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-ordering-filter]");
    if (!card) return;
    const nextFilter = String(card.dataset.orderingFilter || "").trim();
    orderingSummaryFilterRef.set(orderingSummaryFilterRef.get() === nextFilter ? "all" : nextFilter);
    render();
  });

  ["input", "change", "search"].forEach((eventName) => {
    searchInput.addEventListener(eventName, () => {
      if (!productView.hidden && !hasSearchTerm()) {
        activeCategoryRef.set("");
        productView.hidden = true;
        categoryView.hidden = false;
      }
      render();
    });
  });
}
