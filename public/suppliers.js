import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#supplierMessage"
});

const supplierForm = document.querySelector("#supplierForm");
const supplierList = document.querySelector("#supplierList");
const supplierMessage = document.querySelector("#supplierMessage");
let supplierRecords = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setSupplierMessage(text, isError = false) {
  supplierMessage.textContent = text;
  supplierMessage.classList.toggle("error", isError);
}

function renderSuppliers(suppliers) {
  supplierRecords = suppliers || [];
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
        <button class="danger-button delete-supplier" type="button">Delete</button>
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

function getSupplierRecord(row) {
  return supplierRecords.find((supplier) => supplier.id === row.dataset.supplierId);
}

function isSupplierDirty(row) {
  const record = getSupplierRecord(row);
  if (!record) return false;
  return (row.querySelector(".supplier-name")?.value || "") !== String(record.name || "")
    || (row.querySelector(".supplier-contact")?.value || "") !== String(record.contact || "")
    || Boolean(row.querySelector(".supplier-active")?.checked) !== Boolean(record.active);
}

async function saveSupplierRow(row) {
  if (!row || row.dataset.saving === "true" || !isSupplierDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setSupplierMessage("Saving supplier...");
  try {
    await page.api(`/api/setup/suppliers/${row.dataset.supplierId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".supplier-name").value,
        contact: row.querySelector(".supplier-contact").value,
        active: row.querySelector(".supplier-active").checked
      })
    });
    await loadSuppliers();
    setSupplierMessage("Supplier saved.");
  } finally {
    row.dataset.saving = "false";
  }
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
  const deleteButton = event.target.closest(".delete-supplier");
  if (!deleteButton) return;
  const row = deleteButton.closest(".supplier-row");
  const supplierName = row.querySelector(".supplier-name").value.trim() || "this supplier";
  if (!window.confirm(`Delete supplier ${supplierName}?`)) return;
  if (!window.confirm("Really delete this supplier? This cannot be undone.")) return;
  deleteButton.disabled = true;
  page.api(`/api/setup/suppliers/${row.dataset.supplierId}`, { method: "DELETE" })
    .then(loadSuppliers)
    .then(() => setSupplierMessage("Supplier deleted."))
    .catch((error) => setSupplierMessage(error.message, true))
    .finally(() => { deleteButton.disabled = false; });
});

supplierList.addEventListener("input", (event) => {
  const row = event.target.closest(".supplier-row");
  if (!row) return;
  row.classList.toggle("dirty", isSupplierDirty(row));
});

supplierList.addEventListener("change", (event) => {
  const row = event.target.closest(".supplier-row");
  if (!row) return;
  row.classList.toggle("dirty", isSupplierDirty(row));
});

supplierList.addEventListener("focusout", (event) => {
  const row = event.target.closest(".supplier-row");
  if (!row) return;
  const next = event.relatedTarget;
  if (next && row.contains(next)) return;
  saveSupplierRow(row).catch((error) => setSupplierMessage(error.message, true));
});

page.ready(loadSuppliers);
