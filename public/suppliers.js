import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#supplierMessage"
});

const supplierForm = document.querySelector("#supplierForm");
const supplierList = document.querySelector("#supplierList");
const supplierMessage = document.querySelector("#supplierMessage");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setSupplierMessage(text, isError = false) {
  supplierMessage.textContent = text;
  supplierMessage.classList.toggle("error", isError);
}

function renderSuppliers(suppliers) {
  supplierList.innerHTML = (suppliers || [])
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .map((supplier) => `
      <article class="setting-row setup-admin-row supplier-row" data-supplier-id="${esc(supplier.id)}">
        <label>Supplier
          <input class="supplier-name" type="text" value="${esc(supplier.name)}">
        </label>
        <label>Contact information
          <textarea class="supplier-contact" rows="3">${esc(supplier.contact || "")}</textarea>
        </label>
        <label class="check-label"><input class="supplier-active" type="checkbox" ${supplier.active ? "checked" : ""}> Active</label>
        <button class="save-supplier" type="button">Save</button>
      </article>
    `)
    .join("");

  if (!supplierList.innerHTML) {
    supplierList.innerHTML = '<p class="empty-sheet">No suppliers yet.</p>';
  }
}

async function loadSuppliers() {
  setSupplierMessage("Loading suppliers...");
  const data = await page.api("/api/setup/suppliers");
  renderSuppliers(data.suppliers || []);
  setSupplierMessage("");
}

supplierForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSupplierMessage("Adding supplier...");
  try {
    await page.api("/api/setup/suppliers", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#supplierName").value,
        contact: document.querySelector("#supplierContact").value,
        active: document.querySelector("#supplierActive").checked
      })
    });
    supplierForm.reset();
    document.querySelector("#supplierActive").checked = true;
    await loadSuppliers();
    setSupplierMessage("Supplier added.");
  } catch (error) {
    setSupplierMessage(error.message, true);
  }
});

supplierList.addEventListener("click", (event) => {
  const saveButton = event.target.closest(".save-supplier");
  if (!saveButton) return;
  const row = saveButton.closest(".supplier-row");
  saveButton.disabled = true;
  page.api(`/api/setup/suppliers/${row.dataset.supplierId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: row.querySelector(".supplier-name").value,
      contact: row.querySelector(".supplier-contact").value,
      active: row.querySelector(".supplier-active").checked
    })
  })
    .then(loadSuppliers)
    .then(() => setSupplierMessage("Supplier saved."))
    .catch((error) => setSupplierMessage(error.message, true))
    .finally(() => { saveButton.disabled = false; });
});

page.ready(loadSuppliers);
