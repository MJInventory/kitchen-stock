import { authPage } from "/page-auth.js";
import { esc, sortByLabel, todayLocal } from "./helpers.js";
import {
  optionsForSuppliers,
  renderSearchResults,
  renderSelectedItems,
  renderStandingOrderRuns,
  renderStandingOrders,
  renderStandingStatusCards,
  standingOrderMatchesStatusFilter,
  standingRunMatchesStatusFilter
} from "./render.js";

export function initStandingOrdersPage() {
  const page = authPage({
    permission: "canAddInventoryItems",
    messageSelector: "#standingMessage"
  });

  const form = document.querySelector("#standingOrderForm");
  const itemSearchInput = document.querySelector("#standingItemSearch");
  const itemResults = document.querySelector("#standingItemResults");
  const quantityInput = document.querySelector("#standingQuantity");
  const supplierSelect = document.querySelector("#standingSupplier");
  const message = document.querySelector("#standingMessage");
  const standingItems = document.querySelector("#standingItems");
  const standingList = document.querySelector("#standingList");
  const standingRunList = document.querySelector("#standingRunList");
  const standingStatusCards = document.querySelector("#standingStatusCards");
  const standingHistoryPanel = document.querySelector("#standingHistoryPanel");

  let items = [];
  let suppliers = [];
  let selectedItems = [];
  let standingOrders = [];
  let standingRuns = [];
  const requestedOrderId = new URLSearchParams(window.location.search).get("orderId") || "";
  let expandedOrderId = requestedOrderId || "";
  let expandedRunId = "";
  let standingStatusFilter = "open";

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
  }

  function itemById(itemId) {
    return items.find((item) => item.id === itemId);
  }

  function renderStandingStatusControls() {
    renderStandingStatusCards({
      orders: standingOrders,
      statusFilter: standingStatusFilter,
      standingStatusCards,
      standingRuns
    });
  }

  function canAdminStandingOrders() {
    try {
      const permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
      return Boolean(permissions.canAdminUsers);
    } catch {
      return false;
    }
  }

  function addItemToSelection(itemId, quantity, targetItems) {
    const item = itemById(itemId);
    if (!item) {
      setMessage("Choose an inventory item.", true);
      return false;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Quantity must be greater than zero.", true);
      return false;
    }

    const existing = targetItems.find((line) => line.itemId === item.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      targetItems.push({ itemId: item.id, itemName: item.name, quantity });
    }
    return true;
  }

  function collectSelectedItems() {
    return [...standingItems.querySelectorAll(".standing-item-line")].map((line) => {
      const index = Number(line.dataset.lineIndex);
      const original = selectedItems[index];
      return {
        itemId: original.itemId,
        itemName: original.itemName,
        quantity: Number(line.querySelector(".selected-standing-qty").value || 0)
      };
    }).filter((line) => line.itemId && line.quantity > 0);
  }

  async function loadOptions() {
    setMessage("Loading inventory...");
    const [itemsData, optionsData] = await Promise.all([
      page.api("/api/items"),
      page.api("/api/item-form-options")
    ]);
    items = itemsData.items || [];
    suppliers = optionsData.suppliers || [];
    supplierSelect.innerHTML = optionsForSuppliers(suppliers, "");
    document.querySelector("#expectedDate").value = todayLocal();
    renderSearchResults({ container: itemResults, query: "", items });
    renderSelectedItems({ selectedItems, standingItems, itemById });
    await loadStandingOrders();
    await loadStandingOrderRuns();
    setMessage("");
  }

  function renderStandingAddResults(row) {
    const query = row.querySelector(".standing-add-search")?.value || "";
    const container = row.querySelector(".standing-add-results");
    const excludeIds = [...row.querySelectorAll(".existing-line")].map((line) => line.dataset.itemId);
    renderSearchResults({ container, query, items, excludeIds });
  }

  function collectOrderItems(row) {
    return [...row.querySelectorAll(".existing-line")].map((line) => ({
      itemId: line.dataset.itemId,
      itemName: line.dataset.itemName,
      quantity: Number(line.querySelector(".standing-line-qty").value || 0)
    })).filter((line) => line.itemId && line.quantity > 0);
  }

  async function loadStandingOrders() {
    const data = await page.api("/api/standing-orders");
    standingOrders = data.standingOrders || [];
    if (requestedOrderId && standingStatusFilter === "open") {
      const requestedOrder = standingOrders.find((order) => order.id === requestedOrderId);
      const openRunOrderIds = new Set(
        standingRuns
          .filter((run) => standingRunMatchesStatusFilter(run, "open"))
          .map((run) => String(run?.standingOrderId || "").trim())
          .filter(Boolean)
      );
      if (requestedOrder && !standingOrderMatchesStatusFilter(requestedOrder, "open", openRunOrderIds)) {
        standingStatusFilter = "closed";
      }
    }
    renderStandingStatusControls();
    renderStandingOrders({
      orders: standingOrders,
      standingList,
      suppliers,
      requestedOrderId,
      expandedOrderId,
      canAdminStandingOrders: canAdminStandingOrders(),
      itemById,
      statusFilter: standingStatusFilter,
      standingRuns
    });
  }

  async function loadStandingOrderRuns() {
    const data = await page.api("/api/standing-order-runs");
    standingRuns = data.runs || [];
    renderStandingStatusControls();
    renderStandingOrderRuns({ runs: standingRuns, standingRunList, expandedRunId, statusFilter: standingStatusFilter });
  }

  itemSearchInput.addEventListener("input", () => {
    renderSearchResults({
      container: itemResults,
      query: itemSearchInput.value,
      items,
      excludeIds: selectedItems.map((line) => line.itemId)
    });
  });

  itemResults.addEventListener("click", (event) => {
    const button = event.target.closest(".search-pick-option");
    if (!button) return;
    const quantity = Number(quantityInput.value || 0);
    if (!addItemToSelection(button.dataset.itemId, quantity, selectedItems)) return;
    quantityInput.value = "1";
    itemSearchInput.value = "";
    renderSearchResults({ container: itemResults, query: "", items, excludeIds: selectedItems.map((line) => line.itemId) });
    renderSelectedItems({ selectedItems, standingItems, itemById });
    setMessage("");
  });

  standingItems.addEventListener("input", (event) => {
    const input = event.target.closest(".selected-standing-qty");
    if (!input) return;
    const row = input.closest(".standing-item-line");
    const index = Number(row.dataset.lineIndex);
    selectedItems[index].quantity = Number(input.value || 0);
  });

  standingItems.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-standing-item");
    if (!button) return;
    const row = button.closest(".standing-item-line");
    selectedItems.splice(Number(row.dataset.lineIndex), 1);
    renderSelectedItems({ selectedItems, standingItems, itemById });
    renderSearchResults({ container: itemResults, query: itemSearchInput.value, items, excludeIds: selectedItems.map((line) => line.itemId) });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const lines = collectSelectedItems();
    if (!lines.length) {
      setMessage("Add at least one inventory item.", true);
      return;
    }

    setMessage("Creating standing order...");
    try {
      await page.api("/api/standing-orders", {
        method: "POST",
        body: JSON.stringify({
          name: document.querySelector("#standingName").value,
          supplierName: supplierSelect.value,
          items: lines,
          expectedDate: document.querySelector("#expectedDate").value,
          schedule: document.querySelector("#schedule").value,
          otherSchedule: document.querySelector("#otherSchedule").value,
          notes: document.querySelector("#standingNotes").value
        })
      });
      selectedItems = [];
      form.reset();
      document.querySelector("#expectedDate").value = todayLocal();
      quantityInput.value = "1";
      itemSearchInput.value = "";
      renderSearchResults({ container: itemResults, query: "", items });
      renderSelectedItems({ selectedItems, standingItems, itemById });
      await loadStandingOrders();
      await loadStandingOrderRuns();
      setMessage("Standing order saved. Due items will appear in the normal delivery workflow.");
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  standingList.addEventListener("input", (event) => {
    const search = event.target.closest(".standing-add-search");
    if (search) {
      renderStandingAddResults(search.closest(".standing-order-row"));
    }
  });

  standingStatusCards?.addEventListener("click", (event) => {
    const statusCard = event.target.closest("[data-standing-status-filter]");
    if (statusCard) {
      const nextFilter = ["open", "closed", "all"].includes(statusCard.dataset.standingStatusFilter)
        ? statusCard.dataset.standingStatusFilter
        : "open";
      if (standingStatusFilter === nextFilter) return;
      standingStatusFilter = nextFilter;
      renderStandingStatusControls();
      renderStandingOrders({
        orders: standingOrders,
        standingList,
        suppliers,
        requestedOrderId,
        expandedOrderId,
        canAdminStandingOrders: canAdminStandingOrders(),
        itemById,
        statusFilter: standingStatusFilter,
        standingRuns
      });
      renderStandingOrderRuns({ runs: standingRuns, standingRunList, expandedRunId, statusFilter: standingStatusFilter });
      return;
    }
  });

  standingList.addEventListener("click", (event) => {
    const summaryButton = event.target.closest(".standing-order-summary");
    if (summaryButton) {
      const row = summaryButton.closest(".standing-order-row");
      const orderId = row?.dataset.orderId || "";
      expandedOrderId = expandedOrderId === orderId ? "" : orderId;
      loadStandingOrders().catch((error) => setMessage(error.message, true));
      return;
    }

    const addButton = event.target.closest(".search-pick-option");
    if (addButton) {
      const row = addButton.closest(".standing-order-row");
      const quantity = Number(row.querySelector(".standing-add-qty").value || 0);
      const item = itemById(addButton.dataset.itemId);
      if (!item || !Number.isFinite(quantity) || quantity <= 0) {
        setMessage("Choose a valid quantity before adding the item.", true);
        return;
      }
      const itemsContainer = row.querySelector(".standing-items");
      const existing = itemsContainer.querySelector(`.existing-line[data-item-id="${CSS.escape(item.id)}"]`);
      if (existing) {
        const qtyInput = existing.querySelector(".standing-line-qty");
        const nextQty = Number(qtyInput.value || 0) + quantity;
        qtyInput.value = nextQty;
        const openCell = existing.querySelector(".standing-sheet-open-display");
        if (openCell) openCell.textContent = String(nextQty);
      } else {
        const tableBody = itemsContainer.querySelector(".standing-order-table tbody");
        if (!tableBody) {
          setMessage("Standing order item list is not ready. Reload the screen and try again.", true);
          return;
        }
        const shelf = item.shelf || item.shelfCode || "TBD";
        const areaLocation = [item.area || item.inventoryArea, item.location || item.storageLocation].filter(Boolean).join(" / ") || "Unassigned";
        tableBody.insertAdjacentHTML("beforeend", `
          <tr class="standing-sheet-row standing-item-line existing-line" data-item-id="${esc(item.id)}" data-item-name="${esc(item.name)}">
            <td class="standing-sheet-item"><strong>${esc(item.name)}</strong></td>
            <td class="standing-sheet-open-display">${esc(quantity)}</td>
            <td class="standing-sheet-open">
              <input class="standing-line-qty" type="number" min="1" step="1" value="${esc(quantity)}" aria-label="Order quantity">
            </td>
            <td class="standing-sheet-unit"><span>${esc(item.unit || "item")}</span></td>
            <td class="standing-sheet-shelf">${esc(shelf)}</td>
            <td class="standing-sheet-location">${esc(areaLocation)}</td>
            <td class="standing-sheet-remove">
              <button class="remove-existing-standing-item secondary" type="button">Remove</button>
            </td>
          </tr>
        `);
      }
      row.querySelector(".standing-add-search").value = "";
      row.querySelector(".standing-add-qty").value = "1";
      renderStandingAddResults(row);
      setMessage("");
      return;
    }

    const removeExisting = event.target.closest(".remove-existing-standing-item");
    if (removeExisting) {
      removeExisting.closest(".existing-line")?.remove();
      const row = removeExisting.closest(".standing-order-row");
      renderStandingAddResults(row);
      return;
    }

    const saveButton = event.target.closest(".save-standing");
    if (saveButton) {
      const row = saveButton.closest(".standing-order-row");
      saveButton.disabled = true;
      setMessage("Saving standing order...");
      page.api(`/api/standing-orders/${row.dataset.orderId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: row.querySelector(".standing-name").value,
          supplierName: row.querySelector(".standing-supplier").value,
          items: collectOrderItems(row),
          expectedDate: row.querySelector(".standing-date").value,
          schedule: row.querySelector(".standing-schedule").value,
          otherSchedule: row.querySelector(".standing-other").value,
          active: row.querySelector(".standing-active").checked,
          notes: row.querySelector(".standing-notes").value
        })
      })
        .then(loadStandingOrders)
        .then(loadStandingOrderRuns)
        .then(() => setMessage("Standing order saved."))
        .catch((error) => setMessage(error.message, true))
        .finally(() => { saveButton.disabled = false; });
      return;
    }

    const deleteButton = event.target.closest(".delete-standing");
    if (deleteButton) {
      const row = deleteButton.closest(".standing-order-row");
      const name = row.querySelector(".standing-name")?.value || "this standing order";
      if (!window.confirm(`Delete ${name}? This removes it from the standing-order schedule.`)) return;
      deleteButton.disabled = true;
      setMessage("Deleting standing order...");
      page.api(`/api/standing-orders/${row.dataset.orderId}`, { method: "DELETE" })
        .then(loadStandingOrders)
        .then(loadStandingOrderRuns)
        .then(() => setMessage("Standing order deleted."))
        .catch((error) => setMessage(error.message, true))
        .finally(() => { deleteButton.disabled = false; });
    }
  });

  standingRunList.addEventListener("click", (event) => {
    const summaryButton = event.target.closest(".standing-run-summary");
    if (summaryButton) {
      const row = summaryButton.closest(".standing-run-card");
      const runId = row?.dataset.runId || "";
      expandedRunId = expandedRunId === runId ? "" : runId;
      renderStandingOrderRuns({ runs: standingRuns, standingRunList, expandedRunId, statusFilter: standingStatusFilter });
      return;
    }

    const receiveButton = event.target.closest(".standing-run-received-button");
    if (receiveButton) {
      const row = receiveButton.closest(".standing-run-line");
      const requestId = row?.dataset.requestId || "";
      const runLineId = row?.dataset.runLineId || "";
      const isReceived = row?.dataset.received === "true";
      const qtyInput = row?.querySelector(".standing-run-receive-qty");
      const receiveQty = Number(qtyInput?.value || 0);
      if (!requestId && !runLineId) {
        setMessage("Could not find the standing-order line to update.", true);
        return;
      }
      if (isReceived) {
        receiveButton.disabled = true;
        setMessage("Reopening item...");
        page.api(`/api/requests/${requestId}/undo-delivery`, { method: "POST" })
          .then(() => Promise.all([loadStandingOrders(), loadStandingOrderRuns()]))
          .then(() => setMessage("Standing-order delivery reopened."))
          .catch((error) => setMessage(error.message, true))
          .finally(() => { receiveButton.disabled = false; });
        return;
      }
      if (!Number.isFinite(receiveQty) || receiveQty <= 0) {
        setMessage("Receive quantity must be greater than zero.", true);
        return;
      }
      receiveButton.disabled = true;
      setMessage("Receiving item...");
      page.api(runLineId ? `/api/standing-order-run-lines/${runLineId}/deliver` : `/api/requests/${requestId}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          quantityReceived: receiveQty,
          receivedQuantity: receiveQty,
          receiveQuantity: receiveQty
        })
      })
        .then(() => Promise.all([loadStandingOrders(), loadStandingOrderRuns()]))
        .then(() => setMessage("Standing-order delivery updated."))
        .catch((error) => setMessage(error.message, true))
        .finally(() => { receiveButton.disabled = false; });
      return;
    }

    const deleteButton = event.target.closest(".standing-run-delete-button");
    if (deleteButton) {
      const row = deleteButton.closest(".standing-run-line");
      const requestId = row?.dataset.requestId || "";
      const runLineId = row?.dataset.runLineId || "";
      const itemName = row?.querySelector(".standing-sheet-item strong")?.textContent || "this item";
      if (!requestId && !runLineId) {
        setMessage("Could not find the standing-order line to remove.", true);
        return;
      }
      if (!window.confirm(`Remove ${itemName} from this standing order run?`)) return;
      deleteButton.disabled = true;
      setMessage(`Removing ${itemName}...`);
      page.api(runLineId ? `/api/standing-order-run-lines/${runLineId}` : `/api/requests/${requestId}`, { method: "DELETE" })
        .then(() => Promise.all([loadStandingOrders(), loadStandingOrderRuns()]))
        .then(() => setMessage(`${itemName} removed.`))
        .catch((error) => setMessage(error.message, true))
        .finally(() => { deleteButton.disabled = false; });
    }
  });

  standingRunList.addEventListener("change", (event) => {
    const qtyInput = event.target.closest(".standing-run-open-qty");
    if (!qtyInput) return;
    const row = qtyInput.closest(".standing-run-line");
    const runLineId = row?.dataset.runLineId || "";
    const quantity = Number(qtyInput.value || 0);
    if (!runLineId) {
      setMessage("Could not find the standing-order line to update.", true);
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Quantity must be greater than zero.", true);
      return;
    }
    qtyInput.disabled = true;
    setMessage("Saving quantity...");
    page.api(`/api/standing-order-run-lines/${runLineId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity })
    })
      .then(() => Promise.all([loadStandingOrders(), loadStandingOrderRuns()]))
      .then(() => setMessage("Standing-order quantity updated."))
      .catch((error) => setMessage(error.message, true))
      .finally(() => { qtyInput.disabled = false; });
  });

  page.ready(loadOptions);
}
