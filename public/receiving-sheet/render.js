import {
  escapeHtml,
  formatUserDisplay,
  groupBySupplier,
  logicalRequestCompare,
  receivingItemDateLabel,
  receivingOriginClass,
  receivingOriginTitle,
  supplierNoteMap
} from "./helpers.js";

function buildReceivingDisplayRows(requests = []) {
  return [...requests]
    .sort(logicalRequestCompare)
    .map((request) => ({
      key: `receiving-${String(request.id || "").trim()}`,
      requestId: request.id,
      rowClass: receivingOriginClass(request),
      supplierName: request.supplierName || "",
      itemName: request.itemName || "",
      itemDateLabel: receivingItemDateLabel(request),
      openQuantity: Number(request.quantity || 0),
      receiveQuantity: Number(request.quantity || 0),
      unit: request.unit || "",
      unitPrice: request.unitPrice,
      shelfCode: request.shelfCode || "",
      inventoryArea: request.inventoryArea || "",
      storageLocation: request.storageLocation || "",
      originTitle: receivingOriginTitle(request),
      request
    }));
}

export function renderReceivingSheet({
  data,
  sessionUser,
  currentSheet,
  receivingList,
  printDate,
  printReceiver
}) {
  currentSheet.date = data.date;
  currentSheet.requests = data.requests || [];
  currentSheet.suppliers = data.suppliers || [];
  currentSheet.supplierNotes = data.supplierNotes || [];
  currentSheet.displayRows = new Map();

  printDate.textContent = `Date: ${data.date}`;
  printReceiver.textContent = `Receiver: ${formatUserDisplay(sessionUser) || "________________"}`;

  if (!currentSheet.requests.length) {
    receivingList.innerHTML = '<p class="empty-sheet">No items waiting to be received.</p>';
    return;
  }

  const groups = groupBySupplier(currentSheet.requests);
  const notesBySupplier = supplierNoteMap(currentSheet.supplierNotes);
  receivingList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplier, requests]) => {
      const displayRows = buildReceivingDisplayRows(requests);
      displayRows.forEach((row) => currentSheet.displayRows.set(row.key, row));
      return `
      <section class="sheet-group">
        <div class="supplier-heading">
          <h2>${escapeHtml(supplier)}</h2>
        </div>
        <div class="supplier-note-card" data-supplier-note="${escapeHtml(supplier)}">
          <label>
            Supplier memo
            <textarea class="supplier-note-input" rows="2" placeholder="Add a short note if something is wrong with this delivery...">${escapeHtml(notesBySupplier.get(String(supplier || "").trim().toLowerCase())?.memo || "")}</textarea>
          </label>
          <button class="icon-button supplier-note-save" type="button">Save memo</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Item</th>
              <th>Open</th>
              <th>Receive qty</th>
              <th>Price</th>
              <th>Unit</th>
              <th>Shelf</th>
              <th>Area / Location</th>
              <th>Remove</th>
            </tr>
          </thead>
            <tbody>
            ${displayRows
              .map((row) => `
                <tr class="${row.rowClass}" data-display-key="${escapeHtml(row.key)}" title="${escapeHtml(row.originTitle || "")}">
                  <td>
                    <button class="driver-check-button" type="button" data-action="received" aria-label="Mark ${escapeHtml(row.itemName)} received">
                      &nbsp;
                    </button>
                  </td>
                  <td>
                    <div class="receiving-item-name">${escapeHtml(row.itemName)}</div>
                    ${row.itemDateLabel ? `<div class="receiving-item-date">${escapeHtml(row.itemDateLabel)}</div>` : ""}
                  </td>
                  <td>${escapeHtml(row.openQuantity)}</td>
                  <td>
                    <input class="receive-qty-input" type="number" min="0.01" step="0.01" value="${escapeHtml(row.receiveQuantity)}" aria-label="Received quantity for ${escapeHtml(row.itemName)}">
                  </td>
                  <td>
                    <input class="receive-price-input compact-price-input" type="number" min="0" step="0.01" value="${row.unitPrice === null || row.unitPrice === undefined ? "" : escapeHtml(row.unitPrice)}" aria-label="Received price for ${escapeHtml(row.itemName)}">
                  </td>
                  <td>${escapeHtml(row.unit || "")}</td>
                  <td>${escapeHtml(row.shelfCode || "")}</td>
                  <td>${escapeHtml([row.inventoryArea, row.storageLocation].filter(Boolean).join(" / "))}</td>
                  <td>
                    <button class="small-button receiving-delete-button" type="button" aria-label="Remove ${escapeHtml(row.itemName)} from receiving">
                      Remove
                    </button>
                  </td>
                </tr>
              `)
              .join("")}
            </tbody>
        </table>
      </section>
    `;
    })
    .join("");
}
