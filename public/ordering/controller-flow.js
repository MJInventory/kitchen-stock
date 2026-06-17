export function createOrderingFlowController({
  submitButton,
  getAllItems,
  setAllItems,
  getRecentRequests,
  setRecentRequests,
  getSelected,
  setSelected,
  getNotifications,
  setNotifications,
  getSessionUser,
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
  refreshOrderingDisplay,
  renderNotifications,
  confirmDuplicateSave,
  updateSaveButton
}) {
  function selectItem(item, quantity = defaultQuantity(item), urgency = "Medium") {
    const selected = getSelected();
    selected.set(String(item.id), {
      item,
      quantity: Number.isFinite(Number(quantity)) ? Number(quantity) : defaultQuantity(item),
      urgency: urgency || "Medium",
      unit: itemUnit(item)
    });
  }

  function buildSelectedFromRecentRequests() {
    return buildSelectedFromRequests({
      recentRequests: getRecentRequests(),
      allItems: getAllItems(),
      today: todayLocal(),
      sameUser,
      sessionUser: getSessionUser(),
      localDateKey,
      itemUnit,
      hasValidRequestItemId,
      isStandingOrder
    });
  }

  function syncProductRow(row) {
    syncOrderingProductRow(row, getAllItems(), getSelected(), itemUnit);
  }

  function optimisticRequestFromEntry(entry, index = 0) {
    return optimisticRequestFromSelection({
      entry,
      index,
      sessionUser: getSessionUser(),
      itemUnit
    });
  }

  function toggleProduct(row) {
    toggleOrderingProduct(row, {
      allItems: getAllItems(),
      selected: getSelected(),
      selectItem,
      syncProductRow,
      render,
      itemUnit
    });
  }

  async function refresh(silent = false) {
    if (!silent) setMessage("Loading products...");
    const data = await api("/api/bootstrap");
    refreshOrderingDisplay(data);
    setMessage("");
  }

  function collectSelectedEntries(itemIds = null) {
    return collectSelectedOrderingEntries(getSelected(), itemIds);
  }

  async function submitSelected(itemIds = null) {
    const result = await submitOrderingSelection({
      itemIds,
      selected: getSelected(),
      submitButton,
      setMessage,
      queueApi,
      confirmDuplicateSave,
      itemUnit,
      sessionUser: getSessionUser(),
      optimisticRequestFromEntry,
      recentRequests: getRecentRequests(),
      buildSelectedFromRecentRequests: (requestsOverride = getRecentRequests()) => {
        const previous = getRecentRequests();
        setRecentRequests(requestsOverride);
        const rebuilt = buildSelectedFromRecentRequests();
        setRecentRequests(previous);
        return rebuilt;
      },
      render: (nextRequests, nextSelected) => {
        setRecentRequests(nextRequests);
        setSelected(nextSelected);
        render();
      },
      updateSaveButton,
      refresh
    });
    setRecentRequests(result.recentRequests);
    setSelected(result.selected);
  }

  function ensureRowSelection(row) {
    return ensureOrderingRowSelection(row, {
      allItems: getAllItems(),
      selected: getSelected(),
      selectItem,
      syncProductRow
    });
  }

  async function deleteDailyOrder(requestId) {
    const result = await deleteDailyOrderAction({
      requestId,
      api,
      recentRequests: getRecentRequests(),
      buildSelectedFromRecentRequests: (requestsOverride = getRecentRequests()) => {
        const previous = getRecentRequests();
        setRecentRequests(requestsOverride);
        const rebuilt = buildSelectedFromRecentRequests();
        setRecentRequests(previous);
        return rebuilt;
      },
      render: (nextRequests, nextSelected) => {
        setRecentRequests(nextRequests);
        setSelected(nextSelected);
        render();
      },
      setMessage
    });
    setRecentRequests(result.recentRequests);
    setSelected(result.selected);
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
      allItems: getAllItems(),
      selected: getSelected()
    });
    setAllItems(result.allItems);
    setSelected(result.selected);
  }

  async function markNotificationsRead(ids = []) {
    const nextNotifications = await markNotificationsReadAction({
      ids,
      api,
      renderNotifications: (messages) => {
        setNotifications(messages);
        renderNotifications();
      }
    });
    setNotifications(nextNotifications);
  }

  return {
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
  };
}
