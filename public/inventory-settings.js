const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const setupMessage = document.querySelector("#setupMessage");
const itemSettingsList = document.querySelector("#itemSettingsList");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];
let optionsData = {
  inventoryAreas: [],
  storageLocations: [],
  inventorySubgroups: [],
  shelfCodes: []
};

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function setSetupMessage(text, isError = false) {
  setupMessage.textContent = text;
  setupMessage.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = sessionUser;
}

function showLogin() {
  loginScreen.hidden = false;
  currentUser.textContent = "";
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    ...options
  });
  const data = await response.json();
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function optionList(records, selectedValue, placeholder = "") {
  return [
    placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "",
    ...records.map((record) => {
      const value = record.name ?? record.displayName ?? "";
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(record.displayName || record.name || value)}</option>`;
    })
  ].join("");
}

function fillFilter(select, records, selectedValue, allLabel) {
  select.innerHTML = `<option value="">${allLabel}</option>` + records
    .map((record) => `<option value="${escapeHtml(record.name)}"${record.name === selectedValue ? " selected" : ""}>${escapeHtml(record.name)}</option>`)
    .join("");
}

function shelvesForLocation(location) {
  const wanted = String(location || "").trim().toLowerCase();
  return (optionsData.shelfCodes || []).filter((shelf) => {
    if (!wanted) return true;
    return String(shelf.storageLocation || "").trim().toLowerCase() === wanted;
  });
}

function shelfDisplay(item) {
  if (!item.shelfCode) return "";
  return item.storageLocation ? `${item.storageLocation} / ${item.shelfCode}` : item.shelfCode;
}

function renderItems() {
  const area = areaFilter.value;
  const location = locationFilter.value;
  const filtered = items.filter((item) => {
    const areaMatches = !area || item.inventoryArea === area;
    const locationMatches = !location || item.storageLocation === location;
    return areaMatches && locationMatches;
  });

  itemSettingsList.innerHTML = filtered
    .map((item) => `
      <article class="settings-item" data-item-id="${item.id}">
        <div>
          <strong>${item.name}</strong>
          <span>${[item.inventoryArea, item.storageLocation].filter(Boolean).join(" / ")}</span>
          <span>${[item.inventorySubgroup, item.shelfCode ? `Shelf ${shelfDisplay(item)}` : ""].filter(Boolean).join(" / ")}</span>
          <span>Current: ${item.quantity ?? ""} ${item.unit || ""}</span>
        </div>
        <label>
          Area
          <select class="area-select">
            ${optionList(optionsData.inventoryAreas || [], item.inventoryArea)}
          </select>
        </label>
        <label>
          Location
          <select class="location-select">
            ${optionList(optionsData.storageLocations || [], item.storageLocation)}
          </select>
        </label>
        <label>
          Subgroup
          <select class="subgroup-select">
            ${optionList(optionsData.inventorySubgroups || [], item.inventorySubgroup)}
          </select>
        </label>
        <label>
          Shelf code
          <select class="shelf-select">
            ${optionList(shelvesForLocation(item.storageLocation), item.shelfCode, "Choose shelf")}
          </select>
        </label>
        <label>
          Minimum stock
          <input class="minimum-input" type="number" min="0" step="1" value="${item.minimum ?? 0}">
        </label>
        <label>
          Unit
          <select class="unit-select">
            ${["box", "bag", "item", "bottle"].map((unit) => `<option${item.unit === unit ? " selected" : ""}>${unit}</option>`).join("")}
          </select>
        </label>
        <button class="save-item-button" type="button">Save</button>
      </article>
    `)
    .join("");

  if (!filtered.length) {
    itemSettingsList.innerHTML = '<p class="empty-sheet">No matching items.</p>';
  }
}

async function loadItems() {
  setSetupMessage("Loading...");
  const [data, formOptions] = await Promise.all([api("/api/items"), api("/api/item-form-options")]);
  items = data.items;
  optionsData = formOptions;
  fillFilter(areaFilter, optionsData.inventoryAreas || [], areaFilter.value, "All");
  fillFilter(locationFilter, optionsData.storageLocations || [], locationFilter.value, "All");
  renderItems();
  setSetupMessage("");
}

async function saveItem(article) {
  const id = article.dataset.itemId;
  const minimumThreshold = article.querySelector(".minimum-input").value;
  const unit = article.querySelector(".unit-select").value;
  const inventoryArea = article.querySelector(".area-select").value;
  const storageLocation = article.querySelector(".location-select").value;
  const inventorySubgroup = article.querySelector(".subgroup-select").value;
  const shelfCode = article.querySelector(".shelf-select").value;
  const data = await api(`/api/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ minimumThreshold, unit, inventoryArea, storageLocation, inventorySubgroup, shelfCode })
  });

  items = items.map((item) => (item.id === id ? data.item : item));
  renderItems();
  setSetupMessage("Item settings saved.");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginMessage("Logging in...");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not log in.");

    sessionToken = data.token;
    sessionUser = data.user.name;
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    passwordInput.value = "";
    setLoginMessage("");
    showApp();
    await loadItems();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
areaFilter.addEventListener("change", renderItems);
locationFilter.addEventListener("change", renderItems);
itemSettingsList.addEventListener("change", (event) => {
  const locationSelect = event.target.closest(".location-select");
  if (!locationSelect) return;
  const article = locationSelect.closest(".settings-item");
  const shelfSelect = article?.querySelector(".shelf-select");
  if (!shelfSelect) return;
  const currentValue = shelfSelect.value;
  shelfSelect.innerHTML = optionList(shelvesForLocation(locationSelect.value), currentValue, "Choose shelf");
  if (![...shelfSelect.options].some((option) => option.value === currentValue)) {
    shelfSelect.value = "";
  }
});
itemSettingsList.addEventListener("click", (event) => {
  const button = event.target.closest(".save-item-button");
  if (!button) return;
  const article = event.target.closest(".settings-item");
  button.disabled = true;
  saveItem(article)
    .catch((error) => setSetupMessage(error.message, true))
    .finally(() => {
      button.disabled = false;
    });
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => setSetupMessage(error.message, true));
} else {
  showLogin();
}







