import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAdminUsers",
  messageSelector: "#unitMessage"
});

const unitForm = document.querySelector("#unitForm");
const unitList = document.querySelector("#unitList");
const unitMessage = document.querySelector("#unitMessage");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setUnitMessage(text, isError = false) {
  unitMessage.textContent = text;
  unitMessage.classList.toggle("error", isError);
}

function renderUnits(units) {
  unitList.innerHTML = (units || [])
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .map((unit) => `
      <article class="setting-row setup-admin-row supplier-row" data-unit-id="${esc(unit.id)}">
        <label>Unit
          <input class="unit-name" type="text" value="${esc(unit.name)}">
        </label>
        <label class="check-label"><input class="unit-active" type="checkbox" ${unit.active ? "checked" : ""}> Active</label>
        <button class="save-unit" type="button">Save</button>
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
  const saveButton = event.target.closest(".save-unit");
  if (saveButton) {
    const row = saveButton.closest("[data-unit-id]");
    saveButton.disabled = true;
    page.api(`/api/setup/units-of-measure/${row.dataset.unitId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".unit-name").value,
        active: row.querySelector(".unit-active").checked
      })
    })
      .then(loadUnits)
      .then(() => setUnitMessage("Unit saved."))
      .catch((error) => setUnitMessage(error.message, true))
      .finally(() => { saveButton.disabled = false; });
    return;
  }

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

page.ready(loadUnits);
