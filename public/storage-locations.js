import { authPage } from "/page-auth.js";
import { bindAutosaveRows, createStatusPresenter } from "/admin-crud-helpers.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#locationMessage"
});

const form = document.querySelector("#locationForm");
const locationList = document.querySelector("#locationList");
const message = document.querySelector("#locationMessage");
let locationRecords = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

const setMessage = createStatusPresenter(message);

function renderLocations(locations) {
  locationRecords = locations || [];
  locationList.innerHTML = locations.map((location) => `
    <article class="setting-row setup-admin-row" data-location-id="${escapeHtml(location.id)}">
      <label>Name <input class="location-name" type="text" value="${escapeHtml(location.name)}"></label>
      <label class="check-label"><input class="location-active" type="checkbox" ${location.active ? "checked" : ""}> Active</label>
    </article>
  `).join("");

  if (!locationList.innerHTML) {
    locationList.innerHTML = '<p class="empty-sheet">No storage locations yet.</p>';
  }
}

async function loadLocations() {
  setMessage("Loading locations...");
  const data = await page.api("/api/setup/storage-locations");
  renderLocations(data.storageLocations || []);
  setMessage("");
}

function getLocationRecord(row) {
  return locationRecords.find((location) => location.id === row.dataset.locationId);
}

function isLocationDirty(row) {
  const record = getLocationRecord(row);
  if (!record) return false;
  return (row.querySelector(".location-name")?.value || "") !== String(record.name || "")
    || Boolean(row.querySelector(".location-active")?.checked) !== Boolean(record.active);
}

async function saveLocationRow(row) {
  if (!row || row.dataset.saving === "true" || !isLocationDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setMessage("Saving location...");
  try {
    await page.api(`/api/setup/storage-locations/${row.dataset.locationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".location-name").value,
        active: row.querySelector(".location-active").checked
      })
    });
    await loadLocations();
    setMessage("Storage location saved.");
  } finally {
    row.dataset.saving = "false";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Adding location...");
  try {
    await page.api("/api/setup/storage-locations", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#locationName").value,
        active: document.querySelector("#locationActive").checked
      })
    });
    form.reset();
    document.querySelector("#locationActive").checked = true;
    await loadLocations();
    setMessage("Storage location added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

bindAutosaveRows({
  container: locationList,
  rowSelector: ".setup-admin-row",
  isDirty: isLocationDirty,
  saveRow: saveLocationRow,
  onError: (error) => setMessage(error.message, true)
});

page.ready(loadLocations);







