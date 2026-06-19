import {
  escapeHtml,
  formatUserDisplay,
  groupBySupplier,
  logicalRequestCompare,
  receivingOriginClass,
  receivingOriginTitle,
  supplierNoteMap
} from "./helpers.js";

function groupedReceivingKey(request) {
  return [
    String(request.supplierName || "").trim().toLowerCase(),
    String(request.itemId || request.itemName || "").trim().toLowerCase(),
    String(request.unit || "").trim().toLowerCase(),
    String(request.shelfCode || "").trim().toLowerCase(),
    String(request.inventoryArea || "").trim().toLowerCase(),
    String(request.storageLocation || "").trim().toLowerCase(),
    receivingOriginClass(request)
  ].join("|");
}

function buildReceivingDisplayRows(requests = []) {
  const rows = [];
  const grouped = new Map();
  const sorted = [...requests].sort(logicalRequestCompare);

  sorted.forEach((request) => {
    const key = groupedReceivingKey(request);
    const existing = grouped.get(key);
    if (!existing) {
      const row = {
        key: `group-${rows.length + 1}`,
        rowClass: receivingOriginClass(request),
        supplierName: request.supplierName || "",
        itemName: request.itemName || "",
        orderedQuantity: Number(request.quantity || 0),
        receiveQuantity: Number(request.quantity || 0),
        unit: request.unit || "",
        shelfCode: request.shelfCode || "",
        inventoryArea: request.inventoryArea || "",
        storageLocation: request.storageLocation || "",
        originTitle: receivingOriginTitle(request),
        requests: [request]
      };
      grouped.set(key, row);
      rows.push(row);
      return;
    }

    existing.orderedQuantity += Number(request.quantity || 0);
    existing.receiveQuantity += Number(request.quantity || 0);
    existing.requests.push(request);
  });

  return rows;
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
              <th>Ordered</th>
              <th>Receive qty</th>
              <th>Unit</th>
              <th>Shelf</th>
              <th>Area / Location</th>
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
                  <td>${escapeHtml(row.itemName)}</td>
                  <td>${escapeHtml(row.orderedQuantity)}</td>
                  <td>
                    <input class="receive-qty-input" type="number" min="0.01" step="0.01" value="${escapeHtml(row.receiveQuantity)}" aria-label="Received quantity for ${escapeHtml(row.itemName)}">
                  </td>
                  <td>${escapeHtml(row.unit || "")}</td>
                  <td>${escapeHtml(row.shelfCode || "")}</td>
                  <td>${escapeHtml([row.inventoryArea, row.storageLocation].filter(Boolean).join(" / "))}</td>
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
