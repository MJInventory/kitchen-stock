export function hasSearchTerm(searchValue) {
  return Boolean(String(searchValue || "").trim());
}

export function displayRoleMode(sessionRole) {
  if (sessionRole === "god") return "God view";
  if (sessionRole === "admin") return "Admin view";
  if (sessionRole === "power-user") return "Power user view";
  return "Team view";
}

export function hasValidRequestItemId(request) {
  return Boolean(String(request?.itemId || "").trim());
}

export function requestMatchesScope(request, {
  scope,
  sessionUser,
  sameUser,
  requestUser
}) {
  if (scope === "__mine__") return sameUser(requestUser(request), sessionUser);
  if (scope === "__team__") return !sameUser(requestUser(request), sessionUser);
  return true;
}

export function requestOpenStatsForItem(itemId, {
  recentRequests,
  sameUser,
  requestUser,
  sessionUser,
  isStandingOrder
}) {
  const open = recentRequests
    .filter((request) => String(request.itemId) === String(itemId))
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !isStandingOrder(request));
  return {
    mine: open.filter((request) => sameUser(requestUser(request), sessionUser)).length,
    team: open.filter((request) => !sameUser(requestUser(request), sessionUser)).length,
    total: open.length
  };
}

export function isStandingDue(order, today) {
  const expected = String(order?.expectedDate || "").trim();
  return Boolean(expected) && expected <= today;
}

export function orderingItemMatchesSummary(item, {
  orderingSummaryFilter,
  today,
  requestOpenStatsForItem,
  selected,
  recentRequests,
  isStandingOrder,
  isOlderOpenRequest,
  standingOrders
}) {
  if (orderingSummaryFilter === "all") return true;
  const openStats = requestOpenStatsForItem(item.id);
  if (orderingSummaryFilter === "saved") return selected.has(item.id);
  if (orderingSummaryFilter === "mine") return openStats.mine > 0;
  if (orderingSummaryFilter === "team") return openStats.team > 0;
  if (orderingSummaryFilter === "older") {
    return recentRequests.some((request) =>
      String(request.itemId) === String(item.id)
      && !request.received
      && request.status !== "Fulfilled"
      && !request.standingRunId
      && !isStandingOrder(request)
      && isOlderOpenRequest(request, today)
    );
  }
  if (orderingSummaryFilter === "below") {
    return Number(item.quantity || 0) < Number(item.minimum || 0);
  }
  if (orderingSummaryFilter === "standing") {
    return standingOrders.some((order) =>
      isStandingDue(order, today)
      && (order.items || []).some((line) => String(line.itemId) === String(item.id))
    );
  }
  return true;
}

export function orderingRequestMatchesSummary(request, {
  orderingSummaryFilter,
  today,
  allItems,
  selected,
  sameUser,
  sessionUser,
  requestUser,
  isOlderOpenRequest
}) {
  if (orderingSummaryFilter === "all") return true;
  const item = allItems.find((candidate) => String(candidate.id) === String(request.itemId));
  if (!item) return false;
  if (orderingSummaryFilter === "saved") return selected.has(item.id);
  if (orderingSummaryFilter === "mine") return sameUser(requestUser(request), sessionUser);
  if (orderingSummaryFilter === "team") return !sameUser(requestUser(request), sessionUser);
  if (orderingSummaryFilter === "older") return isOlderOpenRequest(request, today);
  if (orderingSummaryFilter === "below") return Number(item.quantity || 0) < Number(item.minimum || 0);
  if (orderingSummaryFilter === "standing") return false;
  return true;
}
