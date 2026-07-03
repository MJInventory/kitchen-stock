import { authPage } from "/page-auth.js";
import { bindAutosaveRows, bindDeleteAction, createStatusPresenter } from "/admin-crud-helpers.js";

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

const setUnitMessage = createStatusPresenter(unitMessage);

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

bindDeleteAction({
  container: unitList,
  buttonSelector: ".delete-unit",
  rowSelector: "[data-unit-id]",
  onDelete: async (row) => {
  const name = row.querySelector(".unit-name")?.value || "this unit";
  if (!window.confirm(`Delete ${name}?`)) return;
  await page.api(`/api/setup/units-of-measure/${row.dataset.unitId}`, {
    method: "DELETE"
  });
  await loadUnits();
  setUnitMessage("Unit deleted.");
  },
  onError: (error) => setUnitMessage(error.message, true)
});

bindAutosaveRows({
  container: unitList,
  rowSelector: "[data-unit-id]",
  isDirty: isUnitDirty,
  saveRow: saveUnitRow,
  onError: (error) => setUnitMessage(error.message, true)
});

page.ready(loadUnits);
