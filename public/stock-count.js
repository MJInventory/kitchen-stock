import {
  formatUserDisplay
} from "./stock-count/helpers.js";
import {
  renderFilters as renderStockFilters,
  renderList as renderStockList,
  syncLocationPicker,
  updateCountSummary as updateStockCountSummary
} from "./stock-count/render.js";

const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const saveAllButton = document.querySelector("#saveAllButton");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const locationPickerButton = document.querySelector("#locationPickerButton");
const locationPickerList = document.querySelector("#locationPickerList");
const categoryFilter = document.querySelector("#categoryFilter");
const countMessage = document.querySelector("#countMessage");
const stockCountList = document.querySelector("#stockCountList");
const locationTitle = document.querySelector("#locationTitle");
const locationMeta = document.querySelector("#locationMeta");
const backToTopButton = document.querySelector("#backToTopButton");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];
let draftCounts = new Map();
let draftNotes = new Map();

function message(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = formatUserDisplay(sessionUser);
  window.refreshKitchenMenus?.();
}

function showLogin() {
  loginScreen.hidden = false;
  currentUser.textContent = "";
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
}

async function api(path, options = {}) {
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

async function queueApi(path, options = {}, meta = {}) {
  if (!window.kitchenOfflineQueue?.request) return api(path, options);
  return window.kitchenOfflineQueue.request(path, options, {
    allowQueue: true,
    token: sessionToken,
    ...meta
  });
}

function closeLocationPicker() {
  locationPickerList.hidden = true;
  locationPickerButton.setAttribute("aria-expanded", "false");
}

function openLocationPicker() {
  locationPickerList.hidden = false;
  locationPickerButton.setAttribute("aria-expanded", "true");
}

function currentFilters() {
  return {
    location: locationFilter.value,
    area: areaFilter.value,
    category: categoryFilter.value
  };
}

function renderFilters() {
  renderFiltersModule();
}

function render() {
  renderFilters();
  renderListModule();
}

function renderFiltersModule() {
  renderStockFilters({
    items,
    locationFilter,
    areaFilter,
    categoryFilter,
    locationPickerButton,
    locationPickerList
  });
}

function renderListModule() {
  renderStockList({
    items,
    filters: currentFilters(),
    draftCounts,
    draftNotes,
    locationTitle,
    locationMeta,
    saveAllButton,
    stockCountList
  });
}

function updateCountSummaryModule() {
  updateStockCountSummary({
    items,
    filters: currentFilters(),
    draftCounts,
    locationMeta,
    saveAllButton
  });
}

async function loadItems() {
  message(countMessage, "Loading stock list...");
  const data = await api("/api/items");
  items = data.items || [];
  render();
  message(countMessage, "");
}

async function saveCount(itemId, countedQuantity, notes = "") {
  return queueApi("/api/stock-counts", {
    method: "POST",
    body: JSON.stringify({
      itemId,
      countedQuantity,
      notes
    })
  }, {
    label: "Stock count",
    fallbackData: {
      item: {
        id: itemId,
        quantity: Number(countedQuantity || 0)
      }
    }
  });
}

async function saveAllCounts() {
  const entries = [...draftCounts.entries()].filter(([, value]) => value !== "");
  if (!entries.length) {
    message(countMessage, "Enter counts first.");
    return;
  }

  saveAllButton.disabled = true;
  message(countMessage, `Saving ${entries.length} count${entries.length === 1 ? "" : "s"}...`);

  try {
    let queuedOffline = false;
    for (const [itemId, value] of entries) {
      const result = await saveCount(itemId, value, draftNotes.get(itemId) || "");
      queuedOffline = queuedOffline || Boolean(result?.offlineQueued);
      items = items.map((item) => (item.id === result.item.id ? { ...item, quantity: result.item.quantity } : item));
      draftCounts.delete(itemId);
      draftNotes.delete(itemId);
    }
    renderListModule();
    message(countMessage, queuedOffline ? "Stock counts saved offline. They will sync automatically." : "Stock counts saved.");
  } catch (error) {
    message(countMessage, error.message, true);
  } finally {
    saveAllButton.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(loginMessage, "Logging in...");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
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
    showApp();
    await loadItems();
  } catch (error) {
    message(loginMessage, error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
refreshButton?.addEventListener("click", () => loadItems().catch((error) => message(countMessage, error.message, true)));
saveAllButton.addEventListener("click", saveAllCounts);
window.addEventListener("kitchen-offline-queue-synced", () => {
  loadItems().catch((error) => message(countMessage, error.message, true));
});
backToTopButton.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

[areaFilter, categoryFilter].forEach((control) => {
  control.addEventListener("change", renderList);
});

locationPickerButton.addEventListener("click", () => {
  if (locationPickerList.hidden) openLocationPicker();
  else closeLocationPicker();
});

locationPickerList.addEventListener("click", (event) => {
  const option = event.target.closest(".location-picker-option");
  if (!option) return;
  locationFilter.value = option.dataset.value || "";
  closeLocationPicker();
  renderList();
  syncLocationPicker({
    current: locationFilter.value,
    values: [...new Set(items.map((item) => item.storageLocation).filter(Boolean))].sort(),
    firstLabel: "Choose Storage Location",
    button: locationPickerButton,
    list: locationPickerList
  });
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".stock-location-picker")) return;
  closeLocationPicker();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLocationPicker();
});

stockCountList.addEventListener("input", (event) => {
  const row = event.target.closest(".stock-count-row");
  if (!row) return;
  const itemId = row.dataset.itemId;

  if (event.target.classList.contains("count-input")) {
    if (event.target.value === "") draftCounts.delete(itemId);
    else draftCounts.set(itemId, event.target.value);
  }

  if (event.target.classList.contains("count-note")) {
    if (event.target.value === "") draftNotes.delete(itemId);
    else draftNotes.set(itemId, event.target.value);
  }

  updateCountSummaryModule();
});

stockCountList.addEventListener("click", (event) => {
  const button = event.target.closest(".step-count");
  if (!button) return;
  const row = button.closest(".stock-count-row");
  const input = row.querySelector(".count-input");
  const itemId = row.dataset.itemId;
  const item = items.find((entry) => entry.id === itemId);
  const base = input.value === "" ? Number(item?.quantity || 0) : Number(input.value || 0);
  const next = Math.max(0, base + Number(button.dataset.step || 0));
  draftCounts.set(itemId, String(next));
  renderListModule();
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => message(countMessage, error.message, true));
} else {
  showLogin();
}







