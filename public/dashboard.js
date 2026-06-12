const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const featureMenu = document.querySelector("#featureMenu");
const backofficeMenu = document.querySelector("#backofficeMenu");
const dailyAreaFilter = document.querySelector("#dailyAreaFilter");
const dailyUserFilter = document.querySelector("#dailyUserFilter");
const dailyOrderCount = document.querySelector("#dailyOrderCount");
const dailyOrderList = document.querySelector("#dailyOrderList");
const openOrderCount = document.querySelector("#openOrderCount");
const openOrderList = document.querySelector("#openOrderList");
const standingOrderCount = document.querySelector("#standingOrderCount");
const standingOrderList = document.querySelector("#standingOrderList");
const notificationCount = document.querySelector("#notificationCount");
const notificationList = document.querySelector("#notificationList");
const readAllNotificationsButton = document.querySelector("#readAllNotificationsButton");
const enablePushButton = document.querySelector("#enablePushButton");
const message = document.querySelector("#message");

let allItems = [];
let recentRequests = [];
let standingOrders = [];
let notifications = [];
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionRole = localStorage.getItem("kitchenStockRole") || "user";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  if (featureMenu) featureMenu.value = "/";
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

function itemNameFromRequest(request) {
  return allItems.find((item) => item.id === request.itemId)?.name || "Requested item";
}

function itemForRequest(request) {
  return allItems.find((item) => item.id === request.itemId) || null;
}

function requestArea(request) {
  return request.inventoryArea || itemForRequest(request)?.inventoryArea || "";
}

function requestCategory(request) {
  return itemForRequest(request)?.category || request.category || "";
}

function requestLocation(request) {
  return request.storageLocation || itemForRequest(request)?.storageLocation || "";
}

function requestDay(request) {
  const stamp = String(request.requestedAt || "").trim();
  return stamp ? stamp.slice(0, 10) : "";
}

function requestUser(request) {
  return String(request.requestedBy || "").trim();
}

function selectedDailyArea() {
  return String(dailyAreaFilter?.value || "").trim();
}

function selectedDailyUser() {
  return String(dailyUserFilter?.value || "").trim();
}

function isStandingOrderRequest(request) {
  return Boolean(String(request?.standingRunId || "").trim())
    || String(request?.requestedBy || "").toLowerCase().includes("standing order")
    || String(request?.notes || "").toLowerCase().includes("standing order");
}

