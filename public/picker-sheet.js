const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const refreshButton = document.querySelector("#refreshButton");
const message = document.querySelector("#message");
const pickerGroups = document.querySelector("#pickerGroups");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let internalOrders = [];

function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw.split(/\s+/).map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
  if (currentUser) {
    currentUser.textContent = "";
    currentUser.hidden = true;
  }
  window.refreshKitchenMenus?.();
}

function showLogin() {
  loginScreen.hidden = false;
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
  localStorage.removeItem("kitchenStockRole");
  localStorage.removeItem("kitchenStockPermissions");
}

async function api(path, options = {}) {
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

function groupByRequester(orders) {
  const map = new Map();
  for (const order of orders) {
    const key = order.requestedBy || "Team";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(order);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function render() {
  const groups = groupByRequester(internalOrders);
  if (!groups.length) {
    pickerGroups.innerHTML = '<p class="empty-sheet">No internal requests waiting for the picker.</p>';
    return;
  }
  pickerGroups.innerHTML = groups.map(([requester, orders]) => `
    <section class="panel picker-requester-group">
      <div class="daily-order-heading">
        <h2>${escapeHtml(formatUserDisplay(requester))}</h2>
        <span>${escapeHtml(`${orders.length} order(s)`)}</span>
      </div>
      <div class="picker-batch-list">
        ${orders.map((order) => `
          <article class="picker-batch-card" data-batch-id="${escapeHtml(order.id)}">
            <div class="picker-batch-header">
              <div>
                <strong>${escapeHtml(`${order.lines.length} item(s)`)} </strong>
                <span>${escapeHtml(order.status)} / ${escapeHtml(order.requestedAt ? new Date(order.requestedAt).toLocaleString() : "")}</span>
              </div>
              <button class="icon-button save-picker-batch" type="button">Save picked batch</button>
            </div>
            <div class="picker-line-list">
              ${order.lines.map((line) => `
                <div class="picker-line-row" data-line-id="${escapeHtml(line.id)}">
                  <div class="picker-line-main">
                    <strong>${escapeHtml(line.itemName)}</strong>
                    <span>${escapeHtml([line.category, line.inventoryArea, line.storageLocation, line.shelfCode].filter(Boolean).join(" / "))}</span>
                    <small>Requested ${escapeHtml(line.requestedItemQuantity)} item(s) / stock about ${escapeHtml(line.currentStockItems)} item(s)</small>
                  </div>
                  <label>
                    Pick now
                    <input class="picker-qty-input" type="number" min="0" step="1" max="${escapeHtml(line.requestedItemQuantity)}" value="${escapeHtml(line.pickedItemQuantity || line.requestedItemQuantity)}">
                  </label>
                  <div class="picker-line-shortage">Shortage: <strong>${escapeHtml(Math.max(0, Number(line.requestedItemQuantity || 0) - Number(line.pickedItemQuantity || line.requestedItemQuantity)))} item(s)</strong></div>
                </div>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}

async function loadData() {
  setMessage("Loading picker board...");
  const data = await api("/api/internal-orders");
  internalOrders = data.internalOrders || [];
  render();
  setMessage("");
}

async function saveBatch(card) {
  const batchId = card.dataset.batchId;
  const lines = [...card.querySelectorAll("[data-line-id]")].map((row) => ({
    lineId: row.dataset.lineId,
    pickedItemQuantity: Number(row.querySelector(".picker-qty-input")?.value || 0)
  }));
  setMessage("Saving picked items...");
  try {
    await api(`/api/internal-orders/${batchId}/pick`, {
      method: "PATCH",
      body: JSON.stringify({ lines })
    });
    await loadData();
    setMessage("Picker batch saved. Stock and shortage orders updated.");
  } catch (error) {
    setMessage(error.message, true);
  }
}

pickerGroups.addEventListener("input", (event) => {
  const input = event.target.closest(".picker-qty-input");
  if (!input) return;
  const row = input.closest("[data-line-id]");
  if (!row) return;
  const max = Number(input.max || 0);
  const value = Math.max(0, Math.min(max, Number(input.value || 0)));
  input.value = value;
  const shortage = Math.max(0, max - value);
  const label = row.querySelector(".picker-line-shortage strong");
  if (label) label.textContent = `${shortage} item(s)`;
});

pickerGroups.addEventListener("click", (event) => {
  const button = event.target.closest(".save-picker-batch");
  if (!button) return;
  const card = button.closest("[data-batch-id]");
  if (!card) return;
  saveBatch(card);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginMessage("Logging in...");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not log in.");
    sessionToken = data.token;
    sessionUser = data.user.name;
    sessionPermissions = data.user.permissions || {};
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockRole", data.user.role || "user");
    localStorage.setItem("kitchenStockPermissions", JSON.stringify(sessionPermissions));
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    if (!sessionPermissions.canPickInternalOrders) throw new Error("This user is not allowed to pick internal requests.");
    if (data.user.mustChangePassword) {
      window.location.href = "/change-password.html";
      return;
    }
    showApp();
    await loadData();
    setLoginMessage("");
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
refreshButton.addEventListener("click", () => loadData().catch((error) => setMessage(error.message, true)));

if (sessionToken && sessionUser) {
  showApp();
  loadData().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
