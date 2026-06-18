import { esc, scheduleOptions, sortByLabel, todayLocal } from "./helpers.js";

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
  return lines.map((line) => {
    const item = itemById(line.itemId);
    return `
      <div class="standing-item-line existing-line" data-item-id="${esc(line.itemId)}" data-item-name="${esc(line.itemName || item?.name || "")}">
        <strong>${esc(line.itemName || item?.name || "Inventory item")}</strong>
        <span>${esc(item?.unit || "item")}</span>
        <input class="standing-line-qty" type="number" min="1" step="1" value="${esc(line.quantity || 1)}" aria-label="Quantity">
        <button class="remove-existing-standing-item secondary" type="button">Remove</button>
      </div>
    `;
  }).join("");
}

export function renderStandingOrders({
  orders,
  standingList,
  suppliers,
  requestedOrderId,
  expandedOrderId,
  canAdminStandingOrders,
  itemById
}) {
  const showDelete = canAdminStandingOrders;
  standingList.innerHTML = orders.map((order) => `
    <article class="setting-row standing-order-row${expandedOrderId === order.id ? " expanded" : ""}" data-order-id="${esc(order.id)}">
      <button class="standing-order-summary" type="button" aria-expanded="${expandedOrderId === order.id ? "true" : "false"}">
        <span class="standing-summary-main">
          <strong>${esc(order.name || order.supplierName || "Standing order")}</strong>
          <span>${esc(order.supplierName || "No supplier")}</span>
        </span>
        <span class="standing-summary-meta">
          <span><b>Frequency</b> ${esc(order.schedule || "Other")}</span>
          <span><b>Expected</b> ${esc(order.expectedDate || "not set")}</span>
          <span><b>Status</b> ${order.active ? "Active" : "Inactive"}</span>
        </span>
      </button>
      <div class="standing-order-body">
        <div class="standing-order-grid">
          <label>Name <input class="standing-name" type="text" value="${esc(order.name || "")}"></label>
          <label>Supplier <select class="standing-supplier">${optionsForSuppliers(suppliers, order.supplierName)}</select></label>
          <label>Delivery date <input class="standing-date" type="date" value="${esc(order.expectedDate || todayLocal())}"></label>
          <label>Schedule <select class="standing-schedule">${scheduleOptions(order.schedule)}</select></label>
          <label>Other <input class="standing-other" type="text" value="${esc(order.otherSchedule || "")}"></label>
          <label class="check-label"><input class="standing-active" type="checkbox" ${order.active ? "checked" : ""}> Active</label>
          <div class="wide-field standing-items">${renderOrderItems({ order, itemById })}</div>
          <div class="wide-field standing-edit-adder">
            <label class="wide-field">Add item search
              <input class="standing-add-search" type="search" placeholder="Search inventory items to add">
            </label>
            <label>Qty <input class="standing-add-qty" type="number" min="1" step="1" value="1"></label>
            <div class="standing-add-results search-pick-list"><p class="empty-sheet">Type to search inventory items.</p></div>
          </div>
          <label class="wide-field">Notes <textarea class="standing-notes" rows="2">${esc(order.notes || "")}</textarea></label>
          <div class="standing-row-actions wide-field">
            <button class="save-standing" type="button">Save</button>
            ${showDelete ? '<button class="delete-standing danger" type="button">Delete</button>' : ""}
          </div>
        </div>
      </div>
    </article>
  `).join("");

  if (!standingList.innerHTML) {
    standingList.innerHTML = '<p class="empty-sheet">No standing orders yet.</p>';
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

export function renderStandingOrderRuns({ runs, standingRunList }) {
  if (!runs.length) {
    standingRunList.innerHTML = '<p class="empty-sheet">No standing order runs generated yet.</p>';
    return;
  }

  standingRunList.innerHTML = runs.map((run) => `
    <article class="setting-row standing-run-row">
      <div>
        <strong>${esc(run.name || run.standingOrderName || "Standing order run")}</strong>
        <span>${esc(run.supplierName || "No supplier")} / ${esc(run.expectedDate || "No date")} / ${esc(run.status || "Open")}</span>
      </div>
      <div>
        <strong>${esc(run.receivedLines ?? 0)} / ${esc(run.totalLines ?? 0)}</strong>
        <span>Received lines</span>
      </div>
      <div>
        <strong>${esc(run.closedBy || "")}</strong>
        <span>${run.closedAt ? `Closed ${esc(run.closedAt.slice(0, 10))}` : "Not closed yet"}</span>
      </div>
      <div class="wide-field standing-run-lines">
        ${(run.lines || []).map((line) => `
          <span class="${line.received ? "received-text" : ""}">
            ${line.received ? "Received" : "Open"} - ${esc(line.itemName)} - ${esc(line.quantity ?? "")} ${esc(line.unit || "")}${line.receivedBy ? ` by ${esc(line.receivedBy)}` : ""}
          </span>
        `).join("")}
      </div>
    </article>
  `).join("");
}
