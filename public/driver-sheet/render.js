import {
  isStandingOrderRequest,
  formatUserDisplay,
  requestIsOlderThanDays,
  escapeHtml,
  groupRequests,
  logicalRequestCompare,
  supplierOptions,
  unitOptions
} from "./helpers.js";

export function renderSheet(data, elements) {
  const currentSheet = {
    ...data,
    requests: (data.requests || []).filter((request) => !isStandingOrderRequest(request)),
    units: data.units || []
  };

  elements.driverName.value = formatUserDisplay(data.driverName || elements.driverName.value || "");
  elements.printDate.textContent = `Date: ${data.date}`;
  elements.printDriver.textContent = `Driver: ${formatUserDisplay(elements.driverName.value) || "________________"}`;

  if (!currentSheet.requests.length) {
    elements.sheetList.innerHTML = '<p class="empty-sheet">No pending or approved requests for this date.</p>';
    return currentSheet;
  }

  const groups = groupRequests(currentSheet.requests);
  elements.sheetList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, supplier]) => `
      <section class="sheet-group">
        <div class="supplier-heading supplier-text-trigger" role="button" tabindex="0" data-supplier-name="${escapeHtml(supplier.supplier)}" aria-label="Open text list for ${escapeHtml(supplier.supplier)}">
          <h2>${escapeHtml(supplier.supplier)}</h2>
          ${supplier.contact ? `<pre>${escapeHtml(supplier.contact)}</pre>` : ""}
        </div>
        ${[...supplier.categories.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, category]) => `
            <div class="driver-supplier">
              <div class="driver-supplier-title">
                <h3>${escapeHtml(category.category)}</h3>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Ordered</th>
                    <th>Delivered</th>
                    <th>Item</th>
                    <th>Supplier</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Priority</th>
                    <th>2Deliver</th>
                    <th>Delivery Day</th>
                  </tr>
                </thead>
                <tbody>
                  ${category.requests
                    .sort(logicalRequestCompare)
                    .map((request) => `
                      <tr class="${requestIsOlderThanDays(request, 7) ? "driver-overdue-row" : ""}" data-line-id="${escapeHtml(request.driverLineId || "")}" data-request-id="${escapeHtml(request.id || "")}">
                        <td>
                          <button class="driver-check-button${request.ordered ? " checked" : ""}" type="button" data-action="ordered" ${request.driverLineId ? "" : "disabled"} aria-label="Mark ordered">
                            ${request.ordered ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>
                          <button class="driver-check-button${request.delivered ? " checked" : ""}" type="button" data-action="delivered" ${request.driverLineId || request.delivered ? "" : "disabled"} aria-label="Mark delivered">
                            ${request.delivered ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>${escapeHtml(request.itemName)}</td>
                        <td>
                          <select class="driver-supplier-select" ${request.driverLineId ? "" : "disabled"} aria-label="Supplier for ${escapeHtml(request.itemName)}">
                            ${supplierOptions(request.supplierName, currentSheet.suppliers || [])}
                          </select>
                          <span class="print-value">${escapeHtml(request.supplierName || "Unassigned Supplier")}</span>
                        </td>
                        <td>
                          <input class="driver-qty-input" type="number" min="0.01" step="0.01" value="${escapeHtml(request.quantity ?? "")}" ${request.driverLineId ? "" : "disabled"} aria-label="Quantity for ${escapeHtml(request.itemName)}">
                          <span class="print-value">${escapeHtml(request.quantity ?? "")}</span>
                        </td>
                        <td>
                          <select class="driver-unit-select" ${request.driverLineId ? "" : "disabled"} aria-label="Unit for ${escapeHtml(request.itemName)}">
                            ${unitOptions(request.unit, currentSheet.units)}
                          </select>
                          <span class="print-value">${escapeHtml(request.unit || "item")}</span>
                        </td>
                        <td>${escapeHtml(request.urgency || "")}</td>
                        <td>
                          <button class="driver-check-button${request.toDeliver ? " checked" : ""}" type="button" data-action="toDeliver" ${request.driverLineId ? "" : "disabled"} aria-label="Mark 2Deliver">
                            ${request.toDeliver ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>
                          <input class="delivery-day-input" type="date" value="${escapeHtml(request.deliveryDay || "")}" ${request.driverLineId ? "" : "disabled"} aria-label="Delivery day for ${escapeHtml(request.itemName)}">
                          <span class="print-value">${escapeHtml(request.deliveryDay || "")}</span>
                        </td>
                      </tr>
                    `)
                    .join("")}
                </tbody>
              </table>
            </div>
          `)
          .join("")}
      </section>
    `)
    .join("");

  return currentSheet;
}
