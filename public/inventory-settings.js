const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const setupMessage = document.querySelector("#setupMessage");
const itemSettingsList = document.querySelector("#itemSettingsList");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function setSetupMessage(text, isError = false) {
  setupMessage.textContent = text;
  setupMessage.classList.toggle("error", isError);
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

function renderItems() {
  const area = areaFilter.value;
  const location = locationFilter.value;
  const filtered = items.filter((item) => {
    const areaMatches = !area || item.inventoryArea === area;
    const locationMatches = !location || item.storageLocation === location;
    return areaMatches && locationMatches;
  });

  itemSettingsList.innerHTML = filtered
    .map((item) => `
      <article class="settings-item" data-item-id="${item.id}">
        <div>
          <strong>${item.name}</strong>
          <span>${[item.inventoryArea, item.storageLocation].filter(Boolean).join(" / ")}</span>
          <span>${[item.inventorySubgroup, item.shelfCode ? `Shelf ${item.shelfCode}` : ""].filter(Boolean).join(" / ")}</span>
          <span>Current: ${item.quantity ?? ""} ${item.unit || ""}</span>
        </div>
        <label>
          Subgroup
          <input class="subgroup-input" type="text" value="${item.inventorySubgroup || ""}" placeholder="e.g. Produce">
        </label>
        <label>
          Shelf code
          <input class="shelf-input" type="text" value="${item.shelfCode || ""}" placeholder="e.g. C-02">
        </label>
        <label>
          Minimum stock
          <input class="minimum-input" type="number" min="0" step="1" value="${item.minimum ?? 0}">
        </label>
        <label>
          Unit
          <select class="unit-select">
            ${["box", "bag", "item", "bottle"].map((unit) => `<option${item.unit === unit ? " selected" : ""}>${unit}</option>`).join("")}
          </select>
        </label>
        <button class="save-item-button" type="button">Save</button>
      </article>
    `)
    .join("");

  if (!filtered.length) {
    itemSettingsList.innerHTML = '<p class="empty-sheet">No matching items.</p>';
  }
}

async function loadItems() {
  setSetupMessage("Loading...");
  const data = await api("/api/items");
  items = data.items;
  renderItems();
  setSetupMessage("");
}

async function saveItem(article) {
  const id = article.dataset.itemId;
  const minimumThreshold = article.querySelector(".minimum-input").value;
  const unit = article.querySelector(".unit-select").value;
  const inventorySubgroup = article.querySelector(".subgroup-input").value;
  const shelfCode = article.querySelector(".shelf-input").value;
  const data = await api(`/api/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ minimumThreshold, unit, inventorySubgroup, shelfCode })
  });

  items = items.map((item) => (item.id === id ? data.item : item));
  renderItems();
  setSetupMessage("Item settings saved.");
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
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    passwordInput.value = "";
    setLoginMessage("");
    showApp();
    await loadItems();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
areaFilter.addEventListener("change", renderItems);
locationFilter.addEventListener("change", renderItems);
itemSettingsList.addEventListener("click", (event) => {
  const button = event.target.closest(".save-item-button");
  if (!button) return;
  const article = event.target.closest(".settings-item");
  button.disabled = true;
  saveItem(article)
    .catch((error) => setSetupMessage(error.message, true))
    .finally(() => {
      button.disabled = false;
    });
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => setSetupMessage(error.message, true));
} else {
  showLogin();
}





