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
const message = document.querySelector("#message");
const catalogCount = document.querySelector("#catalogCount");
const catalogList = document.querySelector("#catalogList");
const internalCount = document.querySelector("#internalCount");
const internalOrderList = document.querySelector("#internalOrderList");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let allItems = [];
let internalOrders = [];
let selected = new Map();

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
  if (featureMenu) featureMenu.value = "/internal-orders.html";
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

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function itemMeta(item) {
  return [item.inventoryArea, item.storageLocation, item.shelfCode].filter(Boolean).join(" / ");
}

function itemStockItems(item) {
  return Math.floor((Number(item.quantity || 0) || 0) * 12);
}

function populateFilters() {
  const areas = [...new Set(allItems.map((item) => item.inventoryArea).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const locations = [...new Set(allItems.map((item) => item.storageLocation).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  areaFilter.innerHTML = ['<option value="">All Areas</option>', ...areas.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
  locationFilter.innerHTML = ['<option value="">All Locations</option>', ...locations.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join("");
}

function filterItems() {
  const term = normalize(searchInput.value);
  const area = String(areaFilter.value || "").trim();
  const location = String(locationFilter.value || "").trim();
  return allItems
    .filter((item) => !area || item.inventoryArea === area)
    .filter((item) => !location || item.storageLocation === location)
    .filter((item) => {
      if (!term) return true;
      return normalize([item.name, item.category, item.inventoryArea, item.storageLocation, item.shelfCode].join(" ")).includes(term);
    })
    .sort((a, b) => {
      const category = String(a.category || "").localeCompare(String(b.category || ""));
      if (category) return category;
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
    });
}

function updateSaveButton() {
  const total = [...selected.values()].reduce((sum, entry) => sum + Number(entry.quantityItems || 0), 0);
  submitButton.textContent = total ? `${total} item(s) ready` : "0 Saved";
  submitButton.disabled = selected.size === 0;
}

function renderCatalog() {
  const items = filterItems();
  catalogCount.textContent = `${items.length} items`;
  catalogList.innerHTML = items.map((item) => {
    const entry = selected.get(item.id);
    const chosen = Boolean(entry);
    const qty = entry?.quantityItems ?? 1;
    return `
      <article class="product-row${chosen ? " selected" : ""}" data-item-id="${escapeHtml(item.id)}">
        <button class="product-check" type="button" aria-label="Select ${escapeHtml(item.name)}">${chosen ? "&#10003;" : ""}</button>
        <div class="product-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(itemMeta(item) || item.category || "")}</span>
          <small>Current stock about ${escapeHtml(itemStockItems(item))} item(s) / ${escapeHtml(item.quantity ?? 0)} ${escapeHtml(item.unit || "box")}</small>
        </div>
        <div class="product-controls internal-order-controls">
          <label class="stock-adjust">
            Need
            <input class="qty-input" type="number" min="1" step="1" value="${escapeHtml(qty)}">
          </label>
          <span class="micro-note">items</span>
        </div>
      </article>
    `;
  }).join("");
  if (!catalogList.innerHTML) {
    catalogList.innerHTML = '<p class="empty-sheet">No inventory items match this search.</p>';
  }
}

function renderInternalOrders() {
  internalCount.textContent = `${internalOrders.length} open`;
  if (!internalOrders.length) {
    internalOrderList.innerHTML = '<p class="empty-sheet">No internal requests open.</p>';
    return;
  }
  internalOrderList.innerHTML = internalOrders.map((order) => `
    <article class="daily-order-row internal-order-row">
      <div>
        <strong>${escapeHtml(formatUserDisplay(order.requestedBy))}</strong>
        <span>${escapeHtml(`${order.lines.length} item(s) / ${order.status}`)}</span>
        <small>${escapeHtml(order.lines.map((line) => `${line.itemName} (${line.requestedItemQuantity})`).join(", "))}</small>
      </div>
    </article>
  `).join("");
}

function render() {
  renderCatalog();
  renderInternalOrders();
  updateSaveButton();
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
  populateFilters();
  render();
  setMessage("");
}

async function submitInternalOrder() {
  if (!selected.size) return;
  submitButton.disabled = true;
  setMessage("Sending internal request...");
  try {
    await api("/api/internal-orders", {
      method: "POST",
      body: JSON.stringify({
        lines: [...selected.values()].map((entry) => ({
          itemId: entry.item.id,
          quantityItems: entry.quantityItems
        }))
      })
    });
    selected = new Map();
    await loadData();
    setMessage("Internal request sent to the picker.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    updateSaveButton();
  }
}

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
    if (!sessionPermissions.canPlaceInternalOrders) throw new Error("This user cannot create internal requests.");
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
submitButton.addEventListener("click", () => submitInternalOrder().catch((error) => setMessage(error.message, true)));
searchInput.addEventListener("input", renderCatalog);
areaFilter.addEventListener("change", renderCatalog);
locationFilter.addEventListener("change", renderCatalog);

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
  updateSaveButton();
});

if (sessionToken && sessionUser) {
  showApp();
  loadData().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
