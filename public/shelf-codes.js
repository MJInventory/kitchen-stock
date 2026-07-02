import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#shelfMessage"
});

const locationForm = document.querySelector("#locationForm");
const locationList = document.querySelector("#locationList");
const locationMessage = document.querySelector("#locationMessage");
const shelfForm = document.querySelector("#shelfForm");
const shelfList = document.querySelector("#shelfList");
const shelfLocation = document.querySelector("#shelfLocation");
const shelfMessage = document.querySelector("#shelfMessage");

let storageLocations = [];
let locationRecords = [];
let shelfRecords = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setLocationMessage(text, isError = false) {
  locationMessage.textContent = text;
  locationMessage.classList.toggle("error", isError);
}

function setShelfMessage(text, isError = false) {
  shelfMessage.textContent = text;
  shelfMessage.classList.toggle("error", isError);
}

function locationOptions(selected = "") {
  return storageLocations
    .map((location) => `<option value="${escapeHtml(location.name)}"${location.name === selected ? " selected" : ""}>${escapeHtml(location.name)}</option>`)
    .join("");
}

function renderLocations(locations) {
  storageLocations = [...locations].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
  locationRecords = locations || [];
  locationList.innerHTML = storageLocations.map((location) => `
    <article class="setting-row setup-admin-row" data-location-id="${escapeHtml(location.id)}">
      <label>Name <input class="location-name" type="text" value="${escapeHtml(location.name)}"></label>
      <label class="check-label"><input class="location-active" type="checkbox" ${location.active ? "checked" : ""}> Active</label>
    </article>
  `).join("");

  if (!locationList.innerHTML) {
    locationList.innerHTML = '<p class="empty-sheet">No storage locations yet.</p>';
  }

  shelfLocation.innerHTML = locationOptions();
  shelfList.querySelectorAll(".shelf-location").forEach((select) => {
    const current = select.dataset.currentValue || select.value || "";
    select.innerHTML = locationOptions(current);
    select.value = current;
  });
}

function renderShelves(shelves) {
  shelfRecords = shelves || [];
  shelfLocation.innerHTML = locationOptions(shelfLocation.value);
  shelfList.innerHTML = shelves
    .sort((a, b) => {
      const location = String(a.storageLocation || "").localeCompare(String(b.storageLocation || ""), undefined, { numeric: true });
      if (location) return location;
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });
    })
    .map((shelf) => `
      <article class="setting-row setup-admin-row" data-shelf-id="${escapeHtml(shelf.id)}">
        <label>Shelf code <input class="shelf-name" type="text" value="${escapeHtml(shelf.name)}"></label>
        <label>Storage location <select class="shelf-location" data-current-value="${escapeHtml(shelf.storageLocation)}">${locationOptions(shelf.storageLocation)}</select></label>
        <label class="check-label"><input class="shelf-active" type="checkbox" ${shelf.active ? "checked" : ""}> Active</label>
      </article>
    `).join("");

  if (!shelfList.innerHTML) {
    shelfList.innerHTML = '<p class="empty-sheet">No shelf codes yet.</p>';
  }
}

async function loadEverything() {
  setLocationMessage("Loading...");
  setShelfMessage("Loading...");
  const [locationData, shelfData] = await Promise.all([
    page.api("/api/setup/storage-locations"),
    page.api("/api/setup/shelf-codes")
  ]);
  renderLocations(locationData.storageLocations || []);
  renderShelves(shelfData.shelfCodes || []);
  setLocationMessage("");
  setShelfMessage("");
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
  setLocationMessage("Saving location...");
  try {
    await page.api(`/api/setup/storage-locations/${row.dataset.locationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".location-name").value,
        active: row.querySelector(".location-active").checked
      })
    });
    await loadEverything();
    setLocationMessage("Storage location saved.");
  } finally {
    row.dataset.saving = "false";
  }
}

function getShelfRecord(row) {
  return shelfRecords.find((shelf) => shelf.id === row.dataset.shelfId);
}

function isShelfDirty(row) {
  const record = getShelfRecord(row);
  if (!record) return false;
  return (row.querySelector(".shelf-name")?.value || "") !== String(record.name || "")
    || (row.querySelector(".shelf-location")?.value || "") !== String(record.storageLocation || "")
    || Boolean(row.querySelector(".shelf-active")?.checked) !== Boolean(record.active);
}

async function saveShelfRow(row) {
  if (!row || row.dataset.saving === "true" || !isShelfDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setShelfMessage("Saving shelf...");
  try {
    await page.api(`/api/setup/shelf-codes/${row.dataset.shelfId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".shelf-name").value,
        storageLocation: row.querySelector(".shelf-location").value,
        active: row.querySelector(".shelf-active").checked
      })
    });
    await loadEverything();
    setShelfMessage("Shelf code saved.");
  } finally {
    row.dataset.saving = "false";
  }
}

locationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLocationMessage("Adding location...");
  try {
    await page.api("/api/setup/storage-locations", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#locationName").value,
        active: document.querySelector("#locationActive").checked
      })
    });
    locationForm.reset();
    document.querySelector("#locationActive").checked = true;
    await loadEverything();
    setLocationMessage("Storage location added.");
  } catch (error) {
    setLocationMessage(error.message, true);
  }
});

locationList.addEventListener("input", (event) => {
  const row = event.target.closest(".setup-admin-row");
  if (!row) return;
  row.classList.toggle("dirty", isLocationDirty(row));
});

locationList.addEventListener("change", (event) => {
  const row = event.target.closest(".setup-admin-row");
  if (!row) return;
  row.classList.toggle("dirty", isLocationDirty(row));
});

locationList.addEventListener("focusout", (event) => {
  const row = event.target.closest(".setup-admin-row");
  if (!row) return;
  const next = event.relatedTarget;
  if (next && row.contains(next)) return;
  saveLocationRow(row).catch((error) => setLocationMessage(error.message, true));
});

shelfForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setShelfMessage("Adding shelf...");
  try {
    await page.api("/api/setup/shelf-codes", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#shelfName").value,
        storageLocation: shelfLocation.value,
        active: document.querySelector("#shelfActive").checked
      })
    });
    shelfForm.reset();
    document.querySelector("#shelfActive").checked = true;
    shelfLocation.innerHTML = locationOptions();
    await loadEverything();
    setShelfMessage("Shelf code added.");
  } catch (error) {
    setShelfMessage(error.message, true);
  }
});

shelfList.addEventListener("input", (event) => {
  const row = event.target.closest(".setup-admin-row");
  if (!row) return;
  row.classList.toggle("dirty", isShelfDirty(row));
});

shelfList.addEventListener("change", (event) => {
  const row = event.target.closest(".setup-admin-row");
  if (!row) return;
  row.classList.toggle("dirty", isShelfDirty(row));
});

shelfList.addEventListener("focusout", (event) => {
  const row = event.target.closest(".setup-admin-row");
  if (!row) return;
  const next = event.relatedTarget;
  if (next && row.contains(next)) return;
  saveShelfRow(row).catch((error) => setShelfMessage(error.message, true));
});

page.ready(loadEverything);
