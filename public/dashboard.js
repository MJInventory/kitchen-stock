const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const featureMenu = document.querySelector("#featureMenu");
const dailyAreaFilter = document.querySelector("#dailyAreaFilter");
const dailyOrderCount = document.querySelector("#dailyOrderCount");
const dailyOrderList = document.querySelector("#dailyOrderList");
const openOrderCount = document.querySelector("#openOrderCount");
const openOrderList = document.querySelector("#openOrderList");
const standingOrderCount = document.querySelector("#standingOrderCount");
const standingOrderList = document.querySelector("#standingOrderList");
const message = document.querySelector("#message");

let allItems = [];
let recentRequests = [];
let standingOrders = [];
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionRole = localStorage.getItem("kitchenStockRole") || "user";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
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
}

function showApp() {
  loginScreen.hidden = true;
  const roleLabel = sessionRole === "god" ? "God" : sessionRole === "admin" ? "Admin" : sessionRole === "power-user" ? "Power User" : "User";
  currentUser.textContent = sessionUser ? `${sessionUser} / ${roleLabel}` : "";
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
  const areas = [...new Set(
    recentRequests
      .map((request) => requestArea(request))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const selected = dailyAreaFilter.value;
  dailyAreaFilter.innerHTML = [
    '<option value="">All Areas</option>',
    ...areas.map((area) => `<option value="${escapeHtml(area)}"${area === selected ? " selected" : ""}>${escapeHtml(area)}</option>`)
  ].join("");
  dailyAreaFilter.value = areas.includes(selected) ? selected : "";
}

function renderDailyOrder() {
  const selectedDay = todayLocal();
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !dailyAreaFilter.value || requestArea(request) === dailyAreaFilter.value)
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
                <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Delivered</button>
                ${sessionPermissions.canDeleteAnyOrder || request.requestedBy === sessionUser ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Delete</button>` : ""}
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
  const openRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .filter((request) => !dailyAreaFilter.value || requestArea(request) === dailyAreaFilter.value)
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
                  <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Delivered</button>
                  ${sessionPermissions.canDeleteAnyOrder || request.requestedBy === sessionUser ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Delete</button>` : ""}
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
      const itemNames = (Array.isArray(order.items) ? order.items : [])
        .map((item) => item.itemName || "")
        .filter(Boolean);
      return `
      <a class="daily-order-row daily-order-link" href="/standing-orders.html?orderId=${encodeURIComponent(order.id)}">
        <div>
          <strong>${escapeHtml(order.supplierName || order.name || "Standing Order")}</strong>
          <span>${escapeHtml([
            order.expectedDate ? `Delivery ${order.expectedDate}` : "",
            order.schedule || "",
            order.items?.length ? `${order.items.length} item(s)` : ""
          ].filter(Boolean).join(" / "))}</span>
          ${itemNames.length ? `<small>${escapeHtml(itemNames.join(", "))}</small>` : ""}
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
  populateDailyAreaFilter();
  renderDailyOrder();
  renderOpenOrders();
  renderStandingOrders();
  setMessage("");
}

async function deleteDailyOrder(requestId) {
  await api(`/api/requests/${requestId}`, { method: "DELETE" });
  recentRequests = recentRequests.filter((request) => request.id !== requestId);
  renderDailyOrder();
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
dailyAreaFilter.addEventListener("change", renderDailyOrder);
featureMenu?.addEventListener("change", (event) => {
  if (event.target.value) window.location.href = event.target.value;
});
dailyOrderList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".delete-order-button");
  if (deleteButton) {
    deleteDailyOrder(deleteButton.dataset.requestId).catch((error) => setMessage(error.message, true));
    return;
  }
  const deliverButton = event.target.closest(".deliver-order-button");
  if (deliverButton) {
    deliverDailyOrder(deliverButton.dataset.deliverId).catch((error) => setMessage(error.message, true));
  }
});

if (sessionToken && sessionUser) {
  showApp();
  refresh().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
