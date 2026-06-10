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

function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
      .join("-"))
    .join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function message(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = formatUserDisplay(sessionUser);
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

function itemCategory(item) {
  return item.category || "Unsorted";
}

function itemUnit(item) {
  return item.unit || "item";
}

function shelfSortValue(item) {
  return normalize(item.shelfCode || "TBD").replace(/^shelf\s+/i, "");
}

function populateSelect(select, values, firstLabel) {
  const current = select.value;
  select.innerHTML = [`<option value="">${escapeHtml(firstLabel)}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join("");
  if (values.includes(current)) select.value = current;
}

function syncLocationPicker(values, firstLabel) {
  const current = locationFilter.value;
  const options = [{ value: "", label: firstLabel }, ...values.map((value) => ({ value, label: value }))];

  locationPickerButton.textContent = current || firstLabel;
  locationPickerList.innerHTML = options
    .map(
      (option) => `
        <button
          class="location-picker-option${option.value === current ? " selected" : ""}"
          type="button"
          role="option"
          aria-selected="${option.value === current ? "true" : "false"}"
          data-value="${escapeHtml(option.value)}"
        >
          ${escapeHtml(option.label)}
        </button>
      `
    )
    .join("");
}

function closeLocationPicker() {
  locationPickerList.hidden = true;
  locationPickerButton.setAttribute("aria-expanded", "false");
}

function openLocationPicker() {
  locationPickerList.hidden = false;
  locationPickerButton.setAttribute("aria-expanded", "true");
}

function selectedLocation() {
  return locationFilter.value;
}

function filteredItems() {
  return items
    .filter((item) => !selectedLocation() || item.storageLocation === selectedLocation())
    .filter((item) => !areaFilter.value || item.inventoryArea === areaFilter.value)
    .filter((item) => !categoryFilter.value || itemCategory(item) === categoryFilter.value)
    .sort((a, b) => {
      const shelf = shelfSortValue(a).localeCompare(shelfSortValue(b), undefined, { numeric: true });
      if (shelf) return shelf;
      const category = itemCategory(a).localeCompare(itemCategory(b));
      if (category) return category;
      return a.name.localeCompare(b.name);
    });
}

function renderFilters() {
  const locations = [...new Set(items.map((item) => item.storageLocation).filter(Boolean))].sort();
  const areas = [...new Set(items.map((item) => item.inventoryArea).filter(Boolean))].sort();
  const categories = [...new Set(items.map(itemCategory).filter(Boolean))].sort();

  populateSelect(locationFilter, locations, "Choose Storage Location");
  populateSelect(areaFilter, areas, "All Areas");
  populateSelect(categoryFilter, categories, "All Categories");

  if (!locationFilter.value && locations.length) {
    locationFilter.value = locations[0];
  }

  syncLocationPicker(locations, "Choose Storage Location");
}

function renderList() {
  const visible = filteredItems();
  const location = selectedLocation() || "All Storage Locations";

  locationTitle.textContent = location;
  updateCountSummary();

  if (!visible.length) {
    stockCountList.innerHTML = '<p class="empty-sheet">No items match this location.</p>';
    return;
  }

  stockCountList.innerHTML = visible
    .map((item) => {
      const countValue = draftCounts.has(item.id) ? draftCounts.get(item.id) : "";
      const notesValue = draftNotes.get(item.id) || "";
      const low = item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0);
      return `
        <article class="product-row stock-count-row" data-item-id="${escapeHtml(item.id)}">
          <div class="stock-count-marker">${escapeHtml(item.shelfCode || "TBD")}</div>
          <div class="product-main stock-count-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml([item.inventoryArea, item.storageLocation, itemCategory(item)].filter(Boolean).join(" / "))}</span>
            <small>Current ${escapeHtml(item.quantity ?? 0)} ${escapeHtml(itemUnit(item))}${item.minimum !== null ? ` / min ${escapeHtml(item.minimum)}` : ""}</small>
            ${low ? '<em>Below minimum</em>' : ""}
          </div>
          <div class="product-controls stock-count-controls">
            <button class="step-count" type="button" data-step="-1">-</button>
            <input class="count-input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${escapeHtml(item.quantity ?? 0)}" value="${escapeHtml(countValue)}" aria-label="Count ${escapeHtml(item.name)}">
            <button class="step-count" type="button" data-step="1">+</button>
            <span>${escapeHtml(itemUnit(item))}</span>
          </div>
          <label class="stock-count-note-wrap">
            <span>Note</span>
            <input class="count-note" type="text" placeholder="Add note for this count" value="${escapeHtml(notesValue)}" aria-label="Note for ${escapeHtml(item.name)}">
          </label>
        </article>
      `;
    })
    .join("");
}

function updateCountSummary() {
  const visible = filteredItems();
  const changed = visible.filter((item) => draftCounts.has(item.id)).length;
  locationMeta.textContent = `${visible.length} items${changed ? ` / ${changed} changed` : ""}`;
  saveAllButton.textContent = changed ? `Save ${changed} Count${changed === 1 ? "" : "s"}` : "Save Counts";
}

function render() {
  renderFilters();
  renderList();
}

async function loadItems() {
  message(countMessage, "Loading stock list...");
  const data = await api("/api/items");
  items = data.items || [];
  render();
  message(countMessage, "");
}

async function saveCount(itemId, countedQuantity, notes = "") {
  return api("/api/stock-counts", {
    method: "POST",
    body: JSON.stringify({
      itemId,
      countedQuantity,
      notes
    })
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
    for (const [itemId, value] of entries) {
      const result = await saveCount(itemId, value, draftNotes.get(itemId) || "");
      items = items.map((item) => (item.id === result.item.id ? { ...item, quantity: result.item.quantity } : item));
      draftCounts.delete(itemId);
      draftNotes.delete(itemId);
    }
    renderList();
    message(countMessage, "Stock counts saved.");
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
refreshButton.addEventListener("click", () => loadItems().catch((error) => message(countMessage, error.message, true)));
saveAllButton.addEventListener("click", saveAllCounts);
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
  syncLocationPicker([...new Set(items.map((item) => item.storageLocation).filter(Boolean))].sort(), "Choose Storage Location");
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

  updateCountSummary();
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
  renderList();
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => message(countMessage, error.message, true));
} else {
  showLogin();
}







