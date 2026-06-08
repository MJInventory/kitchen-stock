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
const saveAllButton = document.querySelector("#saveAllButton");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];
let dirtyIds = new Set();
let draftValues = new Map();
let optionsData = {
  inventoryAreas: [],
  storageLocations: [],
  inventorySubgroups: [],
  shelfCodes: [],
  suppliers: []
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

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
  const wanted = normalize(location);
  return (optionsData.shelfCodes || []).filter((shelf) => {
    if (!wanted) return true;
    return normalize(shelf.storageLocation) === wanted;
  });
}

function compareItems(left, right) {
  const parts = [
    normalize(left.inventoryArea).localeCompare(normalize(right.inventoryArea)),
    normalize(left.storageLocation).localeCompare(normalize(right.storageLocation)),
    normalize(left.inventorySubgroup).localeCompare(normalize(right.inventorySubgroup)),
    normalize(left.shelfCode).localeCompare(normalize(right.shelfCode), undefined, { numeric: true }),
    normalize(left.name).localeCompare(normalize(right.name), undefined, { numeric: true })
  ];
  return parts.find((value) => value !== 0) || 0;
}

function effectiveItem(item) {
  return { ...item, ...(draftValues.get(item.id) || {}) };
}

function markDirty(itemId, isDirty = true) {
  if (isDirty) {
    dirtyIds.add(itemId);
  } else {
    dirtyIds.delete(itemId);
  }
  saveAllButton.disabled = dirtyIds.size === 0;
}

function currentValuesFromArticle(article) {
  return {
    inventoryArea: article.querySelector(".area-select")?.value || "",
    storageLocation: article.querySelector(".location-select")?.value || "",
    inventorySubgroup: article.querySelector(".subgroup-select")?.value || "",
    shelfCode: article.querySelector(".shelf-select")?.value || "",
    supplierId: article.querySelector(".supplier-select")?.value || "",
    minimumThreshold: String(article.querySelector(".minimum-input")?.value || "0"),
    unit: article.querySelector(".unit-select")?.value || "",
    deleteRequested: article.querySelector(".delete-item-check")?.checked || false
  };
}

function itemSnapshot(item) {
  return {
    inventoryArea: item.inventoryArea || "",
    storageLocation: item.storageLocation || "",
    inventorySubgroup: item.inventorySubgroup || "",
    shelfCode: item.shelfCode || "",
    supplierId: item.supplierId || "",
    minimumThreshold: String(item.minimum ?? 0),
    unit: item.unit || "",
    deleteRequested: false
  };
}

function syncDirtyState(article) {
  const itemId = article.dataset.itemId;
  const original = items.find((item) => item.id === itemId);
  if (!original) return;
  const current = currentValuesFromArticle(article);
  const snapshot = itemSnapshot(original);
  const isDirty = Object.keys(snapshot).some((key) => current[key] !== snapshot[key]);
  article.classList.toggle("dirty", isDirty);
  if (isDirty) {
    draftValues.set(itemId, current);
  } else {
    draftValues.delete(itemId);
  }
  markDirty(itemId, isDirty);
}

function renderItems() {
  const area = areaFilter.value;
  const location = locationFilter.value;
  const filtered = items
    .map(effectiveItem)
    .filter((item) => {
      const areaMatches = !area || item.inventoryArea === area;
      const locationMatches = !location || item.storageLocation === location;
      return areaMatches && locationMatches;
    })
    .sort(compareItems);

  itemSettingsList.innerHTML = filtered
    .map((item) => `
      <article class="settings-item${dirtyIds.has(item.id) ? " dirty" : ""}" data-item-id="${item.id}">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml([item.inventoryArea, item.storageLocation].filter(Boolean).join(" / "))}</span>
          <span>${escapeHtml([item.inventorySubgroup, item.shelfCode ? `Shelf ${item.storageLocation ? `${item.storageLocation} / ${item.shelfCode}` : item.shelfCode}` : ""].filter(Boolean).join(" / "))}</span>
          <span>Supplier: ${escapeHtml(item.supplierName || "Unassigned Supplier")}</span>
          <span>Current: ${escapeHtml(item.quantity ?? "")} ${escapeHtml(item.unit || "")}</span>
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
          Primary supplier
          <select class="supplier-select">
            <option value="">Unassigned</option>
            ${(optionsData.suppliers || []).map((supplier) => `<option value="${escapeHtml(supplier.id)}"${supplier.id === item.supplierId ? " selected" : ""}>${escapeHtml(supplier.name)}</option>`).join("")}
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
        <label class="check-label delete-item-label">
          <input class="delete-item-check" type="checkbox">
          Delete item
        </label>
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
  dirtyIds.clear();
  draftValues.clear();
  fillFilter(areaFilter, optionsData.inventoryAreas || [], areaFilter.value, "All");
  fillFilter(locationFilter, optionsData.storageLocations || [], locationFilter.value, "All");
  renderItems();
  saveAllButton.disabled = true;
  setSetupMessage("");
}

async function saveItem(article) {
  const id = article.dataset.itemId;
  const payload = draftValues.get(id) || currentValuesFromArticle(article);
  const data = await api(`/api/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      minimumThreshold: payload.minimumThreshold,
      unit: payload.unit,
      inventoryArea: payload.inventoryArea,
      storageLocation: payload.storageLocation,
      inventorySubgroup: payload.inventorySubgroup,
      shelfCode: payload.shelfCode,
      supplierId: payload.supplierId
    })
  });
  items = items.map((item) => (item.id === id ? data.item : item));
  draftValues.delete(id);
  markDirty(id, false);
}

