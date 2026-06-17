import {
  escapeHtml,
  formatUserDisplay,
  itemMeta,
  itemUnit,
  localDateKey,
  normalize,
  openOrderThresholdDays,
  sameUser,
  searchTokens,
  stockMeta,
  todayLocal
} from "./ordering/shared.js";
import {
  groupRequestsByCategory,
  groupRequestsForOrderSheet,
  itemCategory,
  itemNameFromRequest,
  logicalRequestCompare,
  requestSortValue
} from "./ordering/request-grouping.js";
import {
  displayRoleMode as displayRoleModeValue,
  hasSearchTerm as hasSearchTermValue,
  hasValidRequestItemId,
  isStandingDue as isStandingDueValue,
  orderingItemMatchesSummary as orderingItemMatchesSummaryValue,
  orderingRequestMatchesSummary as orderingRequestMatchesSummaryValue,
  requestMatchesScope as requestMatchesScopeValue,
  requestOpenStatsForItem as requestOpenStatsForItemValue
} from "./ordering/summary-filters.js";
import {
  duplicateSourceLabel,
  expectedDateFromRequest,
  hasFutureScheduledDelivery,
  isAutoMinimumRequest,
  isInternalShortageRequest,
  isOlderOpenRequest,
  isStandingOrder,
  requestArea,
  requestDay,
  requestLocation,
  requestStatusChips,
  requestUser,
  scheduledDeliveryDay
} from "./ordering/request-status.js";
import {
  renderCategories as renderCategoriesView,
  renderDailyOrder as renderDailyOrderView,
  renderNotifications as renderNotificationsView,
  renderOrderingSummary as renderOrderingSummaryView,
  renderProductList as renderProductListView,
  renderSelectedChips as renderSelectedChipsView,
  renderStandingOrders as renderStandingOrdersView
} from "./ordering/render.js";
import { attachOrderingInteractions } from "./ordering/interactions.js";

const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const refreshButton = document.querySelector("#refreshButton");
const submitButton = document.querySelector("#submitButton");
const featureMenu = document.querySelector("#featureMenu");
const backofficeMenu = document.querySelector("#backofficeMenu");
const searchInput = document.querySelector("#searchInput");
const requestScopeFilter = document.querySelector("#requestScopeFilter");
const selectedChips = document.querySelector("#selectedChips");
const categoryView = document.querySelector("#categoryView");
const categoryGrid = document.querySelector("#categoryGrid");
const productView = document.querySelector("#productView");
const productList = document.querySelector("#productList");
const categoryTitle = document.querySelector("#categoryTitle");
const categoryMeta = document.querySelector("#categoryMeta");
const backButton = document.querySelector("#backButton");
const dailyOrderCount = document.querySelector("#dailyOrderCount");
const dailyOrderList = document.querySelector("#dailyOrderList");
const standingOrderCount = document.querySelector("#standingOrderCount");
const standingOrderList = document.querySelector("#standingOrderList");
const notificationCount = document.querySelector("#notificationCount");
const notificationList = document.querySelector("#notificationList");
const notificationPanel = document.querySelector(".notification-panel");
const readAllNotificationsButton = document.querySelector("#readAllNotificationsButton");
const orderingMode = document.querySelector("#orderingMode");
const orderingSummaryCards = document.querySelector("#orderingSummaryCards");
const message = document.querySelector("#message");
const pageParams = new URLSearchParams(window.location.search);

let allItems = [];
let recentRequests = [];
let standingOrders = [];
let notifications = [];
let activeCategory = "";
let selected = new Map();
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionRole = localStorage.getItem("kitchenStockRole") || "user";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let orderingSummaryFilter = "all";
const bootstrapCacheKey = "kitchenStockOrderingBootstrap";
let pendingJumpItemId = String(pageParams.get("itemId") || "").trim();
let pendingJumpCategory = String(pageParams.get("category") || "").trim();

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  if (!sessionPermissions.canUseSupplierOrdering && sessionPermissions.canPlaceInternalOrders) {
    window.location.href = "/internal-orders.html";
    return;
  }
  if (currentUser) {
    currentUser.textContent = formatUserDisplay(sessionUser);
    currentUser.hidden = false;
  }
  window.refreshKitchenMenus?.();
  document.querySelectorAll("[data-permission]").forEach((element) => {
    element.hidden = !sessionPermissions[element.dataset.permission];
  });
  document.querySelectorAll("#featureMenu option[data-permission]").forEach((option) => {
    option.hidden = !sessionPermissions[option.dataset.permission];
    option.disabled = !sessionPermissions[option.dataset.permission];
  });
  if (featureMenu) featureMenu.value = "/ordering.html";
  if (backofficeMenu) backofficeMenu.value = "";
}

