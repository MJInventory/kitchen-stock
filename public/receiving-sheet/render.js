import {
  escapeHtml,
  formatUserDisplay,
  groupBySupplier,
  logicalRequestCompare,
  receivingOriginClass,
  supplierNoteMap
} from "./helpers.js";

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
    .map(([supplier, requests]) => `
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
            ${requests
              .sort(logicalRequestCompare)
              .map((request) => `
                <tr class="${receivingOriginClass(request)}" data-line-id="${escapeHtml(request.driverLineId || "")}" data-request-id="${escapeHtml(request.id || "")}">
                  <td>
                    <button class="driver-check-button${request.delivered ? " checked" : ""}" type="button" data-action="received" ${request.driverLineId ? "" : "disabled"} aria-label="Mark received">
                      ${request.delivered ? "&#10003;" : ""}
                    </button>
                  </td>
                  <td>${escapeHtml(request.itemName)}</td>
                  <td>${escapeHtml(request.quantity ?? "")}</td>
                  <td>
                    <input class="receive-qty-input" type="number" min="0.01" step="0.01" value="${escapeHtml(request.quantity ?? "")}" ${request.driverLineId ? "" : "disabled"} aria-label="Received quantity for ${escapeHtml(request.itemName)}">
                  </td>
                  <td>${escapeHtml(request.unit || "")}</td>
                  <td>${escapeHtml(request.shelfCode || "")}</td>
                  <td>${escapeHtml([request.inventoryArea, request.storageLocation].filter(Boolean).join(" / "))}</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </section>
    `)
    .join("");
}
