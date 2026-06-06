import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#shelfMessage"
});

const form = document.querySelector("#shelfForm");
const shelfList = document.querySelector("#shelfList");
const shelfLocation = document.querySelector("#shelfLocation");
const message = document.querySelector("#shelfMessage");

let storageLocations = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function locationOptions(selected = "") {
  return storageLocations
    .map((location) => `<option value="${escapeHtml(location.name)}"${location.name === selected ? " selected" : ""}>${escapeHtml(location.name)}</option>`)
    .join("");
}

function renderShelves(shelves) {
  shelfLocation.innerHTML = locationOptions();
  shelfList.innerHTML = shelves.map((shelf) => `
    <article class="setting-row setup-admin-row" data-shelf-id="${escapeHtml(shelf.id)}">
      <label>Shelf code <input class="shelf-name" type="text" value="${escapeHtml(shelf.name)}"></label>
      <label>Storage location <select class="shelf-location">${locationOptions(shelf.storageLocation)}</select></label>
      <label class="check-label"><input class="shelf-active" type="checkbox" ${shelf.active ? "checked" : ""}> Active</label>
      <button class="save-shelf" type="button">Save</button>
    </article>
  `).join("");

  if (!shelfList.innerHTML) {
    shelfList.innerHTML = '<p class="empty-sheet">No shelf codes yet.</p>';
  }
}

async function loadShelves() {
  setMessage("Loading shelves...");
  const data = await page.api("/api/setup/shelf-codes");
  storageLocations = data.storageLocations || [];
  renderShelves(data.shelfCodes || []);
  setMessage("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Adding shelf...");
  try {
    await page.api("/api/setup/shelf-codes", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#shelfName").value,
        storageLocation: shelfLocation.value,
        active: document.querySelector("#shelfActive").checked
      })
    });
    form.reset();
    document.querySelector("#shelfActive").checked = true;
    await loadShelves();
    setMessage("Shelf code added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

shelfList.addEventListener("click", (event) => {
  const button = event.target.closest(".save-shelf");
  if (!button) return;
  const row = button.closest(".setup-admin-row");
  button.disabled = true;
  page.api(`/api/setup/shelf-codes/${row.dataset.shelfId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: row.querySelector(".shelf-name").value,
      storageLocation: row.querySelector(".shelf-location").value,
      active: row.querySelector(".shelf-active").checked
    })
  })
    .then(loadShelves)
    .then(() => setMessage("Shelf code saved."))
    .catch((error) => setMessage(error.message, true))
    .finally(() => { button.disabled = false; });
});

page.ready(loadShelves);