function saveSession(data) {
  sessionToken = data.token || sessionToken;
  sessionUser = data.user.name;
  sessionRole = data.user.role || "user";
  sessionPermissions = data.user.permissions || {};
  localStorage.setItem("kitchenStockToken", sessionToken);
  localStorage.setItem("kitchenStockUser", sessionUser);
  localStorage.setItem("kitchenStockRole", sessionRole);
  localStorage.setItem("kitchenStockPermissions", JSON.stringify(sessionPermissions));
  localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
  window.applyKitchenTheme?.(data.user.theme || "dark");
  window.setupKitchenPush?.();
}

function showLogin() {
  loginScreen.hidden = false;
  if (currentUser) {
    currentUser.textContent = "";
    currentUser.hidden = true;
  }
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
  localStorage.removeItem("kitchenStockRole");
  localStorage.removeItem("kitchenStockPermissions");
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
  if (response.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") {
    window.location.href = "/change-password.html";
  }
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

async function refreshSession() {
  const data = await api("/api/me");
  saveSession({ token: sessionToken, user: data.user });
  if (data.user.mustChangePassword) {
    window.location.href = "/change-password.html";
    return false;
  }
  showApp();
  return true;
}

function hasSearchTerm() {
  return hasSearchTermValue(searchInput.value);
}

function selectedRequestScope() {
  return String(requestScopeFilter?.value || "").trim();
}

function requestMatchesScope(request) {
  return requestMatchesScopeValue(request, {
    scope: selectedRequestScope(),
    sessionUser,
    sameUser,
    requestUser
  });
}

function displayRoleMode() {
  return displayRoleModeValue(sessionRole);
}

function requestOpenStatsForItem(itemId) {
  return requestOpenStatsForItemValue(itemId, {
    recentRequests,
    sameUser,
    requestUser,
    sessionUser,
    isStandingOrder
  });
}

function isStandingDue(order, today = todayLocal()) {
  return isStandingDueValue(order, today);
}

function orderingItemMatchesSummary(item, today = todayLocal()) {
  return orderingItemMatchesSummaryValue(item, {
    orderingSummaryFilter,
    today,
    requestOpenStatsForItem,
    selected,
    recentRequests,
    isStandingOrder,
    isOlderOpenRequest,
    standingOrders
  });
}

function orderingRequestMatchesSummary(request, today = todayLocal()) {
  return orderingRequestMatchesSummaryValue(request, {
    orderingSummaryFilter,
    today,
    allItems,
    selected,
    sameUser,
    sessionUser,
    requestUser,
    isOlderOpenRequest
  });
}

function duplicateReferencesForEntry(entry) {
  const itemId = String(entry?.item?.id || "").trim();
  const currentRequestId = String(entry?.requestId || "").trim();
  const today = todayLocal();
  if (!itemId) return [];
  return recentRequests
    .filter((request) => String(request?.itemId || "").trim() === itemId)
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => String(request.id || "").trim() !== currentRequestId)
    .filter((request) => {
      const requestDate = requestDay(request);
      const deliveryDay = String(request.deliveryDay || "").trim();
      const sameDayOrder = !request.standingRunId && !isStandingOrder(request) && requestDate === today;
      const standingPending = (Boolean(request.standingRunId) || isStandingOrder(request))
        && Boolean((deliveryDay && deliveryDay <= today) || expectedDateFromRequest(request) === today || (requestDate && requestDate <= today));
      const scheduledToday = Boolean(request.toDeliver) && (!deliveryDay || deliveryDay === today);
      const partialCarry = Boolean(request.partialReceipt);
      return sameDayOrder || standingPending || scheduledToday || partialCarry;
    });
}

