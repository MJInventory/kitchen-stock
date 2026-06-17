export function addItemHrefFromSearchValue({
  searchValue = "",
  area = "",
  location = ""
}) {
  const params = new URLSearchParams();
  const term = String(searchValue || "").trim();
  if (term) params.set("itemName", term);
  if (area) params.set("inventoryArea", area);
  if (location) params.set("storageLocation", location);
  const query = params.toString();
  return `/inventory-add.html${query ? `?${query}` : ""}`;
}

export function defaultQuantityForItem(item) {
  const minimum = Number(item?.minimum || 0);
  const current = Number(item?.quantity || 0);
  if (minimum > current) return Math.max(1, minimum - current);
  return 1;
}

export function filterOrderingItems({
  items = [],
  area = "",
  location = "",
  search = "",
  normalize,
  searchTokens,
  orderingItemMatchesSummary,
  today
}) {
  const normalizedSearch = normalize(search);
  const tokens = searchTokens(search);

  return items.filter((item) => {
    const areaMatches = !area || !item.inventoryArea || item.inventoryArea === area;
    const locationMatches = !location || !item.storageLocation || item.storageLocation === location;
    const searchText = normalize([
      item.name,
      item.category,
      item.storageLocation,
      item.inventoryArea,
      item.shelfCode,
      item.supplierName
    ].join(" "));
    const searchMatches = !tokens.length || (searchText.includes(normalizedSearch) && tokens.every((token) => searchText.includes(token)));
    const summaryMatches = orderingItemMatchesSummary(item, today);
    return areaMatches && locationMatches && searchMatches && summaryMatches;
  });
}

export function scoreOrderingItemSearch(item, searchValue, normalize) {
  const query = normalize(searchValue);
  if (!query) return 0;
  const name = normalize(item?.name);
  const category = normalize(item?.category);
  const supplier = normalize(item?.supplierName);
  const meta = normalize([
    item?.storageLocation,
    item?.inventoryArea,
    item?.shelfCode
  ].join(" "));
  if (name === query) return 400;
  if (name.startsWith(query)) return 300;
  if (name.includes(query)) return 220;
  if (category.startsWith(query)) return 160;
  if (category.includes(query)) return 130;
  if (supplier.startsWith(query)) return 110;
  if (supplier.includes(query)) return 90;
  if (meta.includes(query)) return 60;
  return 10;
}

export function computeCategoryStats(category, items, selected) {
  const chosen = items.filter((item) => selected.has(item.id)).length;
  const low = items.filter((item) => item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0)).length;
  return { chosen, low };
}

export function buildSelectedFromRequests({
  recentRequests = [],
  allItems = [],
  today,
  sameUser,
  sessionUser,
  localDateKey,
  itemUnit,
  hasValidRequestItemId,
  isStandingOrder
}) {
  const map = new Map();
  const userRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !isStandingOrder(request))
    .filter(hasValidRequestItemId)
    .filter((request) => sameUser(request.requestedBy, sessionUser))
    .filter((request) => {
      const requestDay = localDateKey(request.requestedAt);
      return !requestDay || requestDay === today;
    })
    .sort((left, right) => {
      const leftTime = new Date(left.requestedAt || 0).getTime() || 0;
      const rightTime = new Date(right.requestedAt || 0).getTime() || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return Number(right.requestId || 0) - Number(left.requestId || 0);
    });

  for (const request of userRequests) {
    if (map.has(request.itemId)) continue;
    const item = allItems.find((candidate) => candidate.id === request.itemId);
    if (!item) continue;
    map.set(request.itemId, {
      item,
      requestId: request.id,
      quantity: Math.max(1, Number(request.quantity || 1)),
      urgency: request.urgency || "Medium",
      unit: request.unit || itemUnit(item),
      deleteRequested: false
    });
  }

  return map;
}

export function optimisticRequestFromSelection({
  entry,
  index = 0,
  sessionUser = "",
  itemUnit
}) {
  const requestId = entry.requestId || `offline-request-${Date.now()}-${index}`;
  return {
    id: requestId,
    requestId,
    itemId: String(entry.item.id || "").trim(),
    quantity: Math.max(1, Number(entry.quantity || 1)),
    quantityNeeded: Math.max(1, Number(entry.quantity || 1)),
    unit: entry.unit || itemUnit(entry.item),
    orderUnit: entry.unit || itemUnit(entry.item),
    urgency: entry.urgency || "Medium",
    urgencyLevel: entry.urgency || "Medium",
    inventoryArea: entry.item.inventoryArea || "",
    storageLocation: entry.item.storageLocation || "",
    shelfCode: entry.item.shelfCode || "",
    requestedBy: sessionUser || "Kitchen",
    requestedAt: new Date().toISOString(),
    status: "Approved",
    delivered: false,
    received: false,
    notes: ""
  };
}
