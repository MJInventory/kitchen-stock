import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAdminUsers",
  messageSelector: "#unitMessage"
});

const unitForm = document.querySelector("#unitForm");
const unitList = document.querySelector("#unitList");
const unitMessage = document.querySelector("#unitMessage");
let unitRecords = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setUnitMessage(text, isError = false) {
  unitMessage.textContent = text;
  unitMessage.classList.toggle("error", isError);
}

function renderUnits(units) {
  unitRecords = units || [];
  unitList.innerHTML = (units || [])
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .map((unit) => `
      <article class="setting-row setup-admin-row supplier-row" data-unit-id="${esc(unit.id)}">
        <label>Unit
          <input class="unit-name" type="text" value="${esc(unit.name)}">
        </label>
        <label class="check-label"><input class="unit-active" type="checkbox" ${unit.active ? "checked" : ""}> Active</label>
        <button class="danger-button delete-unit" type="button">Delete</button>
      </article>
    `)
    .join("");

  if (!unitList.innerHTML) {
    unitList.innerHTML = '<p class="empty-sheet">No units yet.</p>';
  }
}

async function loadUnits() {
  setUnitMessage("Loading units...");
  const data = await page.api("/api/setup/units-of-measure");
  renderUnits(data.units || []);
  setUnitMessage("");
}

function getUnitRecord(row) {
  return unitRecords.find((unit) => unit.id === row.dataset.unitId);
}

function isUnitDirty(row) {
  const record = getUnitRecord(row);
  if (!record) return false;
  return (row.querySelector(".unit-name")?.value || "") !== String(record.name || "")
    || Boolean(row.querySelector(".unit-active")?.checked) !== Boolean(record.active);
}

async function saveUnitRow(row) {
  if (!row || row.dataset.saving === "true" || !isUnitDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setUnitMessage("Saving unit...");
  try {
    await page.api(`/api/setup/units-of-measure/${row.dataset.unitId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".unit-name").value,
        active: row.querySelector(".unit-active").checked
      })
    });
    await loadUnits();
    setUnitMessage("Unit saved.");
  } finally {
    row.dataset.saving = "false";
  }
}

unitForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setUnitMessage("Adding unit...");
  try {
    await page.api("/api/setup/units-of-measure", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#unitName").value,
        active: document.querySelector("#unitActive").checked
      })
    });
    unitForm.reset();
    document.querySelector("#unitActive").checked = true;
    await loadUnits();
    setUnitMessage("Unit added.");
  } catch (error) {
    setUnitMessage(error.message, true);
  }
});

unitList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".delete-unit");
  if (!deleteButton) return;
  const row = deleteButton.closest("[data-unit-id]");
  const name = row.querySelector(".unit-name")?.value || "this unit";
  if (!window.confirm(`Delete ${name}?`)) return;
  deleteButton.disabled = true;
  page.api(`/api/setup/units-of-measure/${row.dataset.unitId}`, {
    method: "DELETE"
  })
    .then(loadUnits)
    .then(() => setUnitMessage("Unit deleted."))
    .catch((error) => setUnitMessage(error.message, true))
    .finally(() => { deleteButton.disabled = false; });
});

unitList.addEventListener("input", (event) => {
  const row = event.target.closest("[data-unit-id]");
  if (!row) return;
  row.classList.toggle("dirty", isUnitDirty(row));
});

unitList.addEventListener("change", (event) => {
  const row = event.target.closest("[data-unit-id]");
  if (!row) return;
  row.classList.toggle("dirty", isUnitDirty(row));
});

unitList.addEventListener("focusout", (event) => {
  const row = event.target.closest("[data-unit-id]");
  if (!row) return;
  const next = event.relatedTarget;
  if (next && row.contains(next)) return;
  saveUnitRow(row).catch((error) => setUnitMessage(error.message, true));
});

page.ready(loadUnits);
