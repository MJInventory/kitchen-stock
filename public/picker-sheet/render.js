import { escapeHtml, formatUserDisplay, groupByRequester } from "./helpers.js";

export function renderPickerBoard({ internalOrders, pickerGroups }) {
  const groups = groupByRequester(internalOrders);
  if (!groups.length) {
    pickerGroups.innerHTML = '<p class="empty-sheet">No internal requests waiting for the picker.</p>';
    return;
  }
  pickerGroups.innerHTML = groups.map(([requester, orders]) => `
    <section class="panel picker-requester-group">
      <div class="daily-order-heading">
        <h2>${escapeHtml(formatUserDisplay(requester))}</h2>
        <div class="top-actions">
          <span>${escapeHtml(`${orders.length} order(s)`)}</span>
          <button class="icon-button save-requester-group" type="button">Save ${escapeHtml(formatUserDisplay(requester))}</button>
        </div>
      </div>
      <div class="picker-batch-list">
        ${orders.map((order) => `
          <article class="picker-batch-card" data-batch-id="${escapeHtml(order.id)}" data-requester="${escapeHtml(requester)}">
            <div class="picker-batch-header">
              <div>
                <strong>${escapeHtml(`${order.lines.length} item(s)`)} </strong>
                <span>${escapeHtml(order.status)} / ${escapeHtml(order.requestedAt ? new Date(order.requestedAt).toLocaleString() : "")}</span>
              </div>
            </div>
            <div class="picker-line-list">
              ${order.lines.map((line) => `
                <div class="picker-line-row" data-line-id="${escapeHtml(line.id)}" data-batch-id="${escapeHtml(order.id)}">
                  <div class="picker-line-main">
                    <strong>${escapeHtml(line.itemName)}</strong>
                    <span>${escapeHtml([line.category, line.inventoryArea, line.storageLocation, line.shelfCode].filter(Boolean).join(" / "))}</span>
                    <small>Requested ${escapeHtml(line.requestedItemQuantity)} item(s) / stock about ${escapeHtml(line.currentStockItems)} item(s) / min ${escapeHtml(line.minimumThreshold || 0)} ${escapeHtml(line.unit || "box")}</small>
                  </div>
                  <label>
                    Pick now
                    <input class="picker-qty-input" type="number" min="0" step="1" max="${escapeHtml(line.requestedItemQuantity)}" value="${escapeHtml(line.pickedItemQuantity || line.requestedItemQuantity)}">
                  </label>
                  <div class="picker-line-shortage">Shortage: <strong>${escapeHtml(Math.max(0, Number(line.requestedItemQuantity || 0) - Number(line.pickedItemQuantity || line.requestedItemQuantity)))} item(s)</strong></div>
                  <label class="product-delete-toggle picker-remove-toggle">
                    <input class="picker-remove-input" type="checkbox">
                    <span>Remove request</span>
                  </label>
                </div>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}
