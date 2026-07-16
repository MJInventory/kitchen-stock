import {
  formatUserDisplay,
  normalize,
  optionList
} from "./helpers.js";
import { fillFilter, renderItems, shelvesForLocation } from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell, persistKitchenSession, readKitchenSession } from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";
import { bindAuthenticatedBootstrap, bindLogoutButton } from "/session-bootstrap.js";

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

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
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

  function formatPriceValue(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
  }

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
      unitPrice: article.querySelector(".price-input")?.value ?? "",
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
      unitPrice: formatPriceValue(item.unitPrice),
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
        unitPrice: payload.unitPrice,
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

  bindKitchenLogin({
    loginForm,
    usernameInput,
    passwordInput,
    setLoginMessage,
    onSuccess: async (data) => {
      const saved = persistKitchenSession(data, {
        currentToken: sessionToken,
        applyTheme: window.applyKitchenTheme
      });
      sessionToken = saved.token;
      sessionUser = saved.user;
      passwordInput.value = "";
      setLoginMessage("");
      showApp();
      await loadOptions();
      renderItemList();
    }
  });

  bindLogoutButton(logoutButton, () => {
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
    const supplierSelect = event.target.closest(".supplier-select");
    if (supplierSelect) {
      const item = items.find((entry) => entry.id === article.dataset.itemId);
      const supplierPrice = (item?.supplierPrices || []).find((price) => price.supplierId === supplierSelect.value);
      const priceInput = article.querySelector(".price-input");
      if (priceInput) priceInput.value = formatPriceValue(supplierPrice?.unitPrice ?? 0);
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

  bindAuthenticatedBootstrap({
    hasSession: () => Boolean(sessionToken && sessionUser),
    showApp,
    showLogin,
    load: async () => {
      await loadOptions();
      renderItemList();
    },
    onError: (error) => setSetupMessage(error.message, true)
  });
}
