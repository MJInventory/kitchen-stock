import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#standingMessage"
});

const form = document.querySelector("#standingOrderForm");
const itemSelect = document.querySelector("#standingItem");
const quantityInput = document.querySelector("#standingQuantity");
const supplierSelect = document.querySelector("#standingSupplier");
const message = document.querySelector("#standingMessage");
const standingItems = document.querySelector("#standingItems");
const standingList = document.querySelector("#standingList");
const standingRunList = document.querySelector("#standingRunList");

let items = [];
let suppliers = [];
let selectedItems = [];

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

function itemById(itemId) {
  return items.find((item) => item.id === itemId);
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

function addSelectedItem() {
  const item = itemById(itemSelect.value);
  const quantity = Number(quantityInput.value || 0);
  if (!item) {
    setMessage("Choose an inventory item.", true);
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    setMessage("Quantity must be greater than zero.", true);
    return;
  }

  const existing = selectedItems.find((line) => line.itemId === item.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    selectedItems.push({ itemId: item.id, itemName: item.name, quantity });
  }
  quantityInput.value = "1";
  setMessage("");
  renderSelectedItems();
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
  });
}

async function loadOptions() {
  setMessage("Loading inventory...");
  const [itemsData, optionsData] = await Promise.all([
    page.api("/api/items"),
    page.api("/api/item-form-options")
  ]);
  items = itemsData.items || [];
  suppliers = optionsData.suppliers || [];
  itemSelect.innerHTML = items
    .map((item) => `<option value="${esc(item.id)}">${esc(item.name)} (${esc(item.unit || "item")})</option>`)
    .join("");
  supplierSelect.innerHTML = '<option value="">Choose supplier</option>' + suppliers
    .map((supplier) => `<option value="${esc(supplier.name)}">${esc(supplier.name)}</option>`)
    .join("");
  document.querySelector("#expectedDate").value = todayLocal();
  renderSelectedItems();
  await loadStandingOrders();
  await loadStandingOrderRuns();
  setMessage("");
}

function optionsForSuppliers(selectedName) {
  return '<option value="">Choose supplier</option>' + suppliers
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
      </div>
    `;
  }).join("");
}

function collectOrderItems(row) {
  return [...row.querySelectorAll(".existing-line")].map((line) => ({
    itemId: line.dataset.itemId,
    itemName: line.dataset.itemName,
    quantity: Number(line.querySelector(".standing-line-qty").value || 0)
  }));
}

function renderStandingOrders(orders) {
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
      <label class="wide-field">Notes <textarea class="standing-notes" rows="2">${esc(order.notes || "")}</textarea></label>
      <button class="save-standing" type="button">Save</button>
    </article>
  `).join("");
  if (!standingList.innerHTML) {
    standingList.innerHTML = '<p class="empty-sheet">No standing orders yet.</p>';
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

document.querySelector("#addStandingItem").addEventListener("click", addSelectedItem);

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
    renderSelectedItems();
    await loadStandingOrders();
    await loadStandingOrderRuns();
    setMessage("Standing order saved. Due items will appear in the normal delivery workflow.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

standingList.addEventListener("click", (event) => {
  const button = event.target.closest(".save-standing");
  if (!button) return;
  const row = button.closest(".standing-order-row");
  button.disabled = true;
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
    .finally(() => { button.disabled = false; });
});

page.ready(loadOptions);
