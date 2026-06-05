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
const message = document.querySelector("#message");

let allItems = [];
let recentRequests = [];
let activeCategory = "";
let selected = new Map();
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";

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

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = sessionUser;
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

function itemCategory(item) {
  return item.category || item.inventorySubgroup || item.storageLocation || "Unsorted";
}

function itemMeta(item) {
  return [item.inventoryArea, item.storageLocation, item.shelfCode].filter(Boolean).join(" / ");
}

function itemUnit(item) {
  return item.unit || "item";
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
      item.inventorySubgroup,
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
        <small>${entry.quantity} ${escapeHtml(itemUnit(entry.item))}</small>
      </button>
    `)
    .join("");
}

function itemNameFromRequest(request) {
  return allItems.find((item) => item.id === request.itemId)?.name || "Requested item";
}

function renderDailyOrder() {
  const activeRequests = recentRequests.filter((request) => !request.received && request.status !== "Fulfilled");
  dailyOrderCount.textContent = `${activeRequests.length} active`;
  dailyOrderList.innerHTML = activeRequests
    .slice(0, 100)
    .map((request) => `
      <article class="daily-order-row">
        <div>
          <strong>${escapeHtml(itemNameFromRequest(request))}</strong>
          <span>${escapeHtml([request.quantity, request.inventorySubgroup, request.inventoryArea, request.storageLocation].filter(Boolean).join(" / "))}</span>
        </div>
        <div class="daily-order-actions">
          <button class="deliver-order-button" type="button" data-deliver-id="${request.id}">Delivered</button>
          <button class="delete-order-button" type="button" data-request-id="${request.id}">Delete</button>
        </div>
      </article>
    `)
    .join("");

  if (!dailyOrderList.innerHTML) {
    dailyOrderList.innerHTML = '<p class="empty-sheet">No active orders yet.</p>';
  }
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

  categoryTitle.textContent = activeCategory || "All Products";
  categoryMeta.textContent = `${items.length} products${selectedCount ? ` / ${selectedCount} selected` : ""}`;
  productList.innerHTML = items
    .map((item) => {
      const entry = selected.get(item.id);
      const checked = Boolean(entry);
      const quantity = entry?.quantity ?? defaultQuantity(item);
      const urgency = entry?.urgency || (Number(item.quantity || 0) < Number(item.minimum || 0) ? "High" : "Medium");
      const lowStock = item.minimum !== null && Number(item.quantity || 0) < Number(item.minimum || 0);
      return `
        <article class="product-row${checked ? " selected" : ""}" data-item-id="${item.id}">
          <button class="product-check" type="button" aria-label="Select ${escapeHtml(item.name)}">${checked ? "✓" : ""}</button>
          <div class="product-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(itemMeta(item) || itemCategory(item))}</span>
            ${lowStock ? `<em>Below minimum: ${item.quantity ?? 0} / ${item.minimum} ${escapeHtml(itemUnit(item))}</em>` : ""}
          </div>
          <div class="product-controls">
            <button class="qty-minus" type="button" aria-label="Decrease">-</button>
            <input class="qty-input" type="number" min="0" step="1" value="${quantity}">
            <button class="qty-plus" type="button" aria-label="Increase">+</button>
            <span>${escapeHtml(itemUnit(item))}</span>
            <select class="urgency-input" aria-label="Urgency">
              ${["Low", "Medium", "High", "Critical"].map((level) => `<option${level === urgency ? " selected" : ""}>${level}</option>`).join("")}
            </select>
          </div>
        </article>
      `;
    })
    .join("");

  if (!items.length) {
    productList.innerHTML = '<p class="empty-sheet">No products in this category.</p>';
  }
}

function render() {
  if (productView.hidden) renderCategories();
  else renderProductList();
  renderSelectedChips();
  renderDailyOrder();
  updateSaveButton();
}

function selectItem(item, quantity = defaultQuantity(item), urgency = "Medium") {
  selected.set(item.id, {
    item,
    quantity: Math.max(1, Number(quantity || 1)),
    urgency
  });
}

function syncProductRow(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item || !selected.has(item.id)) return;
  selected.set(item.id, {
    item,
    quantity: Math.max(1, Number(row.querySelector(".qty-input").value || 1)),
    urgency: row.querySelector(".urgency-input").value
  });
}

function toggleProduct(row) {
  const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
  if (!item) return;

  if (selected.has(item.id)) {
    selected.delete(item.id);
  } else {
    selectItem(item, row.querySelector(".qty-input").value, row.querySelector(".urgency-input").value);
  }

  render();
}

async function refresh() {
  setMessage("Loading products...");
  const data = await api("/api/bootstrap");
  allItems = data.items;
  recentRequests = data.requests;
  selected = new Map(
    [...selected.entries()].filter(([itemId]) => allItems.some((item) => item.id === itemId))
  );
  render();
  setMessage("");
}

async function submitSelected() {
  if (!selected.size) return;

  submitButton.disabled = true;
  setMessage("Saving order...");

  try {
    const requests = [...selected.values()].map((entry) => ({
      itemId: entry.item.id,
      quantityNeeded: entry.quantity,
      urgencyLevel: entry.urgency,
      storageLocation: entry.item.storageLocation || "",
      inventoryArea: entry.item.inventoryArea || "",
      inventorySubgroup: entry.item.inventorySubgroup || "",
      shelfCode: entry.item.shelfCode || "",
      requestedBy: sessionUser || "Kitchen",
      notes: ""
    }));
    const data = await api("/api/requests/batch", {
      method: "POST",
      body: JSON.stringify({ requests })
    });
    recentRequests = [...data.requests, ...recentRequests].slice(0, 100);
    const saved = selected.size;
    selected.clear();
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
  render();
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

    sessionToken = data.token;
    sessionUser = data.user.name;
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
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

  if (event.target.closest(".qty-minus") || event.target.closest(".qty-plus")) {
    const input = row.querySelector(".qty-input");
    const delta = event.target.closest(".qty-plus") ? 1 : -1;
    input.value = Math.max(0, Number(input.value || 0) + delta);
    if (Number(input.value) > 0) {
      const item = allItems.find((candidate) => candidate.id === row.dataset.itemId);
      if (item && !selected.has(item.id)) selectItem(item, input.value, row.querySelector(".urgency-input").value);
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
    if (item && !selected.has(item.id)) selectItem(item, event.target.value, row.querySelector(".urgency-input").value);
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

[areaFilter, locationFilter, searchInput].forEach((control) => {
  control.addEventListener("input", () => {
    if (!productView.hidden) {
      activeCategory = "";
      productView.hidden = true;
      categoryView.hidden = false;
    }
    render();
  });
});

if (sessionToken && sessionUser) {
  showApp();
  refresh().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
  updateSaveButton();
}
