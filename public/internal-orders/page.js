import {
  escapeHtml,
  formatUserDisplay,
  itemCategory
} from "./helpers.js";
import {
  filterItems,
  populateFilters,
  renderCatalog,
  renderCategories,
  renderInternalOrders,
  renderSelectedChips,
  updateSaveButton
} from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell, persistKitchenSession, readKitchenSession } from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";

export function initInternalOrdersPage() {
  const loginScreen = document.querySelector("#loginScreen");
  const loginForm = document.querySelector("#loginForm");
  const usernameInput = document.querySelector("#usernameInput");
  const passwordInput = document.querySelector("#passwordInput");
  const loginMessage = document.querySelector("#loginMessage");
  const currentUser = document.querySelector("#currentUser");
  const logoutButton = document.querySelector("#logoutButton");
  const refreshButton = document.querySelector("#refreshButton");
  const submitButton = document.querySelector("#submitButton");
  const featureMenu = document.querySelector("#featureMenu");
  const searchInput = document.querySelector("#searchInput");
  const areaFilter = document.querySelector("#areaFilter");
  const locationFilter = document.querySelector("#locationFilter");
  const selectedChips = document.querySelector("#selectedChips");
  const message = document.querySelector("#message");
  const catalogCount = document.querySelector("#catalogCount");
  const catalogList = document.querySelector("#catalogList");
  const internalCount = document.querySelector("#internalCount");
  const internalOrderList = document.querySelector("#internalOrderList");
  const categoryView = document.querySelector("#categoryView");
  const categoryGrid = document.querySelector("#categoryGrid");
  const productView = document.querySelector("#productView");
  const categoryTitle = document.querySelector("#categoryTitle");
  const categoryMeta = document.querySelector("#categoryMeta");
  const backButton = document.querySelector("#backButton");

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
  let sessionPermissions = initialSession.permissions;
  let allItems = [];
  let internalOrders = [];
  let selected = new Map();
  let activeCategory = "";
  let internalDrafts = new Map();

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
  }

  function setLoginMessage(text, isError = false) {
    loginMessage.textContent = text;
    loginMessage.classList.toggle("error", isError);
  }

  function showApp() {
    applyAuthenticatedShell({
      loginScreen,
      currentUser,
      sessionUser,
      formatUserDisplay
    });
    if (featureMenu) featureMenu.value = "/internal-orders.html";
  }

  function showLogin() {
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
    sessionPermissions = {};
  }

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      window.location.href = "/change-password.html";
    }
  });

  async function queueApi(path, options = {}, meta = {}) {
    if (!window.kitchenOfflineQueue?.request) return api(path, options);
    return window.kitchenOfflineQueue.request(path, options, {
      allowQueue: true,
      token: sessionToken,
      ...meta
    });
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function hasSearchTerm() {
    return Boolean(String(searchInput?.value || "").trim());
  }

  function render() {
    const filteredItems = filterItems({
      allItems,
      searchValue: searchInput.value,
      areaValue: areaFilter.value,
      locationValue: locationFilter.value
    });
    if (hasSearchTerm()) {
      activeCategory = "";
      categoryView.hidden = true;
      productView.hidden = false;
      renderCatalog({
        items: filteredItems,
        selected,
        categoryTitle,
        categoryMeta,
        backButton,
        catalogList,
        searchTermActive: true,
        activeCategory
      });
    } else if (productView.hidden) {
      renderCategories({
        items: filteredItems,
        selected,
        categoryGrid
      });
    } else {
      renderCatalog({
        items: filteredItems.filter((item) => !activeCategory || itemCategory(item) === activeCategory),
        selected,
        categoryTitle,
        categoryMeta,
        backButton,
        catalogList,
        searchTermActive: false,
        activeCategory
      });
    }
    renderSelectedChips({ selected, selectedChips });
    renderInternalOrders({ internalOrders, internalOrderList, internalCount, internalDrafts });
    updateSaveButton({ selected, submitButton });
  }

  function syncRow(row) {
    const itemId = row.dataset.itemId;
    const item = allItems.find((entry) => entry.id === itemId);
    if (!item) return;
    if (!selected.has(itemId)) return;
    selected.set(itemId, {
      item,
      quantityItems: Math.max(1, Number(row.querySelector(".qty-input")?.value || 1))
    });
  }

  function toggleRow(row) {
    const itemId = row.dataset.itemId;
    const item = allItems.find((entry) => entry.id === itemId);
    if (!item) return;
    if (selected.has(itemId)) selected.delete(itemId);
    else {
      selected.set(itemId, {
        item,
        quantityItems: Math.max(1, Number(row.querySelector(".qty-input")?.value || 1))
      });
    }
    render();
  }

  async function loadData() {
    setMessage("Loading internal requests...");
    const [itemsData, internalData] = await Promise.all([
      api("/api/items"),
      api("/api/internal-orders")
    ]);
    allItems = itemsData.items || [];
    internalOrders = internalData.internalOrders || [];
    internalDrafts = new Map();
    populateFilters({ allItems, areaFilter, locationFilter });
    render();
    setMessage("");
  }

  function updateInternalDraft(batchId, lineId, patch) {
    const batchDraft = internalDrafts.get(batchId) || new Map();
    const lineDraft = batchDraft.get(lineId) || {};
    batchDraft.set(lineId, { ...lineDraft, ...patch });
    internalDrafts.set(batchId, batchDraft);
  }

  function buildInternalPayload(article) {
    return {
      lines: [...article.querySelectorAll(".internal-order-line")].map((row) => ({
        lineId: row.dataset.lineId,
        quantityItems: Number(row.querySelector(".internal-line-qty-input")?.value || 0),
        removeRequested: row.querySelector(".internal-line-remove-input")?.checked || false
      }))
    };
  }

  async function saveInternalOrder(article, removeAll = false) {
    const batchId = article.dataset.batchId;
    const payload = removeAll
      ? {
        lines: [...article.querySelectorAll(".internal-order-line")].map((row) => ({
          lineId: row.dataset.lineId,
          removeRequested: true
        }))
      }
      : buildInternalPayload(article);
    if (removeAll) {
      if (!window.confirm("Remove this internal order?")) return;
    }
    const result = await queueApi(`/api/internal-orders/${batchId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }, {
      label: removeAll ? "Internal order remove" : "Internal order update"
    });
    if (result?.offlineQueued) {
      internalDrafts.delete(batchId);
      setMessage(removeAll ? "Internal order removal saved offline." : "Internal order update saved offline.");
      return;
    }
    await loadData();
    setMessage(removeAll ? "Internal order removed." : "Internal order updated.");
  }

  async function submitInternalOrder() {
    if (!selected.size) return;
    submitButton.disabled = true;
    setMessage("Sending internal request...");
    try {
      const result = await queueApi("/api/internal-orders", {
        method: "POST",
        body: JSON.stringify({
          lines: [...selected.values()].map((entry) => ({
            itemId: entry.item.id,
            quantityItems: entry.quantityItems
          }))
        })
      }, {
        label: "Internal request"
      });
      selected = new Map();
      if (result?.offlineQueued) {
        render();
        setMessage("Internal request saved offline. It will sync when the signal is back.");
      } else {
        await loadData();
        setMessage("Internal request sent to the picker.");
      }
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      updateSaveButton({ selected, submitButton });
    }
  }

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
      sessionPermissions = saved.permissions;
      if (!sessionPermissions.canPlaceInternalOrders) throw new Error("This user cannot create internal requests.");
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      showApp();
      await loadData();
      setLoginMessage("");
    }
  });

  logoutButton.addEventListener("click", showLogin);
  refreshButton?.addEventListener("click", () => loadData().catch((error) => setMessage(error.message, true)));
  window.addEventListener("kitchen-offline-queue-synced", () => {
    loadData().catch((error) => setMessage(error.message, true));
  });
  submitButton.addEventListener("click", () => submitInternalOrder().catch((error) => setMessage(error.message, true)));
  searchInput.addEventListener("input", render);
  areaFilter.addEventListener("change", render);
  locationFilter.addEventListener("change", render);
  categoryGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category || "";
    categoryView.hidden = true;
    productView.hidden = false;
    render();
  });
  backButton.addEventListener("click", () => {
    activeCategory = "";
    productView.hidden = true;
    categoryView.hidden = false;
    render();
  });

  catalogList.addEventListener("click", (event) => {
    const toggle = event.target.closest(".product-check");
    if (!toggle) return;
    const row = toggle.closest(".product-row");
    if (!row) return;
    toggleRow(row);
  });

  catalogList.addEventListener("change", (event) => {
    const input = event.target.closest(".qty-input");
    if (!input) return;
    const row = input.closest(".product-row");
    if (!row) return;
    if (!selected.has(row.dataset.itemId)) return;
    syncRow(row);
    updateSaveButton({ selected, submitButton });
  });

  selectedChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-remove-id]");
    if (!chip) return;
    selected.delete(chip.dataset.removeId || "");
    render();
  });

  internalOrderList.addEventListener("change", (event) => {
    const qtyInput = event.target.closest(".internal-line-qty-input");
    if (qtyInput) {
      const row = qtyInput.closest(".internal-order-line");
      const article = qtyInput.closest(".internal-order-row");
      if (!row || !article) return;
      updateInternalDraft(article.dataset.batchId, row.dataset.lineId, {
        quantityItems: Math.max(1, Math.round(Number(qtyInput.value || 1)))
      });
      return;
    }
    const removeInput = event.target.closest(".internal-line-remove-input");
    if (removeInput) {
      const row = removeInput.closest(".internal-order-line");
      const article = removeInput.closest(".internal-order-row");
      if (!row || !article) return;
      row.classList.toggle("remove-requested", removeInput.checked);
      updateInternalDraft(article.dataset.batchId, row.dataset.lineId, {
        removeRequested: removeInput.checked
      });
    }
  });

  internalOrderList.addEventListener("click", (event) => {
    const saveButton = event.target.closest(".save-internal-order");
    if (saveButton) {
      const article = saveButton.closest(".internal-order-row");
      if (!article) return;
      saveButton.disabled = true;
      saveInternalOrder(article, false)
        .catch((error) => setMessage(error.message, true))
        .finally(() => { saveButton.disabled = false; });
      return;
    }
    const removeButton = event.target.closest(".remove-internal-order");
    if (removeButton) {
      const article = removeButton.closest(".internal-order-row");
      if (!article) return;
      removeButton.disabled = true;
      saveInternalOrder(article, true)
        .catch((error) => setMessage(error.message, true))
        .finally(() => { removeButton.disabled = false; });
    }
  });

  if (sessionToken && sessionUser) {
    showApp();
    loadData().catch((error) => setMessage(error.message, true));
  } else {
    showLogin();
  }
}