async function saveAllChanges() {
  const dirtyItemIds = [...dirtyIds];
  if (!dirtyItemIds.length) return;
  const deletions = dirtyItemIds.filter((itemId) => draftValues.get(itemId)?.deleteRequested);
  if (deletions.length && !window.confirm(`Delete ${deletions.length} inventory item(s)? This cannot be undone.`)) {
    saveAllButton.disabled = false;
    return;
  }
  saveAllButton.disabled = true;
  setSetupMessage(`Saving ${dirtyItemIds.length} item change(s)...`);
  for (const itemId of dirtyItemIds) {
    const payload = draftValues.get(itemId);
    if (payload?.deleteRequested) {
      await api(`/api/items/${itemId}`, { method: "DELETE" });
      items = items.filter((item) => item.id !== itemId);
      draftValues.delete(itemId);
      markDirty(itemId, false);
      continue;
    }
    const article = itemSettingsList.querySelector(`.settings-item[data-item-id="${itemId}"]`);
    if (article) {
      await saveItem(article);
      continue;
    }
    if (!payload) continue;
    const data = await api(`/api/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({
        minimumThreshold: payload.minimumThreshold,
        unit: payload.unit,
        inventoryArea: payload.inventoryArea,
        storageLocation: payload.storageLocation,
        inventorySubgroup: payload.inventorySubgroup,
        shelfCode: payload.shelfCode,
        supplierId: payload.supplierId
      })
    });
    items = items.map((item) => (item.id === itemId ? data.item : item));
    draftValues.delete(itemId);
    markDirty(itemId, false);
  }
  renderItems();
  setSetupMessage("All item settings saved.");
}

window.addEventListener("beforeunload", (event) => {
  if (!dirtyIds.size) return;
  event.preventDefault();
  event.returnValue = "";
});

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

logoutButton.addEventListener("click", () => {
  if (dirtyIds.size && !window.confirm("You have unsaved inventory changes. Leave this screen anyway?")) return;
  showLogin();
});
areaFilter.addEventListener("change", renderItems);
locationFilter.addEventListener("change", renderItems);
saveAllButton.addEventListener("click", () => {
  saveAllChanges().catch((error) => {
    saveAllButton.disabled = false;
    setSetupMessage(error.message, true);
  });
});

itemSettingsList.addEventListener("change", (event) => {
  const article = event.target.closest(".settings-item");
  if (!article) return;
  const locationSelect = event.target.closest(".location-select");
  if (locationSelect) {
    const shelfSelect = article.querySelector(".shelf-select");
    const currentValue = shelfSelect.value;
    shelfSelect.innerHTML = optionList(shelvesForLocation(locationSelect.value), currentValue, "Choose shelf");
    if (![...shelfSelect.options].some((option) => option.value === currentValue)) {
      shelfSelect.value = "";
    }
  }
  syncDirtyState(article);
});

itemSettingsList.addEventListener("input", (event) => {
  const article = event.target.closest(".settings-item");
  if (!article) return;
  syncDirtyState(article);
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => setSetupMessage(error.message, true));
} else {
  showLogin();
}
