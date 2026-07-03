import {
  formatUserDisplay,
  normalize,
  optionList
} from "./helpers.js";
import { fillFilter, renderItems, shelvesForLocation } from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell } from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";

export function initInventorySettingsPage() {
  const loginScreen = document.querySelector("#loginScreen");
  const loginForm = document.querySelector("#loginForm");
  const usernameInput = document.querySelector("#usernameInput");
  const passwordInput = document.querySelector("#passwordInput");
  const loginMessage = document.querySelector("#loginMessage");
  const currentUser = document.querySelector("#currentUser");
  const logoutButton = document.querySelector("#logoutButton");
  const areaFilter = document.querySelector("#areaFilter");
  const locationFilter = document.querySelector("#locationFilter");
  const searchFilter = document.querySelector("#searchFilter");
  const searchItemsButton = document.querySelector("#searchItemsButton");
  const setupMessage = document.querySelector("#setupMessage");
  const itemSettingsList = document.querySelector("#itemSettingsList");
  const saveAllButton = document.querySelector("#saveAllButton");
  const loadItemsButton = document.querySelector("#loadItemsButton");

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let items = [];
  let hasLoadedItems = false;
  let appliedFilters = {
    areaValue: "",
    locationValue: "",
    searchValue: ""
  };
  let dirtyIds = new Set();
  let draftValues = new Map();
  let optionsData = {
    categories: [],
    inventoryAreas: [],
    storageLocations: [],
    shelfCodes: [],
    suppliers: [],
    units: []
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
    applyAuthenticatedShell({
      loginScreen,
      currentUser,
      sessionUser,
      formatUserDisplay
    });
  }

  function showLogin() {
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
  }

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin()
  });

  function effectiveItem(item) {
    return { ...item, ...(draftValues.get(item.id) || {}) };
  }

  function markDirty(itemId, isDirty = true) {
    if (isDirty) {
      dirtyIds.add(itemId);
    } else {
      dirtyIds.delete(itemId);
    }
    if (saveAllButton) saveAllButton.disabled = dirtyIds.size === 0;
  }

  function currentValuesFromArticle(article) {
    return {
      name: article.querySelector(".item-name-input")?.value.trim() || "",
      inventoryArea: article.querySelector(".area-select")?.value || "",
      storageLocation: article.querySelector(".location-select")?.value || "",
      category: article.querySelector(".category-select")?.value || "",
      shelfCode: article.querySelector(".shelf-select")?.value || "",
      supplierId: article.querySelector(".supplier-select")?.value || "",
      minimumThreshold: String(article.querySelector(".minimum-input")?.value || "0"),
      unit: article.querySelector(".unit-select")?.value || ""
    };
  }

  function itemSnapshot(item) {
    return {
      name: item.name || "",
      inventoryArea: item.inventoryArea || "",
      storageLocation: item.storageLocation || "",
      category: item.category || "",
      shelfCode: item.shelfCode || "",
      supplierId: item.supplierId || "",
      minimumThreshold: String(item.minimum ?? 0),
      unit: item.unit || ""
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

  function renderItemList() {
    if (!hasLoadedItems) {
      itemSettingsList.innerHTML = '<p class="empty-sheet">Click Load Items to view inventory items.</p>';
      return;
    }
    renderItems({
      items,
      dirtyIds,
      draftValues,
      optionsData,
      areaValue: appliedFilters.areaValue,
      locationValue: appliedFilters.locationValue,
      searchValue: appliedFilters.searchValue,
      itemSettingsList
    });
  }

  async function loadOptions() {
    const formOptions = await api("/api/item-form-options");
    optionsData = formOptions;
    fillFilter(areaFilter, optionsData.inventoryAreas || [], areaFilter.value, "All");
    fillFilter(locationFilter, optionsData.storageLocations || [], locationFilter.value, "All");
  }

  async function loadItems() {
    setSetupMessage("Loading...");
    const data = await api("/api/items");
    items = data.items;
    hasLoadedItems = true;
    dirtyIds.clear();
    draftValues.clear();
    appliedFilters = {
      areaValue: areaFilter.value,
      locationValue: locationFilter.value,
      searchValue: normalize(searchFilter?.value)
    };
    renderItemList();
    if (saveAllButton) saveAllButton.disabled = true;
    setSetupMessage("");
  }

  async function saveItem(article) {
    const id = article.dataset.itemId;
    const payload = draftValues.get(id) || currentValuesFromArticle(article);
    if (!payload) return;
    const data = await api(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: payload.name,
        minimumThreshold: payload.minimumThreshold,
        unit: payload.unit,
        inventoryArea: payload.inventoryArea,
        storageLocation: payload.storageLocation,
        category: payload.category,
        shelfCode: payload.shelfCode,
        supplierId: payload.supplierId
      })
    });
    items = items.map((item) => (item.id === id ? data.item : item));
    draftValues.delete(id);
    markDirty(id, false);
    article.classList.remove("dirty");
  }

  async function deleteItem(article) {
    const id = article.dataset.itemId;
    const name = article.querySelector(".item-name-input")?.value?.trim() || "this item";
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    await api(`/api/items/${id}`, { method: "DELETE" });
    items = items.filter((item) => item.id !== id);
    draftValues.delete(id);
    markDirty(id, false);
    renderItemList();
    setSetupMessage("Item deleted.");
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
      await loadOptions();
      renderItemList();
    } catch (error) {
      setLoginMessage(error.message, true);
    }
  });

  logoutButton.addEventListener("click", () => {
    if (dirtyIds.size && !window.confirm("You have unsaved inventory changes. Leave this screen anyway?")) return;
    showLogin();
  });
  loadItemsButton?.addEventListener("click", () => {
    loadItems().catch((error) => setSetupMessage(error.message, true));
  });
  searchItemsButton?.addEventListener("click", () => {
    if (!hasLoadedItems) {
      loadItems().catch((error) => setSetupMessage(error.message, true));
      return;
    }
    appliedFilters = {
      areaValue: areaFilter.value,
      locationValue: locationFilter.value,
      searchValue: normalize(searchFilter?.value)
    };
    renderItemList();
    setSetupMessage("");
  });
  searchFilter?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchItemsButton?.click();
  });
  saveAllButton?.addEventListener("click", () => {
    const dirtyRows = [...itemSettingsList.querySelectorAll(".settings-item.dirty")];
    if (!dirtyRows.length) return;
    setSetupMessage(`Saving ${dirtyRows.length} item change(s)...`);
    Promise.all(dirtyRows.map((row) => saveItem(row)))
      .then(() => setSetupMessage("All item settings saved."))
      .catch((error) => {
        if (saveAllButton) saveAllButton.disabled = false;
        setSetupMessage(error.message, true);
      });
  });

  itemSettingsList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".delete-item-button");
    if (!deleteButton) return;
    const article = deleteButton.closest(".settings-item");
    if (!article) return;
    deleteButton.disabled = true;
    deleteItem(article)
      .catch((error) => setSetupMessage(error.message, true))
      .finally(() => { deleteButton.disabled = false; });
  });

  itemSettingsList.addEventListener("change", (event) => {
    const article = event.target.closest(".settings-item");
    if (!article) return;
    const locationSelect = event.target.closest(".location-select");
    if (locationSelect) {
      const shelfSelect = article.querySelector(".shelf-select");
      const currentValue = shelfSelect.value;
      shelfSelect.innerHTML = optionList(shelvesForLocation(locationSelect.value, optionsData.shelfCodes), currentValue, "Choose shelf");
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

  itemSettingsList.addEventListener("focusout", (event) => {
    const article = event.target.closest(".settings-item");
    if (!article) return;
    const next = event.relatedTarget;
    if (next && article.contains(next)) return;
    if (!article.classList.contains("dirty")) return;
    setSetupMessage("Saving item...");
    saveItem(article)
      .then(() => setSetupMessage("Item saved."))
      .catch((error) => setSetupMessage(error.message, true));
  });

  if (sessionToken && sessionUser) {
    showApp();
    loadOptions()
      .then(renderItemList)
      .catch((error) => setSetupMessage(error.message, true));
  } else {
    showLogin();
  }
}