function confirmDuplicateSave(entries) {
  const warnings = entries
    .map((entry) => ({
      entry,
      refs: duplicateReferencesForEntry(entry)
    }))
    .filter((result) => result.refs.length);
  if (!warnings.length) return true;

  const lines = warnings.flatMap(({ entry, refs }) => {
    const itemName = entry?.item?.name || "Item";
    return [
      `${itemName} already has an open reference:`,
      ...refs.map((request) => `- ${duplicateSourceLabel(request)}`)
    ];
  });

  return window.confirm(
    `This looks like a possible double order.\n\n${lines.join("\n")}\n\nDo you want to save it anyway?`
  );
}

function renderOrderingSummary() {
  renderOrderingSummaryView({
    orderingSummaryCards,
    orderingMode,
    displayRoleMode,
    today: todayLocal(),
    recentRequests,
    selected,
    sessionUser,
    sameUser,
    allItems,
    standingOrders,
    isStandingDue,
    orderingSummaryFilter
  });
}

function loadBootstrapCache() {
  try {
    return JSON.parse(localStorage.getItem(bootstrapCacheKey) || "null");
  } catch {
    return null;
  }
}

function saveBootstrapCache(data) {
  try {
    localStorage.setItem(bootstrapCacheKey, JSON.stringify({
      items: data.items || [],
      requests: data.requests || [],
      standingOrders: data.standingOrders || [],
      notifications: data.notifications || [],
      cachedAt: new Date().toISOString()
    }));
  } catch {
    // Ignore cache write problems.
  }
}

function applyBootstrapData(data = {}) {
  allItems = Array.isArray(data.items) ? data.items : [];
  recentRequests = Array.isArray(data.requests) ? data.requests : [];
  standingOrders = Array.isArray(data.standingOrders) ? data.standingOrders : [];
  notifications = Array.isArray(data.notifications) ? data.notifications : [];
  selected = buildSelectedFromRecentRequests();
  render();
}

function entryUnit(entry) {
  return entry?.unit || itemUnit(entry?.item || {});
}

function addItemHrefFromSearch() {
  const params = new URLSearchParams();
  const term = searchInput.value.trim();
  if (term) params.set("itemName", term);
  if (areaFilter.value) params.set("inventoryArea", areaFilter.value);
  if (locationFilter.value) params.set("storageLocation", locationFilter.value);
  const query = params.toString();
  return `/inventory-add.html${query ? `?${query}` : ""}`;
}

function defaultQuantity(item) {
  const minimum = Number(item.minimum || 0);
  const current = Number(item.quantity || 0);
  if (minimum > current) return Math.max(1, minimum - current);
  return 1;
}

function filterItems() {
  const area = areaFilter.value;
  const location = locationFilter.value;
  const search = normalize(searchInput.value);
  const tokens = searchTokens(searchInput.value);
  const today = todayLocal();

  return allItems.filter((item) => {
    const areaMatches = !area || !item.inventoryArea || item.inventoryArea === area;
    const locationMatches = !location || !item.storageLocation || item.storageLocation === location;
    const searchText = normalize([
      item.name,
      item.category,
      item.storageLocation,
      item.inventoryArea,
      item.shelfCode,
      item.supplierName
    ].join(" "));
    const searchMatches = !tokens.length || (searchText.includes(search) && tokens.every((token) => searchText.includes(token)));
    const summaryMatches = orderingItemMatchesSummary(item, today);
    return areaMatches && locationMatches && searchMatches && summaryMatches;
  });
}

function itemSearchScore(item) {
  const query = normalize(searchInput.value);
  if (!query) return 0;
  const name = normalize(item.name);
  const category = normalize(item.category);
  const supplier = normalize(item.supplierName);
  const meta = normalize([
    item.storageLocation,
    item.inventoryArea,
    item.shelfCode
  ].join(" "));
  if (name === query) return 400;
  if (name.startsWith(query)) return 300;
  if (name.includes(query)) return 220;
  if (category.startsWith(query)) return 160;
  if (category.includes(query)) return 130;
  if (supplier.startsWith(query)) return 110;
  if (supplier.includes(query)) return 90;
  if (meta.includes(query)) return 60;
  return 10;
}

function categoryStats(category, items) {
  const chosen = items.filter((item) => selected.has(item.id)).length;
  const low = items.filter((item) => item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0)).length;
  return { chosen, low };
}

function updateSaveButton() {
  const count = selected.size;
  submitButton.textContent = `${count} Saved`;
  submitButton.disabled = count === 0;
}

function renderSelectedChips() {
  renderSelectedChipsView({
    selectedChips,
    selected,
    entryUnit
  });
}

