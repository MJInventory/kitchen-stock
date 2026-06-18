import {
  formatUserDisplay,
  normalize,
  optionList
} from "./helpers.js";
import { fillFilter, renderItems, shelvesForLocation } from "./render.js";

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
  const setupMessage = document.querySelector("#setupMessage");
  const itemSettingsList = document.querySelector("#itemSettingsList");
  const saveAllButton = document.querySelector("#saveAllButton");

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let items = [];
  let dirtyIds = new Set();
  let draftValues = new Map();
  let optionsData = {
    categories: [],
    inventoryAreas: [],
    storageLocations: [],
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
      name: article.querySelector(".item-name-input")?.value.trim() || "",
      inventoryArea: article.querySelector(".area-select")?.value || "",
      storageLocation: article.querySelector(".location-select")?.value || "",
      category: article.querySelector(".category-select")?.value || "",
      shelfCode: article.querySelector(".shelf-select")?.value || "",
      supplierId: article.querySelector(".supplier-select")?.value || "",
      minimumThreshold: String(article.querySelector(".minimum-input")?.value || "0"),
      unit: article.querySelector(".unit-select")?.value || "",
      deleteRequested: article.querySelector(".delete-item-check")?.checked || false
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

  function renderItemList() {
    renderItems({
      items,
      dirtyIds,
      draftValues,
      optionsData,
      areaValue: areaFilter.value,
      locationValue: locationFilter.value,
      searchValue: normalize(searchFilter?.value),
      itemSettingsList
    });
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
    renderItemList();
    saveAllButton.disabled = true;
    setSetupMessage("");
  }

  async function saveItem(article) {
    const id = article.dataset.itemId;
    const payload = draftValues.get(id) || currentValuesFromArticle(article);
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
      items = items.map((item) => (item.id === itemId ? data.item : item));
      draftValues.delete(itemId);
      markDirty(itemId, false);
    }
    renderItemList();
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
  areaFilter.addEventListener("change", renderItemList);
  locationFilter.addEventListener("change", renderItemList);
  searchFilter?.addEventListener("input", renderItemList);
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

  if (sessionToken && sessionUser) {
    showApp();
    loadItems().catch((error) => setSetupMessage(error.message, true));
  } else {
    showLogin();
  }
}
