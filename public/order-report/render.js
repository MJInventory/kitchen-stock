import {
  escapeHtml,
  formatDateTime,
  formatUserDisplay,
  groupBySupplier,
  labelForActionType,
  labelForEntityType,
  labelForReasonCode,
  logicalRowCompare,
  reportRowToneClass,
  reportRowsForFilter
} from "./helpers.js";

function standingStatusLabel(order) {
  const expected = String(order?.expectedDate || "").trim();
  const today = new Date().toISOString().slice(0, 10);
  if (order?.active) {
    return expected && expected <= today ? "Due" : "Scheduled";
  }
  if (expected && expected >= today) {
    return "Scheduled";
  }
  return "Inactive";
}

function requestOwnerFromAudit(entry) {
  return String(
    entry?.after?.requestedBy
    || entry?.before?.requestedBy
    || entry?.after?.requested_by
    || entry?.before?.requested_by
    || entry?.after?.requestedByUsername
    || entry?.before?.requestedByUsername
    || ""
  ).trim();
}

function activityActorLabel(entry) {
  const actor = String(entry?.actorUsername || "").trim();
  const requestOwner = requestOwnerFromAudit(entry);
  if (actor && actor.toLowerCase() !== "system") {
    return `By ${formatUserDisplay(actor)}`;
  }
  if (requestOwner) {
    return `For ${formatUserDisplay(requestOwner)}`;
  }
  return "By System";
}

export function renderSummary({ reportSummary, summary, activeReportFilter }) {
  const cards = [
    ["Guests", summary.guests ?? "-", ""],
    ["Total lines", summary.totalLines || 0, "all"],
    ["Picked / ordered", summary.orderedLines || 0, "picked"],
    ["2Deliver", summary.toDeliverLines || 0, "deliver"],
    ["Delivered", summary.deliveredLines || 0, "delivered"],
    ["Waiting", summary.waitingLines || 0, "waiting"]
  ];

  reportSummary.innerHTML = cards
    .map(
      ([label, value, filter]) => `
        <article class="${filter ? "report-filter-card" : "report-info-card"}${filter && activeReportFilter === filter ? " active" : ""}"${filter ? ` data-report-filter="${escapeHtml(filter)}" role="button" tabindex="0"` : ""}>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </article>
      `
    )
    .join("");
}

