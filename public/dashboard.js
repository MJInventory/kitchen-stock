const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const dailyOrderCount = document.querySelector("#dailyOrderCount");
const dailyOrderList = document.querySelector("#dailyOrderList");
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

function requestSortValue(request) {
  const item = allItems.find((candidate) => candidate.id === request.itemId);
  return {
    supplier: item?.supplierName || request.supplierName || "",
    category: request.inventorySubgroup || item?.inventorySubgroup || item?.category || "",
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

function renderDailyOrder() {
  const activeRequests = recentRequests
    .filter((request) => !request.received && request.status !== "Fulfilled")
    .sort(logicalRequestCompare);
  dailyOrderCount.textContent = `${activeRequests.length} active`;
  dailyOrderList.innerHTML = activeRequests
    .slice(0, 100)
    .map((request) => `
      <article class="daily-order-row">
        <div>
          <strong>${escapeHtml(itemNameFromRequest(request))}</strong>
          <span>${escapeHtml([
            request.quantity,
            request.inventorySubgroup,
            request.inventoryArea,
            request.storageLocation
          ].filter(Boolean).join(" / "))}</span>
        </div>
        <div class="daily-order-actions">
          <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Delivered</button>
          ${sessionPermissions.canDeleteAnyOrder || request.requestedBy === sessionUser ? `<button class="delete-order-button" type="button" data-request-id="${request.id}">Delete</button>` : ""}
        </div>
      </article>
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
    .map((order) => `
      <article class="daily-order-row">
        <div>
          <strong>${escapeHtml(order.supplierName || order.name || "Standing Order")}</strong>
          <span>${escapeHtml([
            order.expectedDate ? `Delivery ${order.expectedDate}` : "",
            order.schedule || "",
            order.items?.length ? `${order.items.length} item(s)` : ""
          ].filter(Boolean).join(" / "))}</span>
        </div>
      </article>
    `)
    .join("");
}

async function refresh() {
  setMessage("Loading today's orders...");
  const data = await api("/api/bootstrap");
  allItems = data.items || [];
  recentRequests = data.requests || [];
  standingOrders = data.standingOrders || [];
  renderDailyOrder();
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
document.querySelector("#featureMenu")?.addEventListener("change", (event) => {
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
