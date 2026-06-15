import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#locationMessage"
});

const form = document.querySelector("#locationForm");
const locationList = document.querySelector("#locationList");
const message = document.querySelector("#locationMessage");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function renderLocations(locations) {
  locationList.innerHTML = locations.map((location) => `
    <article class="setting-row setup-admin-row" data-location-id="${escapeHtml(location.id)}">
      <label>Name <input class="location-name" type="text" value="${escapeHtml(location.name)}"></label>
      <label class="check-label"><input class="location-active" type="checkbox" ${location.active ? "checked" : ""}> Active</label>
      <button class="save-location" type="button">Save</button>
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

locationList.addEventListener("click", (event) => {
  const button = event.target.closest(".save-location");
  if (!button) return;
  const row = button.closest(".setup-admin-row");
  button.disabled = true;
  page.api(`/api/setup/storage-locations/${row.dataset.locationId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: row.querySelector(".location-name").value,
      active: row.querySelector(".location-active").checked
    })
  })
    .then(loadLocations)
    .then(() => setMessage("Storage location saved."))
    .catch((error) => setMessage(error.message, true))
    .finally(() => { button.disabled = false; });
});

page.ready(loadLocations);







