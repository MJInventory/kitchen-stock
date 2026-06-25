import { esc, scheduleOptions, sortByLabel, todayLocal } from "./helpers.js";

function standingStatusLabel(order) {
  if (String(order?.statusLabel || "").trim()) return String(order.statusLabel).trim();
  const expected = String(order?.expectedDate || "").trim();
  const today = todayLocal();
  if (order?.active) {
    return expected && expected <= today ? "Due" : "Scheduled";
  }
  if (expected && expected >= today) {
    return "Scheduled";
  }
  return "Inactive";
}

export function standingOrderMatchesStatusFilter(order, filter = "open") {
  const status = String(order?.statusLabel || "").trim().toLowerCase();
  const isCompletedLike = status === "completed" || status === "closed" || status === "inactive";
  const isOpen = order?.active !== false && !isCompletedLike;
  return filter === "all" ? true : isOpen;
}

function standingLineQuantity(line) {
  const value = Number(line?.openQuantity ?? line?.remainingQuantity ?? line?.quantity ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function standingOpenSummary(order) {
  const lines = Array.isArray(order?.items) ? order.items : [];
  const totalValue = Number(order?.totalLines ?? lines.length);
  const reportedOpen = Number(order?.openLines);
  const computedOpen = lines.filter((line) => standingLineQuantity(line) > 0).length;
  const total = Number.isFinite(totalValue) ? totalValue : lines.length;
  const open = Number.isFinite(reportedOpen) && reportedOpen > 0 ? reportedOpen : computedOpen;
  return `${open} open of ${total} item(s)`;
}

function standingShelf(line, item) {
  return line?.shelf || line?.shelfCode || item?.shelf || item?.shelfCode || "TBD";
}

function standingAreaLocation(line, item) {
  const area = line?.area || line?.inventoryArea || item?.area || item?.inventoryArea || "";
  const location = line?.location || line?.storageLocation || item?.location || item?.storageLocation || "";
  return [area, location].filter(Boolean).join(" / ") || "Unassigned";
}

export function renderSelectedItems({ selectedItems, standingItems, itemById }) {
  if (!selectedItems.length) {
    standingItems.innerHTML = '<p class="empty-sheet">No items added yet.</p>';
    return;
  }

  standingItems.innerHTML = selectedItems.map((line, index) => {
    const item = itemById(line.itemId);
    return `
      <div class="standing-item-line" data-line-index="${index}">
        <strong>${esc(item?.name || line.itemName || "Inventory item")}</strong>
        <span>${esc(item?.unit || "item")}</span>
        <input class="selected-standing-qty" type="number" min="1" step="1" value="${esc(line.quantity || 1)}" aria-label="Quantity">
        <button class="remove-standing-item secondary" type="button">Remove</button>
      </div>
    `;
  }).join("");
}

export function renderSearchResults({ container, query, items, excludeIds = [] }) {
  const search = String(query || "").trim().toLowerCase();
  const excluded = new Set(excludeIds);
  if (!search) {
    container.innerHTML = '<p class="empty-sheet">Type to search inventory items.</p>';
    return;
  }

  const matches = sortByLabel(items.filter((item) => {
    if (excluded.has(item.id)) return false;
    return String(item.name || "").toLowerCase().includes(search);
  }), (item) => item.name).slice(0, 12);

  if (!matches.length) {
    container.innerHTML = '<p class="empty-sheet">No matching inventory items.</p>';
    return;
  }

  container.innerHTML = matches.map((item) => `
    <button class="search-pick-option" type="button" data-item-id="${esc(item.id)}">
      <strong>${esc(item.name)}</strong>
      <span>${esc(item.unit || "item")} / ${esc(item.inventoryArea || "No area")} / ${esc(item.storageLocation || "No location")}</span>
    </button>
  `).join("");
}

export function optionsForSuppliers(suppliers, selectedName) {
  return '<option value="">Choose supplier</option>' + sortByLabel(suppliers, (supplier) => supplier.name)
    .map((supplier) => `<option value="${esc(supplier.name)}"${supplier.name === selectedName ? " selected" : ""}>${esc(supplier.name)}</option>`)
    .join("");
}

export function renderOrderItems({ order, itemById }) {
  const lines = Array.isArray(order.items) && order.items.length
    ? order.items
    : [{ itemId: order.itemId, itemName: order.itemName, quantity: order.quantity || 1 }];
  const rows = lines.map((line) => {
    const item = itemById(line.itemId);
    const itemName = line.itemName || item?.name || "Inventory item";
    const unit = line.unit || item?.unit || "item";
    const quantity = standingLineQuantity(line) || 1;
    const shelf = standingShelf(line, item);
    const areaLocation = standingAreaLocation(line, item);
    return `
      <tr class="standing-sheet-row standing-item-line existing-line" data-item-id="${esc(line.itemId)}" data-item-name="${esc(itemName)}">
        <td class="standing-sheet-item"><strong>${esc(itemName)}</strong></td>
        <td class="standing-sheet-open-display">${esc(quantity)}</td>
        <td class="standing-sheet-open">
          <input class="standing-line-qty" type="number" min="1" step="1" value="${esc(quantity)}" aria-label="Order quantity">
        </td>
        <td class="standing-sheet-unit"><span>${esc(unit)}</span></td>
        <td class="standing-sheet-shelf">${esc(shelf)}</td>
        <td class="standing-sheet-location">${esc(areaLocation)}</td>
        <td class="standing-sheet-remove">
          <button class="remove-existing-standing-item secondary" type="button">Remove</button>
        </td>
      </tr>
    `;
  }).join("");
  return `
    <div class="standing-sheet">
      <table class="standing-order-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Open</th>
            <th>Order qty</th>
            <th>Unit</th>
            <th>Shelf</th>
            <th>Area / Location</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function renderStandingStatusCards({ orders, activeFilter, standingStatusCards }) {
  if (!standingStatusCards) return;
  const allOrders = Array.isArray(orders) ? orders : [];
  const openCount = allOrders.filter((order) => standingOrderMatchesStatusFilter(order, "open")).length;
  const showingAll = activeFilter === "all";
  standingStatusCards.innerHTML = `
    <button class="dashboard-card dashboard-filter-card active standing-status-toggle" type="button" data-standing-status-filter="${showingAll ? "open" : "all"}" aria-pressed="${showingAll ? "true" : "false"}">
      <strong>${esc(showingAll ? allOrders.length : openCount)}</strong>
      <span>${esc(showingAll ? "All Standing Orders" : "Open Standing Orders")}</span>
      <small>${esc(showingAll ? "Click to hide completed standing orders" : "Click to show completed standing orders too")}</small>
    </button>
  `;
}

export function renderStandingOrders({
  orders,
  standingList,
  suppliers,
  requestedOrderId,
  expandedOrderId,
  canAdminStandingOrders,
  itemById,
  statusFilter = "open"
}) {
  const showDelete = canAdminStandingOrders;
  const filteredOrders = (Array.isArray(orders) ? orders : []).filter((order) => standingOrderMatchesStatusFilter(order, statusFilter));
  standingList.innerHTML = filteredOrders.map((order) => `
    <article class="setting-row standing-order-row${expandedOrderId === order.id ? " expanded" : ""}" data-order-id="${esc(order.id)}">
      <button
        class="standing-order-summary"
        type="button"
        aria-expanded="${expandedOrderId === order.id ? "true" : "false"}"
        data-status="${esc(String(standingStatusLabel(order) || "").toLowerCase())}"
      >
        <span class="standing-summary-main">
          <strong>${esc(order.name || order.supplierName || "Standing order")}</strong>
          <span>${esc(order.supplierName || "No supplier")}</span>
          <span class="standing-summary-subline">
            ${esc(standingOpenSummary(order))}
          </span>
        </span>
        <span class="standing-summary-meta">
          <span><b>Frequency</b> ${esc(order.schedule || "Other")}</span>
          <span><b>Expected</b> ${esc(order.expectedDate || "not set")}</span>
          <span><b>Status</b> ${esc(standingStatusLabel(order))}</span>
        </span>
      </button>
      <div class="standing-order-body">
        <section class="sheet-group standing-sheet-group">
          <div class="standing-order-grid standing-order-grid--top">
            <label>Name <input class="standing-name" type="text" value="${esc(order.name || "")}"></label>
            <label>Supplier <select class="standing-supplier">${optionsForSuppliers(suppliers, order.supplierName)}</select></label>
            <label>Delivery date <input class="standing-date" type="date" value="${esc(order.expectedDate || todayLocal())}"></label>
            <label>Schedule <select class="standing-schedule">${scheduleOptions(order.schedule)}</select></label>
            <label>Other <input class="standing-other" type="text" value="${esc(order.otherSchedule || "")}"></label>
            <label class="check-label standing-active-label"><input class="standing-active" type="checkbox" ${order.active ? "checked" : ""}> Active</label>
          </div>
          <div class="supplier-note-card standing-note-card">
            <label>Supplier memo
              <textarea class="standing-notes supplier-note-input" rows="2">${esc(order.notes || "")}</textarea>
            </label>
            <button class="save-standing icon-button" type="button">Save standing order</button>
          </div>
          <div class="standing-sheet-shell">
            ${renderOrderItems({ order, itemById })}
          </div>
          <div class="standing-order-grid standing-order-grid--bottom standing-sheet-add">
            <label class="wide-field">Add item search
              <input class="standing-add-search" type="search" placeholder="Search inventory items to add">
            </label>
            <label>Qty <input class="standing-add-qty" type="number" min="1" step="1" value="1"></label>
          </div>
          <div class="standing-add-results search-pick-list"><p class="empty-sheet">Type to search inventory items.</p></div>
          <div class="standing-row-actions standing-sheet-actions">
            ${showDelete ? '<button class="delete-standing danger" type="button">Delete</button>' : ""}
          </div>
        </section>
      </div>
    </article>
  `).join("");

  if (!standingList.innerHTML) {
    standingList.innerHTML = `<p class="empty-sheet">No ${statusFilter === "open" ? "open " : ""}standing orders yet.</p>`;
  }

  if (requestedOrderId) {
    const row = standingList.querySelector(`.standing-order-row[data-order-id="${CSS.escape(requestedOrderId)}"]`);
    if (row) {
      row.classList.add("jump-highlight");
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => row.classList.remove("jump-highlight"), 2600);
    }
  }
}

export function renderStandingOrderRuns({ runs, standingRunList, expandedRunId }) {
  if (!runs.length) {
    standingRunList.innerHTML = '<p class="empty-sheet">No standing order runs generated yet.</p>';
    return;
  }

  const renderRunItems = (run) => `
    <div class="standing-sheet">
      <table class="standing-order-table standing-run-table">
        <thead>
          <tr>
            <th>Received</th>
            <th>Item</th>
            <th>Open</th>
            <th>Receive qty</th>
            <th>Unit</th>
            <th>Shelf</th>
            <th>Area / Location</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          ${(run.lines || []).map((line) => {
            const areaLocation = [line.inventoryArea, line.storageLocation].filter(Boolean).join(" / ");
            const isReceived = Boolean(line.received);
            return `
              <tr class="standing-sheet-row standing-run-line${isReceived ? " standing-run-line--received" : ""}" data-request-id="${esc(line.orderRequestId || "")}" data-run-line-id="${esc(line.id || "")}">
                <td class="standing-run-line-received">
                  <button class="driver-check-button standing-run-received-button${isReceived ? " checked" : ""}" type="button" ${isReceived ? "disabled" : ""} aria-label="Mark ${esc(line.itemName || "item")} received">
                    ${isReceived ? "&#10003;" : "&nbsp;"}
                  </button>
                </td>
                <td class="standing-sheet-item"><strong>${esc(line.itemName || "Inventory item")}</strong></td>
                <td class="standing-sheet-open-display">${esc(line.quantity ?? "")}</td>
                <td class="standing-sheet-open">
                  <input class="standing-line-qty standing-run-receive-qty" type="number" min="0.01" step="0.01" value="${esc(line.quantity ?? "")}" aria-label="Received quantity for ${esc(line.itemName || "item")}" ${isReceived ? "disabled" : ""}>
                </td>
                <td class="standing-sheet-unit"><span>${esc(line.unit || "")}</span></td>
                <td class="standing-sheet-shelf">${esc(line.shelfCode || "TBD")}</td>
                <td class="standing-sheet-location">${esc(areaLocation || "Unassigned")}</td>
                <td class="standing-sheet-remove">
                  ${isReceived ? "" : `<button class="small-button receiving-delete-button standing-run-delete-button" type="button">Remove</button>`}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  standingRunList.innerHTML = runs.map((run) => {
    const statusLabel = String(run.status || (run.openLines > 0 ? "Open" : "Closed")).trim();
    const statusKey = statusLabel.toLowerCase() === "closed" ? "completed" : "due";
    const isExpanded = expandedRunId === run.id;
    return `
      <article class="setting-row standing-order-row standing-run-card${isExpanded ? " expanded" : ""}" data-run-id="${esc(run.id)}">
        <button
          class="standing-order-summary standing-run-summary"
          type="button"
          aria-expanded="${isExpanded ? "true" : "false"}"
          data-status="${esc(statusKey)}"
        >
          <span class="standing-summary-main">
            <strong>${esc(run.name || run.standingOrderName || "Standing order run")}</strong>
            <span>${esc(run.supplierName || "No supplier")} / ${esc(run.expectedDate || "No date")} / ${esc(statusLabel)}</span>
            <span class="standing-summary-subline">${esc(`${run.openLines ?? 0} open of ${run.totalLines ?? 0} line(s)`)}</span>
          </span>
          <span class="standing-summary-meta">
            <span><b>Received</b> ${esc(run.receivedLines ?? 0)} / ${esc(run.totalLines ?? 0)}</span>
            <span><b>Generated</b> ${esc((run.generatedAt || "").slice(0, 10) || "unknown")}</span>
            <span>${run.closedAt ? `Closed ${esc(run.closedAt.slice(0, 10))}` : "Not closed yet"}</span>
          </span>
        </button>
        <div class="standing-order-body standing-run-body">
          <section class="sheet-group standing-sheet-group">
            <div class="standing-sheet-shell">
              ${renderRunItems(run)}
            </div>
          </section>
        </div>
      </article>
    `;
  }).join("");
}