export function renderStandingOrders({ orders, standingReportSummaryList, standingReportList }) {
  if (!orders.length) {
    standingReportSummaryList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    standingReportList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    return;
  }

  standingReportSummaryList.innerHTML = orders
    .map((order) => {
      const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [{ itemName: order.itemName, quantity: order.quantity }];
      return `
        <article class="standing-report-summary-row">
          <div>
            <strong>${escapeHtml(order.name || order.supplierName || "Standing Order")}</strong>
            <span>${escapeHtml(order.supplierName || "No supplier")}</span>
          </div>
          <div class="standing-report-summary-meta">
            <span><b>Expected</b> ${escapeHtml(order.expectedDate || "not set")}</span>
            <span><b>Schedule</b> ${escapeHtml(order.schedule || "Other")}</span>
            <span><b>Items</b> ${escapeHtml(items.length)}</span>
            <span><b>Status</b> ${escapeHtml(standingStatusLabel(order))}</span>
          </div>
        </article>
      `;
    })
    .join("");

  standingReportList.innerHTML = orders
    .map((order) => {
      const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [{ itemName: order.itemName, quantity: order.quantity }];
      return `
        <section class="sheet-group">
          <div class="supplier-heading">
            <h2>${escapeHtml(order.supplierName || order.name || "Standing Order")}</h2>
            <pre>${escapeHtml([
              order.expectedDate ? `Expected: ${order.expectedDate}` : "",
              order.schedule || "",
              standingStatusLabel(order)
            ].filter(Boolean).join(" / "))}</pre>
          </div>
          <table class="order-report-table">
            <thead>
              <tr>
                <th>Standing order</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Expected delivery</th>
                <th>Schedule</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((line) => `
                <tr>
                  <td>
                    ${escapeHtml(order.name || "Standing Order")}
                    <small>${escapeHtml(order.notes || "")}</small>
                  </td>
                  <td>${escapeHtml(line.itemName || order.itemName || "")}</td>
                  <td>${escapeHtml(line.quantity ?? order.quantity ?? "")}</td>
                  <td>${escapeHtml(order.expectedDate || "")}</td>
                  <td>${escapeHtml(order.schedule || "")}</td>
                  <td>${escapeHtml(standingStatusLabel(order))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");
}

export function renderActivity({ entries, summary, activitySummary, activityReportList, activeActivityFilter }) {
  const list = Array.isArray(entries) ? entries : [];
  const counts = summary || {};

  activitySummary.innerHTML = [
    ["Adds", Number(counts.adds || 0), "add"],
    ["Changes", Number(counts.changes || 0), "change"],
    ["Deletes", Number(counts.deletes || 0), "delete"],
    ["Users", Number(counts.users || 0), ""]
  ].map(([label, value, filter]) => `
    <article class="${filter ? "report-filter-card" : "report-info-card"}${filter && activeActivityFilter === filter ? " active" : ""}"${filter ? ` data-activity-filter="${escapeHtml(filter)}" role="button" tabindex="0"` : ""}>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `).join("");

  const visible = activeActivityFilter === "all"
    ? list
    : list.filter((entry) => entry.actionType === activeActivityFilter);

  if (!visible.length) {
    activityReportList.innerHTML = '<p class="empty-sheet">No recorded adds, changes, or deletes for this day.</p>';
    return;
  }

  activityReportList.innerHTML = visible
    .map((entry) => `
      <article class="activity-row action-${escapeHtml(entry.actionType)}">
        <div class="activity-row-top">
          <strong>${escapeHtml(entry.entityName || labelForEntityType(entry.entityType) || "Change")}</strong>
          <span>${escapeHtml(formatDateTime(entry.createdAt))}</span>
        </div>
        <div class="activity-row-meta">
          <span>${escapeHtml(labelForActionType(entry.actionType))}</span>
          <span>${escapeHtml(labelForEntityType(entry.entityType))}</span>
          <span>${escapeHtml(activityActorLabel(entry))}</span>
          ${entry.reasonCode ? `<span>${escapeHtml(labelForReasonCode(entry.reasonCode))}</span>` : ""}
        </div>
        ${entry.note ? `<p class="activity-note">${escapeHtml(entry.note)}</p>` : ""}
      </article>
    `)
    .join("");
}

export function renderReport({
  data,
  reportList,
  printDate,
  guestCountInput,
  guestNotesInput,
  reportSummary,
  standingReportSummaryList,
  standingReportList,
  activitySummary,
  activityReportList,
  activeReportFilter,
  activeActivityFilter
}) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const standingOrders = Array.isArray(data.standingOrders) ? data.standingOrders : [];
  printDate.textContent = `Date: ${data.date}`;
  guestCountInput.value = data.guestCount?.guests ?? "";
  guestNotesInput.value = data.guestCount?.notes ?? "";

  renderSummary({ reportSummary, summary: data.summary || {}, activeReportFilter });
  renderStandingOrders({ orders: standingOrders, standingReportSummaryList, standingReportList });
  renderActivity({ entries: data.activity || [], summary: data.activitySummary || {}, activitySummary, activityReportList, activeActivityFilter });

  const today = String(data.date || "").trim();
  const visibleRows = reportRowsForFilter(rows, activeReportFilter);
  if (!visibleRows.length) {
    reportList.innerHTML = '<p class="empty-sheet">No order lines found for this date.</p>';
    return;
  }

  const groups = groupBySupplier(visibleRows);
  reportList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplier, supplierRows]) => `
      <section class="sheet-group">
        <div class="supplier-heading">
          <h2>${escapeHtml(supplier)}</h2>
        </div>
        <table class="order-report-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Requested By</th>
              <th>Picked / Ordered</th>
              <th>2Deliver</th>
              <th>Delivered / Accepted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${supplierRows
              .sort((a, b) => {
                const waiting = Number(b.waiting) - Number(a.waiting);
                if (waiting) return waiting;
                return logicalRowCompare(a, b);
              })
              .map((row) => `
                <tr class="${reportRowToneClass(row, today)}">
                  <td>
                    ${escapeHtml(row.itemName)}
                    <small>${escapeHtml([row.inventoryArea, row.storageLocation, row.shelfCode].filter(Boolean).join(" / "))}</small>
                  </td>
                  <td>${escapeHtml(row.quantity ?? "")} ${escapeHtml(row.unit || "")}</td>
                  <td>
                    ${escapeHtml(row.requestedBy || "")}
                    <small>${escapeHtml(formatDateTime(row.requestedAt))}</small>
                  </td>
                  <td>
                    ${row.ordered ? "Yes" : "No"}
                    <small>${escapeHtml([row.orderedBy, formatDateTime(row.orderedAt)].filter(Boolean).join(" / "))}</small>
                  </td>
                  <td>${row.toDeliver ? "Yes" : "No"}</td>
                  <td>
                    ${row.delivered ? "Yes" : "No"}
                    <small>${escapeHtml([row.receivedBy, formatDateTime(row.receivedAt)].filter(Boolean).join(" / "))}</small>
                  </td>
                  <td>${escapeHtml(row.status)}</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </section>
    `)
    .join("");
}
