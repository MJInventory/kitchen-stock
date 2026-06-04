const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const itemSelect = document.querySelector("#itemSelect");
const itemInfo = document.querySelector("#itemInfo");
const countForm = document.querySelector("#countForm");
const countedQuantity = document.querySelector("#countedQuantity");
const countNotes = document.querySelector("#countNotes");
const countMessage = document.querySelector("#countMessage");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];

function message(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("error", isError);
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

function filteredItems() {
  return items.filter((item) => {
    const areaMatches = !areaFilter.value || item.inventoryArea === areaFilter.value;
    const locationMatches = !locationFilter.value || item.storageLocation === locationFilter.value;
    return areaMatches && locationMatches;
  });
}

function selectedItem() {
  return items.find((item) => item.id === itemSelect.value);
}

function renderItems() {
  const filtered = filteredItems();
  itemSelect.innerHTML = filtered
    .map((item) => `<option value="${item.id}">${item.name} (${item.quantity ?? 0} ${item.unit || ""})</option>`)
    .join("");
  if (!filtered.length) itemSelect.innerHTML = '<option value="">No matching items</option>';
  renderItemInfo();
}

function renderItemInfo() {
  const item = selectedItem();
  if (!item) {
    itemInfo.textContent = "";
    return;
  }
  itemInfo.textContent = `${item.inventoryArea || ""} / ${item.storageLocation || ""} - current ${item.quantity ?? 0} ${item.unit || ""}, minimum ${item.minimum ?? 0}`;
}

async function loadItems() {
  message(countMessage, "Loading...");
  const data = await api("/api/items");
  items = data.items;
  renderItems();
  message(countMessage, "");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(loginMessage, "Logging in...");
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
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    passwordInput.value = "";
    showApp();
    await loadItems();
  } catch (error) {
    message(loginMessage, error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
areaFilter.addEventListener("change", renderItems);
locationFilter.addEventListener("change", renderItems);
itemSelect.addEventListener("change", renderItemInfo);

countForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(countMessage, "Saving...");
  try {
    const data = await api("/api/stock-counts", {
      method: "POST",
      body: JSON.stringify({
        itemId: itemSelect.value,
        countedQuantity: countedQuantity.value,
        notes: countNotes.value
      })
    });
    items = items.map((item) => (item.id === data.item.id ? { ...item, quantity: data.item.quantity } : item));
    countedQuantity.value = "";
    countNotes.value = "";
    renderItems();
    message(countMessage, "Stock count saved.");
  } catch (error) {
    message(countMessage, error.message, true);
  }
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => message(countMessage, error.message, true));
} else {
  showLogin();
}
