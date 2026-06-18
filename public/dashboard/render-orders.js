import { groupRequestsByCategory, itemNameFromRequest } from "../ordering/request-grouping.js";
import { escapeHtml, renderStatusChips } from "./render-shared.js";

export function renderDailyOrder({
  dailyOrderCount,
  dailyOrderList,
  recentRequests,
  selectedArea,
  requestArea,
  requesterMatches,
  requestDay,
  today,
  requestMatchesDashboardFilter,
  logicalRequestCompare,
  allItems,
  requestCategory,
  requestLocation,
  requestStatusChips,
  buildOrderJumpHref
}) {
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !selectedArea || requestArea(request) === selectedArea)
    .filter(requesterMatches)
    .filter((request) => requestDay(request) === today)
    .filter((request) => requestMatchesDashboardFilter(request, today))
    .sort(logicalRequestCompare);
  dailyOrderCount.textContent = `${activeRequests.length} active`;
  const grouped = groupRequestsByCategory(activeRequests.slice(0, 100), allItems);
  dailyOrderList.innerHTML = grouped
    .map(([category, requests]) => `
      <section class="daily-order-group">
        <div class="daily-order-group-heading">
          <h3>${escapeHtml(category)}</h3>
          <span>${requests.length} item${requests.length === 1 ? "" : "s"}</span>
        </div>
        <div class="daily-order-group-list">
          ${requests.map((request) => `
            <a class="daily-order-row daily-order-link ${request.partialReceipt ? "overdue-order-row" : ""}" href="${escapeHtml(buildOrderJumpHref(request))}">
              <div>
                <strong>${escapeHtml(itemNameFromRequest(request, allItems))}</strong>
                <span>${escapeHtml([
                  request.quantity,
                  requestCategory(request),
                  requestArea(request),
                  requestLocation(request)
                ].filter(Boolean).join(" / "))}</span>
                ${renderStatusChips(requestStatusChips(request, today))}
              </div>
            </a>
          `).join("")}
        </div>
      </section>
    `)
    .join("");

  if (!dailyOrderList.innerHTML) {
    dailyOrderList.innerHTML = '<p class="empty-sheet">No active orders yet.</p>';
  }
}

export function renderOpenOrders({
  openOrderCount,
  openOrderList,
  recentRequests,
  selectedArea,
  requestArea,
  requesterMatches,
  isOlderOpenRequest,
  today,
  requestMatchesDashboardFilter,
  logicalRequestCompare,
  allItems,
  requestDay,
  requestCategory,
  requestLocation,
  requestStatusChips,
  buildOrderJumpHref,
  overdueRowClass = () => ""
}) {
  const openRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !selectedArea || requestArea(request) === selectedArea)
    .filter(requesterMatches)
    .filter((request) => isOlderOpenRequest(request, today))
    .filter((request) => requestMatchesDashboardFilter(request, today))
    .sort(logicalRequestCompare);

  openOrderCount.textContent = `${openRequests.length} open`;
  const grouped = groupRequestsByCategory(openRequests.slice(0, 100), allItems);
  openOrderList.innerHTML = grouped
    .map(([category, requests]) => `
      <section class="daily-order-group">
        <div class="daily-order-group-heading">
          <h3>${escapeHtml(category)}</h3>
          <span>${requests.length} item${requests.length === 1 ? "" : "s"}</span>
        </div>
        <div class="daily-order-group-list">
          ${requests.map((request) => `
              <a class="daily-order-row daily-order-link ${escapeHtml(request.partialReceipt ? "overdue-order-row" : overdueRowClass(request, today))}" href="${escapeHtml(buildOrderJumpHref(request))}">
                <div>
                  <strong>${escapeHtml(itemNameFromRequest(request, allItems))}</strong>
                  <span>${escapeHtml([
                    request.quantity,
                    requestCategory(request),
                    requestArea(request),
                    requestLocation(request),
                    requestDay(request) ? `Requested ${requestDay(request)}` : ""
                  ].filter(Boolean).join(" / "))}</span>
                  ${renderStatusChips(requestStatusChips(request, today))}
                </div>
              </a>
            `).join("")}
        </div>
      </section>
    `)
    .join("");

  if (!openOrderList.innerHTML) {
    openOrderList.innerHTML = '<p class="empty-sheet">No older open orders.</p>';
  }
}

export function renderStandingOrders({
  standingOrderCount,
  standingOrderList,
  standingOrders,
  isOperationalRole,
  dashboardFilter,
  today
}) {
  const onlyDue = dashboardFilter === "standing";
  const baseOrders = onlyDue
    ? standingOrders.filter((order) => {
      const expected = String(order.expectedDate || "").trim();
      return expected && expected <= today;
    })
    : standingOrders;
  const visibleOrders = isOperationalRole ? baseOrders : baseOrders.slice(0, 6);
  standingOrderCount.textContent = `${standingOrders.length} scheduled`;
  if (!visibleOrders.length) {
    standingOrderList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    return;
  }
  standingOrderList.innerHTML = visibleOrders
    .slice(0, 100)
    .map((order) => `
      <a class="daily-order-row daily-order-link" href="/standing-orders.html?orderId=${encodeURIComponent(order.id)}">
        <div>
          <strong>${escapeHtml(order.supplierName || order.name || "Standing Order")}</strong>
          <span>${escapeHtml([
            order.expectedDate ? `Delivery ${order.expectedDate}` : "",
            order.schedule || "",
            order.items?.length ? `${order.items.length} item(s)` : ""
          ].filter(Boolean).join(" / "))}</span>
          ${renderStatusChips([
            ["Standing", "standing"],
            [String(order.expectedDate || "") <= today ? "Due now" : "Scheduled", String(order.expectedDate || "") <= today ? "high" : "today"]
          ])}
        </div>
      </a>
    `)
    .join("");
}
