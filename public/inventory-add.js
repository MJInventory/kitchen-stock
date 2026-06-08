import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  loginTitle: "Add Item",
  messageSelector: "#itemMessage"
});

const form = document.querySelector("#itemForm");
const categoryInput = document.querySelector("#category");
const inventoryAreaInput = document.querySelector("#inventoryArea");
const supplierId = document.querySelector("#supplierId");
const storageLocationInput = document.querySelector("#storageLocation");
const shelfCodeSelect = document.querySelector("#shelfCode");
const unitInput = document.querySelector("#unit");
const itemMessage = document.querySelector("#itemMessage");
let shelfCodes = [];

function setMessage(text, isError = false) {
  itemMessage.textContent = text;
  itemMessage.classList.toggle("error", isError);
}

function fillSelect(select, records, selectedValue = "", placeholder = "Choose...") {
  const normalized = (records || []).map((record) => typeof record === "string" ? { name: record } : record);
  select.innerHTML = [
    `<option value="">${placeholder}</option>`,
    ...normalized.map((record) => {
      const value = record.name ?? "";
      const label = record.displayName || record.name || value;
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
  ].join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function renderShelfOptions(selectedValue = "") {
  const selectedLocation = String(storageLocationInput.value || "").trim().toLowerCase();
  const matching = shelfCodes.filter((shelf) => !selectedLocation || String(shelf.storageLocation || "").trim().toLowerCase() === selectedLocation);
  const options = matching.length ? matching : shelfCodes;
  shelfCodeSelect.innerHTML = [
    '<option value="">Choose shelf code</option>',
    ...options.map((shelf) => `<option value="${escapeHtml(shelf.name)}"${shelf.name === selectedValue ? " selected" : ""}>${escapeHtml(shelf.displayName || shelf.name)}</option>`)
  ].join("");
  if (!shelfCodeSelect.value && options.length) {
    shelfCodeSelect.value = selectedValue || options[0].name || "";
  }
}

async function loadOptions() {
  setMessage("Loading options...");
  const data = await page.api("/api/item-form-options");
  fillSelect(categoryInput, data.categories || [], "", "Choose category");
  fillSelect(inventoryAreaInput, data.inventoryAreas || [], "", "Choose area");
  fillSelect(storageLocationInput, data.storageLocations || [], "", "Choose storage location");
  fillSelect(unitInput, data.units || [], "item", "Choose unit");
  shelfCodes = data.shelfCodes || [];
  renderShelfOptions("TBD");
  supplierId.innerHTML = '<option value="">Unassigned</option>' + (data.suppliers || [])
    .map((supplier) => `<option value="${supplier.id}">${supplier.name}</option>`)
    .join("");
  setMessage("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Adding item...");
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    ["itemName", "category", "storageLocation", "inventoryArea", "shelfCode", "unit"].forEach((id) => {
      payload[id] = document.querySelector(`#${id}`).value;
    });
    payload.supplierId = supplierId.value;
    payload.currentQuantity = document.querySelector("#currentQuantity").value;
    payload.minimumThreshold = document.querySelector("#minimumThreshold").value;
    await page.api("/api/items", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    categoryInput.value = "";
    inventoryAreaInput.value = "";
    storageLocationInput.value = "";
    unitInput.value = "item";
    renderShelfOptions("TBD");
    setMessage("Item added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

storageLocationInput.addEventListener("change", () => renderShelfOptions(shelfCodeSelect.value));
storageLocationInput.addEventListener("input", () => renderShelfOptions(shelfCodeSelect.value));

page.ready(loadOptions);







