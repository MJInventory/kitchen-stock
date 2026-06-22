import {
  formatUserDisplay,
  localDateKey,
  openOrderThresholdDays,
  sameUser,
  todayLocal
} from "./shared.js";

export function isStandingOrder(request) {
  if (typeof request?.isStanding === "boolean") return request.isStanding;
  return Boolean(String(request?.standingRunId || "").trim())
    || Boolean(String(request?.standingRunLineId || "").trim())
    || /^standing run id:/im.test(String(request?.notes || ""))
    || /^standing run line id:/im.test(String(request?.notes || ""));
}

export function requestUser(request) {
  return String(request?.requestedBy || "").trim();
}

export function requestArea(request, items = []) {
  return request?.inventoryArea || items.find((item) => item.id === request?.itemId)?.inventoryArea || "";
}

export function requestLocation(request, items = []) {
  return request?.storageLocation || items.find((item) => item.id === request?.itemId)?.storageLocation || "";
}

export function requestDay(request) {
  return String(request?.requestDay || "").trim() || localDateKey(request?.requestedAt || "");
}

export function scheduledDeliveryDay(request) {
  return String(request?.deliveryDay || "").trim();
}

export function hasFutureScheduledDelivery(request, today = todayLocal()) {
  if (typeof request?.scheduledDeliveryFuture === "boolean") {
    return request.scheduledDeliveryFuture;
  }
  const deliveryDay = scheduledDeliveryDay(request);
  return Boolean(deliveryDay) && deliveryDay > today;
}

export function isOlderOpenRequest(request, today = todayLocal()) {
  const day = requestDay(request);
  if (!day || hasFutureScheduledDelivery(request, today)) return false;
  if (Number.isFinite(Number(request?.requestAgeDays))) {
    return Number(request.requestAgeDays) >= openOrderThresholdDays();
  }
  const requestedDate = new Date(`${day}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);
  const diffDays = Math.floor((todayDate.getTime() - requestedDate.getTime()) / 86400000);
  return diffDays >= openOrderThresholdDays();
}

export function isOpenAttentionRequest(request, today = todayLocal()) {
  return Boolean(request?.partialReceipt) || isOlderOpenRequest(request, today);
}

export function isInternalShortageRequest(request) {
  if (String(request?.originType || "").trim().toLowerCase() === "automatic") {
    return String(request?.notes || "").toLowerCase().includes("internal order shortage");
  }
  return String(request?.notes || "").toLowerCase().includes("internal order shortage");
}

export function isAutoMinimumRequest(request) {
  return String(request?.originType || "").trim().toLowerCase() === "automatic"
    || String(request?.requestedBy || "").trim().toLowerCase() === "auto minimum"
    || String(request?.notes || "").toLowerCase().includes("automatic minimum restock");
}

export function expectedDateFromRequest(request) {
  const match = String(request?.notes || "").match(/Expected arrival:\s*(\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : "";
}

export function requestStatusChips(request, sessionUser, today = todayLocal()) {
  const chips = [];
  if (request?.partialReceipt) chips.push(["Partial", "critical"]);
  if (hasFutureScheduledDelivery(request, today)) chips.push(["Scheduled", "deliver"]);
  else if (isOlderOpenRequest(request, today)) chips.push(["Older open", "older"]);
  else chips.push(["Today", "today"]);
  chips.push([
    sameUser(requestUser(request), sessionUser) ? "My item" : `By ${formatUserDisplay(requestUser(request) || "Team")}`,
    sameUser(requestUser(request), sessionUser) ? "mine" : "team"
  ]);
  if (isInternalShortageRequest(request)) chips.push(["Shortage", "critical"]);
  if (isAutoMinimumRequest(request)) chips.push(["Auto minimum", "deliver"]);
  if (request?.toDeliver) chips.push(["2Deliver", "deliver"]);
  if (String(request?.urgency || "").toLowerCase() === "high") chips.push(["High", "high"]);
  if (String(request?.urgency || "").toLowerCase() === "critical") chips.push(["Critical", "critical"]);
  return chips;
}

export function duplicateSourceLabel(request, today = todayLocal()) {
  const requestedByName = formatUserDisplay(requestUser(request) || "Team");
  const deliveryDay = String(request?.deliveryDay || "").trim();
  if (request?.partialReceipt) {
    return `Partly delivered earlier and still open${deliveryDay ? ` for ${deliveryDay}` : ""}`;
  }
  if (Boolean(request?.standingRunId) || isStandingOrder(request)) {
    const expected = deliveryDay || expectedDateFromRequest(request) || requestDay(request) || today;
    return `Standing order already open for ${expected}`;
  }
  if (request?.toDeliver) {
    return `Already scheduled for delivery${deliveryDay ? ` on ${deliveryDay}` : ""}`;
  }
  const day = requestDay(request) || today;
  return `Already ordered on ${day} by ${requestedByName}`;
}
