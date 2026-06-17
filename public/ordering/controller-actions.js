export function collectSelectedEntriesFromMap(selected, itemIds = null) {
  const wantedIds = itemIds ? new Set(itemIds.map((value) => String(value || "").trim()).filter(Boolean)) : null;
  return [...selected.values()]
    .filter((entry) => entry?.item?.id)
    .filter((entry) => !wantedIds || wantedIds.has(String(entry.item.id)));
}

export async function submitOrderingSelection({
  itemIds = null,
  selected,
  submitButton,
  setMessage,
  queueApi,
  confirmDuplicateSave,
  itemUnit,
  sessionUser,
  optimisticRequestFromEntry,
  recentRequests,
  buildSelectedFromRecentRequests,
  render,
  updateSaveButton,
  refresh
}) {
  const scopedEntries = collectSelectedEntriesFromMap(selected, itemIds);
  if (!scopedEntries.length) return { recentRequests, selected };

  submitButton.disabled = true;
  setMessage("Saving order...");

  try {
    const deleteEntries = scopedEntries.filter((entry) => entry.deleteRequested && entry.requestId);
    const saveEntries = scopedEntries.filter((entry) => !entry.deleteRequested);
    let queuedOffline = false;

    if (saveEntries.length && !confirmDuplicateSave(saveEntries)) {
      setMessage("Duplicate save cancelled.");
      return { recentRequests, selected };
    }

    if (deleteEntries.length) {
      const deleteResults = await Promise.all(deleteEntries.map((entry) => queueApi(`/api/requests/${entry.requestId}`, {
        method: "DELETE"
      }, {
        label: `${entry.item?.name || "Order item"} delete`
      })));
      queuedOffline = queuedOffline || deleteResults.some((result) => result?.offlineQueued);
    }

    const requests = saveEntries
      .map((entry) => ({
        itemId: String(entry.item.id || "").trim(),
        quantityNeeded: entry.quantity,
        unitOverride: entry.unit || itemUnit(entry.item),
        urgencyLevel: entry.urgency,
        storageLocation: entry.item.storageLocation || "",
        inventoryArea: entry.item.inventoryArea || "",
        shelfCode: entry.item.shelfCode || "",
        requestedBy: sessionUser || "Kitchen",
        notes: ""
      }))
      .filter((entry) => entry.itemId);

    if (!requests.length && !deleteEntries.length) {
      throw new Error("No valid items were selected to save.");
    }

    let data = { requests: [] };
    if (requests.length) {
      data = await queueApi("/api/requests/batch", {
        method: "POST",
        body: JSON.stringify({ requests })
      }, {
        label: `${requests.length} order item(s)`,
        fallbackData: {
          requests: saveEntries.map((entry, index) => optimisticRequestFromEntry(entry, index))
        }
      });
      queuedOffline = queuedOffline || Boolean(data?.offlineQueued);
    }

    const deletedIds = new Set(deleteEntries.map((entry) => entry.requestId).filter(Boolean));
    const saved = requests.length;
    const deleted = deleteEntries.length;
    const byId = new Map(recentRequests.filter((request) => !deletedIds.has(request.id)).map((request) => [request.id, request]));
    for (const request of data.requests || []) {
      if (request?.id) byId.set(request.id, request);
    }
    const nextRequests = [...byId.values()]
      .sort((left, right) => {
        const leftTime = new Date(left.requestedAt || 0).getTime() || 0;
        const rightTime = new Date(right.requestedAt || 0).getTime() || 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return Number(right.requestId || 0) - Number(left.requestId || 0);
      })
      .slice(0, 200);

    const nextSelected = buildSelectedFromRecentRequests(nextRequests);
    render(nextRequests, nextSelected);

    const actions = [];
    if (saved) actions.push(`${saved} item(s) saved`);
    if (deleted) actions.push(`${deleted} item(s) deleted`);
    setMessage(queuedOffline ? `${actions.join(" and ")} offline. They will sync automatically.` : `${actions.join(" and ")}.`);
    if (!queuedOffline) {
      window.setTimeout(() => {
        refresh().catch((error) => setMessage(error.message, true));
      }, 250);
    }

    return { recentRequests: nextRequests, selected: nextSelected };
  } catch (error) {
    setMessage(error.message, true);
    return { recentRequests, selected };
  } finally {
    updateSaveButton();
  }
}

export async function deleteDailyOrderAction({
  requestId,
  api,
  recentRequests,
  buildSelectedFromRecentRequests,
  render,
  setMessage
}) {
  await api(`/api/requests/${requestId}`, { method: "DELETE" });
  const nextRequests = recentRequests.filter((request) => request.id !== requestId);
  const nextSelected = buildSelectedFromRecentRequests(nextRequests);
  render(nextRequests, nextSelected);
  setMessage("Item removed from today's order.");
  return { recentRequests: nextRequests, selected: nextSelected };
}

export async function deliverDailyOrderAction({
  requestId,
  api,
  refresh,
  setMessage
}) {
  await api(`/api/requests/${requestId}/deliver`, { method: "POST" });
  await refresh();
  setMessage("Item delivered, added to inventory, and closed.");
}

export async function updateCurrentStockAction({
  itemId,
  countedQuantity,
  queueApi,
  allItems,
  selected
}) {
  const data = await queueApi("/api/stock-counts", {
    method: "POST",
    body: JSON.stringify({
      itemId,
      countedQuantity,
      notes: "Adjusted from request screen."
    })
  }, {
    label: "Stock update",
    fallbackData: {
      item: {
        id: itemId,
        quantity: Number(countedQuantity || 0)
      }
    }
  });

  const nextItems = allItems.map((item) => (item.id === data.item.id ? { ...item, quantity: data.item.quantity } : item));
  const nextSelected = new Map(
    [...selected.entries()].map(([id, entry]) => [
      id,
      id === data.item.id ? { ...entry, item: { ...entry.item, quantity: data.item.quantity } } : entry
    ])
  );

  return { allItems: nextItems, selected: nextSelected };
}

export async function markNotificationsReadAction({
  ids = [],
  api,
  renderNotifications
}) {
  const data = await api("/api/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  const notifications = data.notifications || [];
  renderNotifications(notifications);
  return notifications;
}
