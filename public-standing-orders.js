import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#standingMessage"
});

const form = document.querySelector("#standingOrderForm");
const itemSelect = document.querySelector("#standingItem");
const supplierSelect = document.querySelector("#standingSupplier");
const message = document.querySelector("#standingMessage");
const standingList = document.querySelector("#standingList");

let items = [];
let suppliers = [];

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
    .map((item) => `<option value="${item.id}" data-unit="${item.unit || ""}">${item.name} (${item.unit || "item"})</option>`)
    .join("");
  supplierSelect.innerHTML = '<option value="">Default item supplier</option>' + suppliers
    .map((supplier) => `<option value="${supplier.name}">${supplier.name}</option>`)
    .join("");
  document.querySelector("#expectedDate").value = todayLocal();
  await loadStandingOrders();
  setMessage("");
}

function optionsForItems(selectedId) {
  return items.map((item) => `<option value="${item.id}"${item.id === selectedId ? " selected" : ""}>${item.name}</option>`).join("");
}

function optionsForSuppliers(selectedName) {
  return '<option value="">Default item supplier</option>' + suppliers
    .map((supplier) => `<option value="${supplier.name}"${supplier.name === selectedName ? " selected" : ""}>${supplier.name}</option>`)
    .join("");
}

function renderStandingOrders(orders) {
  standingList.innerHTML = orders.map((order) => `
    <article class="setting-row standing-order-row" data-order-id="${order.id}">
      <div>
        <strong>${order.itemName || "Standing order"}</strong>
        <span>${order.schedule} / next ${order.expectedDate || "not set"} / ${order.active ? "active" : "inactive"}</span>
      </div>
      <label>Item <select class="standing-item">${optionsForItems(order.itemId)}</select></label>
      <label>Supplier <select class="standing-supplier">${optionsForSuppliers(order.supplierName)}</select></label>
      <label>Qty <input class="standing-qty" type="number" min="1" step="1" value="${order.quantity || 1}"></label>
      <label>Next arrival <input class="standing-date" type="date" value="${order.expectedDate || todayLocal()}"></label>
      <label>Schedule
        <select class="standing-schedule">
          ${["Daily", "Weekly", "One Time", "Other"].map((value) => `<option${value === order.schedule ? " selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <label>Other <input class="standing-other" type="text" value="${order.otherSchedule || ""}"></label>
      <label class="check-label"><input class="standing-active" type="checkbox" ${order.active ? "checked" : ""}> Active</label>
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Creating standing order...");
  try {
    await page.api("/api/standing-orders", {
      method: "POST",
      body: JSON.stringify({
        itemId: itemSelect.value,
        supplierName: supplierSelect.value,
        quantityNeeded: document.querySelector("#standingQuantity").value,
        expectedDate: document.querySelector("#expectedDate").value,
        schedule: document.querySelector("#schedule").value,
        otherSchedule: document.querySelector("#otherSchedule").value,
        notes: document.querySelector("#standingNotes").value
      })
    });
    await loadStandingOrders();
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
      itemId: row.querySelector(".standing-item").value,
      supplierName: row.querySelector(".standing-supplier").value,
      quantityNeeded: row.querySelector(".standing-qty").value,
      expectedDate: row.querySelector(".standing-date").value,
      schedule: row.querySelector(".standing-schedule").value,
      otherSchedule: row.querySelector(".standing-other").value,
      active: row.querySelector(".standing-active").checked
    })
  })
    .then(loadStandingOrders)
    .then(() => setMessage("Standing order saved."))
    .catch((error) => setMessage(error.message, true))
    .finally(() => { button.disabled = false; });
});

page.ready(loadOptions);