function requestSortValue(request) {
  const item = itemForRequest(request);
  return {
    supplier: item?.supplierName || request.supplierName || "",
    category: item?.category || requestCategory(request),
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
    const category = requestCategory(request) || "Uncategorized";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(request);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function populateDailyAreaFilter() {
  if (!dailyAreaFilter) return;
  const areas = [...new Set(
    recentRequests
      .map((request) => requestArea(request))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const selected = selectedDailyArea();
  dailyAreaFilter.innerHTML = [
    '<option value="">All Areas</option>',
    ...areas.map((area) => `<option value="${escapeHtml(area)}"${area === selected ? " selected" : ""}>${escapeHtml(area)}</option>`)
  ].join("");
  dailyAreaFilter.value = areas.includes(selected) ? selected : "";
}

function populateDailyUserFilter() {
  if (!dailyUserFilter) return;
  const users = [...new Set(
    recentRequests
      .map((request) => requestUser(request))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const selected = selectedDailyUser();
  dailyUserFilter.innerHTML = [
    '<option value="">All Users</option>',
    `<option value="__mine__"${selected === "__mine__" ? " selected" : ""}>My Orders</option>`,
    ...users.map((user) => `<option value="${escapeHtml(user)}"${user === selected ? " selected" : ""}>${escapeHtml(formatUserDisplay(user))}</option>`)
  ].join("");
  dailyUserFilter.value = selected === "__mine__" || users.includes(selected) ? selected : "";
}

function requesterMatches(request) {
  const selectedUser = selectedDailyUser();
  if (!selectedUser) return true;
  if (selectedUser === "__mine__") return sameUser(requestUser(request), sessionUser);
  return sameUser(requestUser(request), selectedUser);
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

function renderPushStatus(detail = {}) {
  if (!enablePushButton) return;
  const supported = Boolean(detail.supported);
  const enabled = Boolean(detail.enabled);
  const subscribed = Boolean(detail.subscribed);
  const permission = detail.permission || "default";
  const shouldShow = supported && enabled && (!subscribed || permission !== "granted");
  enablePushButton.hidden = !shouldShow;
  enablePushButton.disabled = permission === "denied";
  if (permission === "denied") {
    enablePushButton.textContent = "Notifications blocked in browser";
  } else if (subscribed) {
    enablePushButton.textContent = "Phone notifications enabled";
  } else {
    enablePushButton.textContent = "Enable phone notifications";
  }
}

function renderDailyOrder() {
  const selectedDay = todayLocal();
  const selectedArea = selectedDailyArea();
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !isStandingOrderRequest(request))
    .filter((request) => !selectedArea || requestArea(request) === selectedArea)
    .filter(requesterMatches)
    .filter((request) => requestDay(request) === selectedDay)
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
                  requestCategory(request),
                  requestArea(request),
                  requestLocation(request)
                ].filter(Boolean).join(" / "))}</span>
              </div>
              <div class="daily-order-actions">
                <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Received</button>
                ${sessionPermissions.canDeleteAnyOrder || sameUser(request.requestedBy, sessionUser) ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Remove</button>` : ""}
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

function renderOpenOrders() {
  const selectedDay = todayLocal();
  const selectedArea = selectedDailyArea();
  const openRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !isStandingOrderRequest(request))
    .filter((request) => !selectedArea || requestArea(request) === selectedArea)
    .filter(requesterMatches)
    .filter((request) => {
      const day = requestDay(request);
      return !day || day < selectedDay;
    })
    .sort(logicalRequestCompare);

  openOrderCount.textContent = `${openRequests.length} open`;
  const grouped = groupRequestsByCategory(openRequests.slice(0, 100));
  openOrderList.innerHTML = grouped
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
                    requestCategory(request),
                    requestArea(request),
                    requestLocation(request),
                    requestDay(request) ? `Requested ${requestDay(request)}` : ""
                  ].filter(Boolean).join(" / "))}</span>
                </div>
                <div class="daily-order-actions">
                  <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Received</button>
                  ${sessionPermissions.canDeleteAnyOrder || sameUser(request.requestedBy, sessionUser) ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Remove</button>` : ""}
                </div>
              </article>
            `).join("")}
        </div>
      </section>
    `)
    .join("");

  if (!openOrderList.innerHTML) {
    openOrderList.innerHTML = '<p class="empty-sheet">No older open orders.</p>';
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

async function refresh() {
  setMessage("Loading today's orders...");
  const data = await api("/api/bootstrap");
  allItems = data.items || [];
  recentRequests = data.requests || [];
  standingOrders = data.standingOrders || [];
  notifications = data.notifications || [];
  populateDailyAreaFilter();
  populateDailyUserFilter();
  renderDailyOrder();
  renderOpenOrders();
  renderStandingOrders();
  renderNotifications();
  setMessage("");
}

async function markNotificationsRead(ids = []) {
  const data = await api("/api/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  notifications = data.notifications || [];
  renderNotifications();
}

async function deleteDailyOrder(requestId) {
  await api(`/api/requests/${requestId}`, { method: "DELETE" });
  recentRequests = recentRequests.filter((request) => request.id !== requestId);
  renderDailyOrder();
  renderOpenOrders();
  setMessage("Item removed from today's order.");
}

async function deliverDailyOrder(requestId) {
  await api(`/api/requests/${requestId}/deliver`, { method: "POST" });
  await refresh();
  setMessage("Item delivered, added to inventory, and closed.");
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
refreshButton.addEventListener("click", () => refresh().catch((error) => setMessage(error.message, true)));
dailyAreaFilter?.addEventListener("change", () => {
  renderDailyOrder();
  renderOpenOrders();
});
dailyUserFilter?.addEventListener("change", () => {
  renderDailyOrder();
  renderOpenOrders();
});
[featureMenu, backofficeMenu].forEach((menu) => menu?.addEventListener("change", (event) => {
  if (event.target.value) window.location.href = event.target.value;
}));
function handleOrderListClick(event) {
  const deleteButton = event.target.closest(".delete-order-button");
  if (deleteButton) {
    if (!window.confirm("Remove this item from the order list?")) return true;
    deleteDailyOrder(deleteButton.dataset.requestId).catch((error) => setMessage(error.message, true));
    return true;
  }
  const deliverButton = event.target.closest(".deliver-order-button");
  if (deliverButton) {
    if (!window.confirm("Mark this item as received and add it to inventory?")) return true;
    deliverDailyOrder(deliverButton.dataset.deliverId).catch((error) => setMessage(error.message, true));
    return true;
  }
  return false;
}

dailyOrderList.addEventListener("click", handleOrderListClick);
openOrderList.addEventListener("click", handleOrderListClick);

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

enablePushButton?.addEventListener("click", () => {
  enablePushButton.disabled = true;
  Promise.resolve(window.enableKitchenPush?.())
    .catch((error) => setMessage(error.message || "Could not enable phone notifications.", true))
    .finally(() => {
      window.setTimeout(() => {
        enablePushButton.disabled = false;
      }, 600);
    });
});

window.addEventListener("kitchen-push-status", (event) => {
  renderPushStatus(event.detail || {});
});

if (sessionToken && sessionUser) {
  showApp();
  renderPushStatus(window.kitchenPushStatus || {});
  refresh().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