function renderNotifications() {
  renderNotificationsView({
    notificationList,
    notificationCount,
    notificationPanel,
    readAllNotificationsButton,
    notifications
  });
}

function jumpToItem(itemId, category = "") {
  const item = allItems.find((candidate) => String(candidate.id) === String(itemId));
  if (!item) return;
  pendingJumpItemId = String(item.id);
  pendingJumpCategory = category || itemCategory(item);
  searchInput.value = "";
  activeCategory = pendingJumpCategory || itemCategory(item);
  categoryView.hidden = true;
  productView.hidden = false;
  render();
  const row = productList.querySelector(`.product-row[data-item-id="${String(item.id || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
  if (!row) return;
  row.classList.add("jump-highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => row.classList.remove("jump-highlight"), 2400);
}

function applyPendingJump() {
  if (!pendingJumpItemId) return;
  jumpToItem(pendingJumpItemId, pendingJumpCategory);
  pendingJumpItemId = "";
  pendingJumpCategory = "";
  if (window.history?.replaceState) {
    window.history.replaceState({}, "", "/ordering.html");
  }
}

function renderDailyOrder() {
  renderDailyOrderView({
    dailyOrderCount,
    dailyOrderList,
    today: todayLocal(),
    recentRequests,
    hasValidRequestItemId,
    requestMatchesScope,
    orderingRequestMatchesSummary,
    allItems,
    sameUser,
    sessionPermissions,
    sessionUser
  });
}

function renderStandingOrders() {
  renderStandingOrdersView({ standingOrderCount, standingOrderList, standingOrders });
}

function renderCategories() {
  renderCategoriesView({
    categoryGrid,
    filterItems,
    selected,
    categoryStats,
    requestOpenStatsForItem
  });
}

function renderProductList() {
  renderProductListView({
    activeCategory,
    categoryTitle,
    categoryMeta,
    backButton,
    productList,
    filterItems,
    hasSearchTerm,
    itemSearchScore,
    selected,
    defaultQuantity,
    itemUnit,
    requestOpenStatsForItem,
    addItemHrefFromSearch,
    sessionPermissions
  });
}

function render() {
  const searchMode = hasSearchTerm();
  if (searchMode) {
    activeCategory = "";
    categoryView.hidden = true;
    productView.hidden = false;
    renderProductList();
  } else if (productView.hidden) {
    backButton.hidden = false;
    renderCategories();
  } else {
    backButton.hidden = false;
    renderProductList();
  }
  renderSelectedChips();
  renderOrderingSummary();
  renderDailyOrder();
  renderStandingOrders();
  renderNotifications();
  updateSaveButton();
}

function selectItem(item, quantity = defaultQuantity(item), urgency = "Medium") {
  selected.set(item.id, {
    item,
    quantity: Math.max(1, Number(quantity || 1)),
    urgency,
    unit: itemUnit(item),
    deleteRequested: false
  });
}

function buildSelectedFromRecentRequests() {
  const map = new Map();
  const currentDay = todayLocal();
  const userRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !isStandingOrder(request))
    .filter(hasValidRequestItemId)
    .filter((request) => sameUser(request.requestedBy, sessionUser))
    .filter((request) => {
      const requestDay = localDateKey(request.requestedAt);
      return !requestDay || requestDay === currentDay;
    })
    .sort((left, right) => {
      const leftTime = new Date(left.requestedAt || 0).getTime() || 0;
      const rightTime = new Date(right.requestedAt || 0).getTime() || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return Number(right.requestId || 0) - Number(left.requestId || 0);
    });

  for (const request of userRequests) {
    if (map.has(request.itemId)) continue;
    const item = allItems.find((candidate) => candidate.id === request.itemId);
    if (!item) continue;
    map.set(request.itemId, {
      item,
      requestId: request.id,
      quantity: Math.max(1, Number(request.quantity || 1)),
      urgency: request.urgency || "Medium",
      unit: request.unit || itemUnit(item),
      deleteRequested: false
    });
  }

  return map;
}

function syncProductRow(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item || !selected.has(item.id)) return;
  const current = selected.get(item.id) || {};
  selected.set(item.id, {
    item,
    requestId: current.requestId,
    quantity: Math.max(1, Number(row.querySelector(".qty-input").value || 1)),
    urgency: row.querySelector(".urgency-input").value,
    unit: row.querySelector(".unit-input")?.value || itemUnit(item),
    deleteRequested: Boolean(row.querySelector(".delete-request-input")?.checked)
  });
}

function optimisticRequestFromEntry(entry, index = 0) {
  const requestId = entry.requestId || `offline-request-${Date.now()}-${index}`;
  return {
    id: requestId,
    requestId,
    itemId: String(entry.item.id || "").trim(),
    quantity: Math.max(1, Number(entry.quantity || 1)),
    quantityNeeded: Math.max(1, Number(entry.quantity || 1)),
    unit: entry.unit || itemUnit(entry.item),
    orderUnit: entry.unit || itemUnit(entry.item),
    urgency: entry.urgency || "Medium",
    urgencyLevel: entry.urgency || "Medium",
    inventoryArea: entry.item.inventoryArea || "",
    storageLocation: entry.item.storageLocation || "",
    shelfCode: entry.item.shelfCode || "",
    requestedBy: sessionUser || "Kitchen",
    requestedAt: new Date().toISOString(),
    status: "Approved",
    delivered: false,
    received: false,
    notes: ""
  };
}

function toggleProduct(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item) return;

  if (selected.has(item.id)) {
    selected.delete(item.id);
  } else {
    selectItem(item, row.querySelector(".qty-input").value, row.querySelector(".urgency-input").value);
    const entry = selected.get(item.id);
    if (entry) {
      entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
      entry.deleteRequested = Boolean(row.querySelector(".delete-request-input")?.checked);
    }
  }

  render();
}

async function refresh(silent = false) {
  if (!silent) setMessage("Loading products...");
  const data = await api("/api/bootstrap");
  applyBootstrapData(data);
  applyPendingJump();
  saveBootstrapCache(data);
  setMessage("");
}

function collectSelectedEntries(itemIds = null) {
  const wantedIds = itemIds ? new Set(itemIds.map((value) => String(value || "").trim()).filter(Boolean)) : null;
  return [...selected.values()]
    .filter((entry) => entry?.item?.id)
    .filter((entry) => !wantedIds || wantedIds.has(String(entry.item.id)));
}

async function submitSelected(itemIds = null) {
  const scopedEntries = collectSelectedEntries(itemIds);
  if (!scopedEntries.length) return;

  submitButton.disabled = true;
  setMessage("Saving order...");

  try {
    const deleteEntries = scopedEntries.filter((entry) => entry.deleteRequested && entry.requestId);
    const saveEntries = scopedEntries.filter((entry) => !entry.deleteRequested);
    let queuedOffline = false;

    if (saveEntries.length && !confirmDuplicateSave(saveEntries)) {
      setMessage("Duplicate save cancelled.");
      return;
    }

    if (deleteEntries.length) {
      const deleteResults = await Promise.all(deleteEntries.map((entry) => queueApi(`/api/requests/${entry.requestId}`, {
        method: "DELETE"
      }, {
        label: `${entry.item?.name || "Order item"} delete`
      })));
      queuedOffline = queuedOffline || deleteResults.some((result) => result?.offlineQueued);
    }

    const requests = saveEntries
      .map((entry) => ({
      itemId: String(entry.item.id || "").trim(),
      quantityNeeded: entry.quantity,
      unitOverride: entry.unit || itemUnit(entry.item),
      urgencyLevel: entry.urgency,
      storageLocation: entry.item.storageLocation || "",
      inventoryArea: entry.item.inventoryArea || "",
      shelfCode: entry.item.shelfCode || "",
      requestedBy: sessionUser || "Kitchen",
      notes: ""
    }))
      .filter((entry) => entry.itemId);
    if (!requests.length && !deleteEntries.length) {
      throw new Error("No valid items were selected to save.");
    }
    let data = { requests: [] };
    if (requests.length) {
      data = await queueApi("/api/requests/batch", {
        method: "POST",
        body: JSON.stringify({ requests })
      }, {
        label: `${requests.length} order item(s)`,
        fallbackData: {
          requests: saveEntries.map((entry, index) => optimisticRequestFromEntry(entry, index))
        }
      });
      queuedOffline = queuedOffline || Boolean(data?.offlineQueued);
    }
    const deletedIds = new Set(deleteEntries.map((entry) => entry.requestId).filter(Boolean));
    const saved = requests.length;
    const deleted = deleteEntries.length;
    const byId = new Map(recentRequests.filter((request) => !deletedIds.has(request.id)).map((request) => [request.id, request]));
    for (const request of data.requests || []) {
      if (request?.id) byId.set(request.id, request);
    }
    recentRequests = [...byId.values()]
      .sort((left, right) => {
        const leftTime = new Date(left.requestedAt || 0).getTime() || 0;
        const rightTime = new Date(right.requestedAt || 0).getTime() || 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return Number(right.requestId || 0) - Number(left.requestId || 0);
      })
      .slice(0, 200);
    selected = buildSelectedFromRecentRequests();
    render();
    const actions = [];
    if (saved) actions.push(`${saved} item(s) saved`);
    if (deleted) actions.push(`${deleted} item(s) deleted`);
    setMessage(queuedOffline ? `${actions.join(" and ")} offline. They will sync automatically.` : `${actions.join(" and ")}.`);
    if (!queuedOffline) {
      window.setTimeout(() => {
        refresh().catch((error) => setMessage(error.message, true));
      }, 250);
    }
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    updateSaveButton();
  }
}

function ensureRowSelection(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item) return null;
  const quantityInput = row.querySelector(".qty-input");
  const quantity = Math.max(1, Number(quantityInput?.value || 1));
  if (!selected.has(item.id)) {
    selectItem(item, quantity, row.querySelector(".urgency-input")?.value || "Medium");
  }
  syncProductRow(row);
  return item;
}

async function deleteDailyOrder(requestId) {
  await api(`/api/requests/${requestId}`, { method: "DELETE" });
  recentRequests = recentRequests.filter((request) => request.id !== requestId);
  selected = buildSelectedFromRecentRequests();
  render();
  setMessage("Item removed from today's order.");
}

async function deliverDailyOrder(requestId) {
  await api(`/api/requests/${requestId}/deliver`, { method: "POST" });
  await refresh();
  setMessage("Item delivered, added to inventory, and closed.");
}

async function updateCurrentStock(itemId, countedQuantity) {
  const data = await queueApi("/api/stock-counts", {
    method: "POST",
    body: JSON.stringify({
      itemId,
      countedQuantity,
      notes: "Adjusted from request screen."
    })
  }, {
    label: "Stock update",
    fallbackData: {
      item: {
        id: itemId,
        quantity: Number(countedQuantity || 0)
      }
    }
  });
  allItems = allItems.map((item) => (item.id === data.item.id ? { ...item, quantity: data.item.quantity } : item));
  selected = new Map(
    [...selected.entries()].map(([id, entry]) => [
      id,
      id === data.item.id ? { ...entry, item: { ...entry.item, quantity: data.item.quantity } } : entry
    ])
  );
}

async function markNotificationsRead(ids = []) {
  const data = await api("/api/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  notifications = data.notifications || [];
  renderNotifications();
}

attachOrderingInteractions({
  loginForm,
  usernameInput,
  passwordInput,
  setLoginMessage,
  saveSession,
  showApp,
  showLogin,
  refresh,
  refreshSession,
  submitButton,
  submitSelected,
  featureMenu,
  backofficeMenu,
  refreshButton,
  categoryGrid,
  activeCategoryRef: {
    get: () => activeCategory,
    set: (value) => {
      activeCategory = value;
    }
  },
  categoryView,
  productView,
  render,
  backButton,
  productList,
  toggleProduct,
  updateCurrentStock,
  ensureRowSelection,
  allItemsRef: () => allItems,
  setMessage,
  syncProductRow,
  selectedRef: () => selected,
  selectItem,
  selectedChips,
  dailyOrderList,
  jumpToItem,
  deliverDailyOrder,
  deleteDailyOrder,
  notificationList,
  markNotificationsRead,
  readAllNotificationsButton,
  areaFilter,
  locationFilter,
  hasSearchTerm,
  requestScopeFilter,
  renderOrderingSummary,
  renderDailyOrder,
  renderCategories,
  renderProductList,
  orderingSummaryCards,
  orderingSummaryFilterRef: {
    get: () => orderingSummaryFilter,
    set: (value) => {
      orderingSummaryFilter = value;
    }
  },
  searchInput,
  sessionToken: () => sessionToken,
  sessionUser: () => sessionUser,
  updateSaveButton,
  loadBootstrapCache,
  applyBootstrapData,
  applyPendingJump
});








