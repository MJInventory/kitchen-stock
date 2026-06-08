import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  loginTitle: "Add Item",
  messageSelector: "#itemMessage"
});

const form = document.querySelector("#itemForm");
const supplierId = document.querySelector("#supplierId");
const itemMessage = document.querySelector("#itemMessage");

function setMessage(text, isError = false) {
  itemMessage.textContent = text;
  itemMessage.classList.toggle("error", isError);
}

function fillDatalist(id, records) {
  document.querySelector(id).innerHTML = records.map((record) => `<option value="${record.name}"></option>`).join("");
}

async function loadOptions() {
  setMessage("Loading options...");
  const data = await page.api("/api/item-form-options");
  fillDatalist("#categoryOptions", data.categories || []);
  fillDatalist("#areaOptions", data.inventoryAreas || []);
  fillDatalist("#locationOptions", data.storageLocations || []);
  fillDatalist("#subgroupOptions", data.inventorySubgroups || []);
  fillDatalist("#shelfOptions", data.shelfCodes || []);
  fillDatalist("#unitOptions", data.units || []);
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
    ["itemName", "category", "storageLocation", "inventoryArea", "inventorySubgroup", "shelfCode", "unit"].forEach((id) => {
      payload[id] = document.querySelector(`#${id}`).value;
    });
    payload.supplierId = supplierId.value;
    payload.currentQuantity = document.querySelector("#currentQuantity").value;
    payload.minimumThreshold = document.querySelector("#minimumThreshold").value;
    await page.api("/api/items", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    document.querySelector("#unit").value = "item";
    document.querySelector("#shelfCode").value = "TBD";
    setMessage("Item added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

page.ready(loadOptions);






