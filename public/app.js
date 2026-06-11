const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const refreshButton = document.querySelector("#refreshButton");
const submitButton = document.querySelector("#submitButton");
const featureMenu = document.querySelector("#featureMenu");
const backofficeMenu = document.querySelector("#backofficeMenu");
const searchInput = document.querySelector("#searchInput");
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
const readAllNotificationsButton = document.querySelector("#readAllNotificationsButton");
const message = document.querySelector("#message");

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

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

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

function sameUser(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function showApp() {
  loginScreen.hidden = true;
  const roleLabel = sessionRole === "god" ? "God" : sessionRole === "admin" ? "Admin" : sessionRole === "power-user" ? "Power User" : "User";
  currentUser.textContent = sessionUser ? `${formatUserDisplay(sessionUser)} / ${roleLabel}` : "";
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
  currentUser.textContent = "";
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasSearchTerm() {
  return Boolean(normalize(searchInput.value));
}

function itemCategory(item) {
  return item.category || "Uncategorized";
}

function itemMeta(item) {
  return [item.inventoryArea, item.storageLocation, item.shelfCode].filter(Boolean).join(" / ");
}

function stockMeta(item) {
  return `Current ${item.quantity ?? 0} ${itemUnit(item)} / min ${item.minimum ?? 0}`;
}

function isStandingOrder(request) {
  return String(request.requestedBy || "").toLowerCase().includes("standing order")
    || String(request.notes || "").toLowerCase().includes("standing order");
}

function hasValidRequestItemId(request) {
  return Boolean(String(request?.itemId || "").trim());
}

function expectedDateFromRequest(request) {
  const match = String(request.notes || "").match(/Expected arrival:\s*(\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : "";
}

function itemUnit(item) {
  return item.unit || "item";
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
    return areaMatches && locationMatches && (!search || searchText.includes(search));
  });
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
  const chips = [...selected.values()].slice(0, 12);
  selectedChips.innerHTML = chips
    .map((entry) => `
      <button class="selected-chip" type="button" data-remove-id="${entry.item.id}">
        <span>${escapeHtml(entry.item.name)}</span>
        <small>${entry.quantity} ${escapeHtml(entryUnit(entry))}</small>
      </button>
    `)
    .join("");
}

function formatNotificationDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderNotifications() {
  if (!notificationList || !notificationCount) return;
  const unread = notifications.filter((note) => !note.isRead);
  notificationCount.textContent = `${unread.length} unread`;
  if (readAllNotificationsButton) readAllNotificationsButton.disabled = unread.length === 0;
  if (!unread.length) {
    notificationList.innerHTML = '<p class="empty-sheet">No notifications right now.</p>';
    return;
  }
  notificationList.innerHTML = unread
    .slice(0, 20)
    .map((note) => `
      <article class="notification-row" data-notification-id="${escapeHtml(note.id)}">
        <div>
          <strong>${escapeHtml(note.title || "Notification")}</strong>
          <span>${escapeHtml(note.body || "")}</span>
          <small>${escapeHtml(formatNotificationDate(note.createdAt))}</small>
        </div>
        <button class="icon-button mark-notification-read" type="button">Mark read</button>
      </article>
    `)
    .join("");
}

function itemNameFromRequest(request) {
  return allItems.find((item) => item.id === request.itemId)?.name || "Requested item";
}

function requestSortValue(request) {
  const item = allItems.find((candidate) => candidate.id === request.itemId);
  return {
    supplier: item?.supplierName || request.supplierName || "",
    category: item?.category || request.category || "",
    name: item?.name || "Requested item"
  };
}

function logicalRequestCompare(a, b) {
  const left = requestSortValue(a);
  const right = requestSortValue(b);
  const supplier = left.supplier.localeCompare(right.supplier);
  if (supplier) return supplier;
  const category = left.category.localeCompare(right.category);
  if (category) return category;
  return left.name.localeCompare(right.name);
}

function groupRequestsByCategory(requests) {
  const groups = new Map();
  for (const request of requests) {
    const category = allItems.find((candidate) => candidate.id === request.itemId)?.category || request.category || "Uncategorized";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(request);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderDailyOrder() {
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !request.standingRunId)
    .filter((request) => !isStandingOrder(request))
    .filter(hasValidRequestItemId)
    .sort(logicalRequestCompare);
  dailyOrderCount.textContent = `${activeRequests.length} active`;
  const grouped = groupRequestsByCategory(activeRequests.slice(0, 100));
  dailyOrderList.innerHTML = grouped
    .map(([category, requests]) => `
      <section class="daily-order-group">
        <div class="daily-order-group-heading">
          <h3>${escapeHtml(category)}</h3>
          <span>${requests.length} item${requests.length === 1 ? "" : "s"}</span>
        </div>
        <div class="daily-order-group-list">
          ${requests
            .sort((a, b) => itemNameFromRequest(a).localeCompare(itemNameFromRequest(b), undefined, { numeric: true }))
            .map((request) => `
              <article class="daily-order-row">
                <div>
                  <strong>${escapeHtml(itemNameFromRequest(request))}</strong>
                  <span>${escapeHtml([
                    request.quantity,
                    allItems.find((candidate) => candidate.id === request.itemId)?.category || request.category,
                    request.inventoryArea,
                    request.storageLocation,
                    isStandingOrder(request) ? `Standing order${expectedDateFromRequest(request) ? ` expected ${expectedDateFromRequest(request)}` : ""}` : ""
                  ].filter(Boolean).join(" / "))}</span>
                </div>
                <div class="daily-order-actions">
                  <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Received</button>
                  ${sessionPermissions.canDeleteAnyOrder || sameUser(request.requestedBy, sessionUser) ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Delete</button>` : ""}
                </div>
              </article>
            `).join("")}
        </div>
      </section>
    `)
    .join("");

  if (!dailyOrderList.innerHTML) {
    dailyOrderList.innerHTML = '<p class="empty-sheet">No active orders yet.</p>';
  }
}

function renderStandingOrders() {
  standingOrderCount.textContent = `${standingOrders.length} scheduled`;
  if (!standingOrders.length) {
    standingOrderList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    return;
  }
  standingOrderList.innerHTML = standingOrders
    .slice(0, 100)
    .map((order) => {
      return `
      <a class="daily-order-row daily-order-link" href="/standing-orders.html?orderId=${encodeURIComponent(order.id)}">
        <div>
          <strong>${escapeHtml(order.supplierName || order.name || "Standing Order")}</strong>
          <span>${escapeHtml([
            order.expectedDate ? `Delivery ${order.expectedDate}` : "",
            order.schedule || "",
            order.items?.length ? `${order.items.length} item(s)` : ""
          ].filter(Boolean).join(" / "))}</span>
        </div>
      </a>
    `;
    })
    .join("");
}

function renderCategories() {
  const items = filterItems();
  const groups = new Map();

  for (const item of items) {
    const category = itemCategory(item);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  categoryGrid.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, groupItems]) => {
      const stats = categoryStats(category, groupItems);
      const subtitle = [
        `${groupItems.length} products`,
        stats.chosen ? `${stats.chosen} selected` : "",
        stats.low ? `${stats.low} below min` : ""
      ].filter(Boolean).join(" / ");
      return `
        <button class="category-card" type="button" data-category="${escapeHtml(category)}">
          <span class="category-open">Open</span>
          <strong>${escapeHtml(category)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </button>
      `;
    })
    .join("");

  if (!categoryGrid.innerHTML) {
    categoryGrid.innerHTML = '<p class="empty-sheet">No products match this search.</p>';
  }
}

function renderProductList() {
  const items = filterItems()
    .filter((item) => !activeCategory || itemCategory(item) === activeCategory)
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedCount = items.filter((item) => selected.has(item.id)).length;

  const searchMode = hasSearchTerm();
  categoryTitle.textContent = searchMode ? "Search Results" : (activeCategory || "All Products");
  categoryMeta.textContent = `${items.length} products${selectedCount ? ` / ${selectedCount} selected` : ""}`;
  backButton.hidden = searchMode;
  productList.innerHTML = items
    .map((item) => {
      const entry = selected.get(item.id);
      const checked = Boolean(entry);
      const quantity = entry?.quantity ?? defaultQuantity(item);
      const urgency = entry?.urgency || (Number(item.quantity || 0) < Number(item.minimum || 0) ? "High" : "Medium");
      const lowStock = item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0);
      return `
        <article class="product-row${checked ? " selected" : ""}" data-item-id="${item.id}">
          <button class="product-check" type="button" aria-label="Select ${escapeHtml(item.name)}">${checked ? "&#10003;" : ""}</button>
          <div class="product-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(itemMeta(item) || itemCategory(item))}</span>
            <small>${escapeHtml(stockMeta(item))}</small>
            ${lowStock ? `<em>Below minimum: ${item.quantity ?? 0} / ${item.minimum} ${escapeHtml(itemUnit(item))}</em>` : ""}
          </div>
          <div class="product-controls">
            <label class="stock-adjust">
              Stock
              <input class="stock-input" type="number" min="0" step="0.01" value="${item.quantity ?? 0}">
              <button class="stock-save" type="button">Set</button>
            </label>
            <button class="qty-minus" type="button" aria-label="Decrease">-</button>
            <input class="qty-input" type="number" min="0" step="1" value="${quantity}">
            <button class="qty-plus" type="button" aria-label="Increase">+</button>
            <select class="unit-input" aria-label="Order unit">
              ${["box", "bag", "item", "bottle"].map((unit) => `<option value="${unit}"${unit === (entry?.unit || itemUnit(item)) ? " selected" : ""}>${unit}</option>`).join("")}
            </select>
            <select class="urgency-input" aria-label="Urgency">
              ${["Low", "Medium", "High", "Critical"].map((level) => `<option${level === urgency ? " selected" : ""}>${level}</option>`).join("")}
            </select>
          </div>
        </article>
      `;
    })
    .join("");

  if (!items.length) {
    const addButton = hasSearchTerm() && sessionPermissions.canAddInventoryItems
      ? `<a class="button" href="${escapeHtml(addItemHrefFromSearch())}">Add "${escapeHtml(searchInput.value.trim())}"</a>`
      : "";
    productList.innerHTML = `
      <div class="empty-sheet empty-sheet-action">
        <p>No products found.</p>
        ${addButton}
      </div>
    `;
  }
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
    unit: itemUnit(item)
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
      const requestDay = String(request.requestedAt || "").slice(0, 10);
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
      quantity: Math.max(1, Number(request.quantity || 1)),
      urgency: request.urgency || "Medium",
      unit: request.unit || itemUnit(item)
    });
  }

  return map;
}

function syncProductRow(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item || !selected.has(item.id)) return;
  selected.set(item.id, {
    item,
    quantity: Math.max(1, Number(row.querySelector(".qty-input").value || 1)),
    urgency: row.querySelector(".urgency-input").value,
    unit: row.querySelector(".unit-input")?.value || itemUnit(item)
  });
}

function toggleProduct(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item) return;

  if (selected.has(item.id)) {
    selected.delete(item.id);
  } else {
    selectItem(item, row.querySelector(".qty-input").value, row.querySelector(".urgency-input").value);
    const entry = selected.get(item.id);
    if (entry) entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
  }

  render();
}

async function refresh() {
  setMessage("Loading products...");
  const data = await api("/api/bootstrap");
  allItems = data.items;
  recentRequests = data.requests;
  standingOrders = data.standingOrders || [];
  notifications = data.notifications || [];
  selected = buildSelectedFromRecentRequests();
  render();
  setMessage("");
}

async function submitSelected() {
  if (!selected.size) return;

  submitButton.disabled = true;
  setMessage("Saving order...");

  try {
    const requests = [...selected.values()]
      .filter((entry) => entry?.item?.id)
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
    if (!requests.length) {
      throw new Error("No valid items were selected to save.");
    }
    const data = await api("/api/requests/batch", {
      method: "POST",
      body: JSON.stringify({ requests })
    });
    const byId = new Map(recentRequests.map((request) => [request.id, request]));
    for (const request of data.requests || []) {
      byId.set(request.id, request);
    }
    recentRequests = [...byId.values()]
      .sort((left, right) => {
        const leftTime = new Date(left.requestedAt || 0).getTime() || 0;
        const rightTime = new Date(right.requestedAt || 0).getTime() || 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return Number(right.requestId || 0) - Number(left.requestId || 0);
      })
      .slice(0, 100);
    const saved = selected.size;
    selected = buildSelectedFromRecentRequests();
    render();
    setMessage(`${saved} item(s) saved to today's order.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    updateSaveButton();
  }
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
  const data = await api("/api/stock-counts", {
    method: "POST",
    body: JSON.stringify({
      itemId,
      countedQuantity,
      notes: "Adjusted from request screen."
    })
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

    saveSession(data);
    if (data.user.mustChangePassword) {
      window.location.href = "/change-password.html";
      return;
    }
    passwordInput.value = "";
    setLoginMessage("");
    showApp();
    await refresh();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
[featureMenu, backofficeMenu].forEach((menu) => menu?.addEventListener("change", (event) => {
  if (event.target.value) window.location.href = event.target.value;
}));
refreshButton.addEventListener("click", () => refresh().catch((error) => setMessage(error.message, true)));
submitButton.addEventListener("click", () => submitSelected());

categoryGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".category-card");
  if (!card) return;
  activeCategory = card.dataset.category;
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

productList.addEventListener("click", (event) => {
  const row = event.target.closest(".product-row");
  if (!row) return;

  if (event.target.closest(".product-check")) {
    toggleProduct(row);
    return;
  }

  if (event.target.closest(".stock-save")) {
    const itemId = row.dataset.itemId;
    const input = row.querySelector(".stock-input");
    const button = event.target.closest(".stock-save");
    button.disabled = true;
    updateCurrentStock(itemId, input.value)
      .then(() => {
        render();
        setMessage("Current stock updated.");
      })
      .catch((error) => setMessage(error.message, true))
      .finally(() => {
        button.disabled = false;
      });
    return;
  }

  if (event.target.closest(".qty-minus") || event.target.closest(".qty-plus")) {
    const input = row.querySelector(".qty-input");
    const delta = event.target.closest(".qty-plus") ? 1 : -1;
    input.value = Math.max(0, Number(input.value || 0) + delta);
    if (Number(input.value) > 0) {
      const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
      if (item && !selected.has(item.id)) {
        selectItem(item, input.value, row.querySelector(".urgency-input").value);
        const entry = selected.get(item.id);
        if (entry) entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
      }
    }
    syncProductRow(row);
    render();
  }
});

productList.addEventListener("change", (event) => {
  const row = event.target.closest(".product-row");
  if (!row) return;

  if (event.target.matches(".qty-input") && Number(event.target.value || 0) > 0) {
    const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
    if (item && !selected.has(item.id)) {
      selectItem(item, event.target.value, row.querySelector(".urgency-input").value);
      const entry = selected.get(item.id);
      if (entry) entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
    }
  }

  syncProductRow(row);
  render();
});

selectedChips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-id]");
  if (!chip) return;
  selected.delete(chip.dataset.removeId);
  render();
});

dailyOrderList.addEventListener("click", (event) => {
  const deliverButton = event.target.closest(".deliver-order-button");
  if (deliverButton) {
    deliverButton.disabled = true;
    deliverDailyOrder(deliverButton.dataset.deliverId).catch((error) => {
      setMessage(error.message, true);
      deliverButton.disabled = false;
    });
    return;
  }

  const button = event.target.closest(".delete-order-button");
  if (!button) return;

  button.disabled = true;
  deleteDailyOrder(button.dataset.requestId).catch((error) => {
    setMessage(error.message, true);
    button.disabled = false;
  });
});

notificationList?.addEventListener("click", (event) => {
  const button = event.target.closest(".mark-notification-read");
  if (!button) return;
  const row = button.closest("[data-notification-id]");
  if (!row?.dataset.notificationId) return;
  button.disabled = true;
  markNotificationsRead([row.dataset.notificationId]).catch((error) => {
    setMessage(error.message, true);
    button.disabled = false;
  });
});

readAllNotificationsButton?.addEventListener("click", () => {
  readAllNotificationsButton.disabled = true;
  markNotificationsRead().catch((error) => {
    setMessage(error.message, true);
  }).finally(() => {
    readAllNotificationsButton.disabled = false;
  });
});

[areaFilter, locationFilter, searchInput].forEach((control) => {
  control.addEventListener("input", () => {
    if (!productView.hidden && !hasSearchTerm()) {
      activeCategory = "";
      productView.hidden = true;
      categoryView.hidden = false;
    }
    render();
  });
});

if (sessionToken && sessionUser) {
  refreshSession()
    .then((ok) => {
      if (ok) return refresh();
      return null;
    })
    .catch((error) => setMessage(error.message, true));
} else {
  showLogin();
  updateSaveButton();
}








