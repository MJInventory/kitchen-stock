import { authPage } from "/page-auth.js";

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

let items = [];
let suppliers = [];
let selectedItems = [];
const requestedOrderId = new URLSearchParams(window.location.search).get("orderId") || "";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function sortByLabel(records, getLabel) {
  return [...(records || [])].sort((left, right) =>
    String(getLabel(left) || "").localeCompare(String(getLabel(right) || ""), undefined, { numeric: true })
  );
}

function itemById(itemId) {
  return items.find((item) => item.id === itemId);
}

function canAdminStandingOrders() {
  try {
    const permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
    return Boolean(permissions.canAdminUsers);
  } catch {
    return false;
  }
}

function renderSelectedItems() {
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

function renderSearchResults(container, query, options = {}) {
  const search = String(query || "").trim().toLowerCase();
  const excludeIds = new Set(options.excludeIds || []);
  if (!search) {
    container.innerHTML = '<p class="empty-sheet">Type to search inventory items.</p>';
    return;
  }

  const matches = sortByLabel(items.filter((item) => {
    if (excludeIds.has(item.id)) return false;
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
  supplierSelect.innerHTML = '<option value="">Choose supplier</option>' + sortByLabel(suppliers, (supplier) => supplier.name)
    .map((supplier) => `<option value="${esc(supplier.name)}">${esc(supplier.name)}</option>`)
    .join("");
  document.querySelector("#expectedDate").value = todayLocal();
  renderSearchResults(itemResults, "");
  renderSelectedItems();
  await loadStandingOrders();
  await loadStandingOrderRuns();
  setMessage("");
}

function optionsForSuppliers(selectedName) {
  return '<option value="">Choose supplier</option>' + sortByLabel(suppliers, (supplier) => supplier.name)
    .map((supplier) => `<option value="${esc(supplier.name)}"${supplier.name === selectedName ? " selected" : ""}>${esc(supplier.name)}</option>`)
    .join("");
}

function scheduleOptions(selectedSchedule) {
  return ["Daily", "Weekly", "One Time", "Other"]
    .map((value) => `<option${value === selectedSchedule ? " selected" : ""}>${value}</option>`)
    .join("");
}

function renderOrderItems(order) {
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

function renderStandingAddResults(row) {
  const query = row.querySelector(".standing-add-search")?.value || "";
  const container = row.querySelector(".standing-add-results");
  const excludeIds = [...row.querySelectorAll(".existing-line")].map((line) => line.dataset.itemId);
  renderSearchResults(container, query, { excludeIds });
}

function collectOrderItems(row) {
  return [...row.querySelectorAll(".existing-line")].map((line) => ({
    itemId: line.dataset.itemId,
    itemName: line.dataset.itemName,
    quantity: Number(line.querySelector(".standing-line-qty").value || 0)
  })).filter((line) => line.itemId && line.quantity > 0);
}

function renderStandingOrders(orders) {
  const showDelete = canAdminStandingOrders();
  standingList.innerHTML = orders.map((order) => `
    <article class="setting-row standing-order-row" data-order-id="${esc(order.id)}">
      <div>
        <strong>${esc(order.name || order.supplierName || "Standing order")}</strong>
        <span>${esc(order.supplierName || "No supplier")} / ${esc(order.schedule)} / next ${esc(order.expectedDate || "not set")} / ${order.active ? "active" : "inactive"}</span>
      </div>
      <label>Name <input class="standing-name" type="text" value="${esc(order.name || "")}"></label>
      <label>Supplier <select class="standing-supplier">${optionsForSuppliers(order.supplierName)}</select></label>
      <label>Delivery date <input class="standing-date" type="date" value="${esc(order.expectedDate || todayLocal())}"></label>
      <label>Schedule <select class="standing-schedule">${scheduleOptions(order.schedule)}</select></label>
      <label>Other <input class="standing-other" type="text" value="${esc(order.otherSchedule || "")}"></label>
      <label class="check-label"><input class="standing-active" type="checkbox" ${order.active ? "checked" : ""}> Active</label>
      <div class="wide-field standing-items">${renderOrderItems(order)}</div>
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

async function loadStandingOrders() {
  const data = await page.api("/api/standing-orders");
  renderStandingOrders(data.standingOrders || []);
}

function renderStandingOrderRuns(runs) {
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

async function loadStandingOrderRuns() {
  const data = await page.api("/api/standing-order-runs");
  renderStandingOrderRuns(data.runs || []);
}

itemSearchInput.addEventListener("input", () => {
  renderSearchResults(itemResults, itemSearchInput.value, {
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
  renderSearchResults(itemResults, "", { excludeIds: selectedItems.map((line) => line.itemId) });
  renderSelectedItems();
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
  renderSelectedItems();
  renderSearchResults(itemResults, itemSearchInput.value, { excludeIds: selectedItems.map((line) => line.itemId) });
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
    renderSearchResults(itemResults, "");
    renderSelectedItems();
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

standingList.addEventListener("click", (event) => {
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
      qtyInput.value = Number(qtyInput.value || 0) + quantity;
    } else {
      itemsContainer.insertAdjacentHTML("beforeend", `
        <div class="standing-item-line existing-line" data-item-id="${esc(item.id)}" data-item-name="${esc(item.name)}">
          <strong>${esc(item.name)}</strong>
          <span>${esc(item.unit || "item")}</span>
          <input class="standing-line-qty" type="number" min="1" step="1" value="${esc(quantity)}" aria-label="Quantity">
          <button class="remove-existing-standing-item secondary" type="button">Remove</button>
        </div>
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

page.ready(loadOptions);
