export function duplicateReferencesForSelectionEntry(entry, context) {
  const {
    recentRequests,
    requestDay,
    today,
    isStandingOrder,
    expectedDateFromRequest
  } = context;
  const itemId = String(entry?.item?.id || "").trim();
  const currentRequestId = String(entry?.requestId || "").trim();
  if (!itemId) return [];
  return recentRequests
    .filter((request) => String(request?.itemId || "").trim() === itemId)
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => String(request.id || "").trim() !== currentRequestId)
    .filter((request) => {
      const requestDate = requestDay(request);
      const deliveryDay = String(request.deliveryDay || "").trim();
      const sameDayOrder = !request.standingRunId && !isStandingOrder(request) && requestDate === today;
      const standingPending = (Boolean(request.standingRunId) || isStandingOrder(request))
        && Boolean((deliveryDay && deliveryDay <= today) || expectedDateFromRequest(request) === today || (requestDate && requestDate <= today));
      const scheduledToday = Boolean(request.toDeliver) && (!deliveryDay || deliveryDay === today);
      const partialCarry = Boolean(request.partialReceipt);
      return sameDayOrder || standingPending || scheduledToday || partialCarry;
    });
}

export function confirmDuplicateSelectionSave(entries, context) {
  const { duplicateSourceLabel, windowObject } = context;
  const warnings = entries
    .map((entry) => ({
      entry,
      refs: duplicateReferencesForSelectionEntry(entry, context)
    }))
    .filter((result) => result.refs.length);
  if (!warnings.length) return true;

  const lines = warnings.flatMap(({ entry, refs }) => {
    const itemName = entry?.item?.name || "Item";
    return [
      `${itemName} already has an open reference:`,
      ...refs.map((request) => `- ${duplicateSourceLabel(request)}`)
    ];
  });

  return windowObject.confirm(
    `This looks like a possible double order.\n\n${lines.join("\n")}\n\nDo you want to save it anyway?`
  );
}

export function selectOrderingItem(selected, item, quantity, urgency, defaultQuantity, itemUnit) {
  selected.set(item.id, {
    item,
    quantity: Math.max(1, Number(quantity || defaultQuantity(item) || 1)),
    urgency,
    unit: itemUnit(item),
    deleteRequested: false
  });
}

export function syncOrderingProductRow(row, allItems, selected, itemUnit) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item || !selected.has(item.id)) return;
  const current = selected.get(item.id) || {};
  selected.set(item.id, {
    item,
    requestId: current.requestId,
    quantity: Math.max(1, Number(row.querySelector(".qty-input").value || 1)),
    urgency: row.querySelector(".urgency-input").value,
    unit: row.querySelector(".unit-input")?.value || itemUnit(item),
    deleteRequested: Boolean(row.querySelector(".delete-request-input")?.checked)
  });
}

export function toggleOrderingProduct(row, context) {
  const {
    allItems,
    selected,
    selectItem,
    syncProductRow,
    render,
    itemUnit
  } = context;
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item) return;

  if (selected.has(item.id)) {
    selected.delete(item.id);
  } else {
    selectItem(item, row.querySelector(".qty-input").value, row.querySelector(".urgency-input").value);
    const entry = selected.get(item.id);
    if (entry) {
      entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
      entry.deleteRequested = Boolean(row.querySelector(".delete-request-input")?.checked);
    }
  }

  render();
}

export function collectSelectedOrderingEntries(selected, itemIds = null) {
  const wantedIds = itemIds ? new Set(itemIds.map((value) => String(value || "").trim()).filter(Boolean)) : null;
  return [...selected.values()]
    .filter((entry) => entry?.item?.id)
    .filter((entry) => !wantedIds || wantedIds.has(String(entry.item.id)));
}

export function ensureOrderingRowSelection(row, context) {
  const { allItems, selected, selectItem, syncProductRow } = context;
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item) return null;
  const quantityInput = row.querySelector(".qty-input");
  const quantity = Math.max(1, Number(quantityInput?.value || 1));
  if (!selected.has(item.id)) {
    selectItem(item, quantity, row.querySelector(".urgency-input")?.value || "Medium");
  }
  syncProductRow(row);
  return item;
}
