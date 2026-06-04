const itemSelect = document.querySelector("#itemSelect");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const areaFilter = document.querySelector("#areaFilter");
const locationFilter = document.querySelector("#locationFilter");
const requestForm = document.querySelector("#requestForm");
const quantityInput = document.querySelector("#quantityInput");
const urgencySelect = document.querySelector("#urgencySelect");
const requestedByInput = document.querySelector("#requestedByInput");
const notesInput = document.querySelector("#notesInput");
const submitButton = document.querySelector("#submitButton");
const refreshButton = document.querySelector("#refreshButton");
const message = document.querySelector("#message");
const requestList = document.querySelector("#requestList");

let itemNameById = new Map();
let recentRequests = [];
let allItems = [];
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
  requestedByInput.value = sessionUser || "Kitchen";
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
  if (response.status === 401) {
    showLogin();
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function renderItems(items) {
  allItems = items;
  itemNameById = new Map(items.map((item) => [item.id, item.name]));
  const area = areaFilter.value;
  const location = locationFilter.value;
  const filtered = items.filter((item) => {
    const areaMatches = !area || !item.inventoryArea || item.inventoryArea === area;
    const locationMatches = !location || !item.storageLocation || item.storageLocation === location;
    return areaMatches && locationMatches;
  });

  itemSelect.innerHTML = filtered
    .map((item) => {
      const quantity = [item.quantity, item.unit].filter(Boolean).join(" ");
      const detail = [quantity, item.storageLocation, item.inventoryArea].filter(Boolean).join(" / ");
      return `<option value="${item.id}">${item.name}${detail ? ` (${detail})` : ""}</option>`;
    })
    .join("");

  if (!filtered.length) {
    itemSelect.innerHTML = '<option value="">No matching items</option>';
  }
}

function renderRequests(requests) {
  requestList.innerHTML = requests
    .map((request) => {
      const itemName = itemNameById.get(request.itemId) || "Requested item";
      const qty = request.quantity ? `${request.quantity}` : "";
      const receivedText = request.received
        ? `Received by ${request.receivedBy || "someone"}${request.receivedAt ? ` on ${new Date(request.receivedAt).toLocaleString()}` : ""}`
        : "";
      return `
        <article class="request">
          <strong>${itemName}</strong>
          <span>${qty} needed - ${request.urgency || "Medium"} - ${request.status || "Pending"}</span>
          <span>${[request.inventoryArea, request.storageLocation].filter(Boolean).join(" / ")}</span>
          <span>${request.requestedBy || "Kitchen"}</span>
          ${receivedText ? `<span class="received-text">${receivedText}</span>` : ""}
          ${request.received ? "" : `<button class="receive-button" type="button" data-request-id="${request.id}">Mark Received</button>`}
        </article>
      `;
    })
    .join("");
}

async function markReceived(requestId) {
  const data = await api(`/api/requests/${requestId}/receive`, { method: "POST" });
  recentRequests = recentRequests.map((request) => (request.id === requestId ? data.request : request));
  renderRequests(recentRequests);
  setMessage("Item marked received.");
}

async function refresh() {
  setMessage("Loading...");
  const data = await api("/api/bootstrap");
  recentRequests = data.requests;
  renderItems(data.items);
  renderRequests(recentRequests);
  setMessage("");
}

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setMessage("Submitting...");

  try {
    const data = await api("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        itemId: itemSelect.value,
        quantityNeeded: quantityInput.value,
        urgencyLevel: urgencySelect.value,
        storageLocation: allItems.find((item) => item.id === itemSelect.value)?.storageLocation || "",
        inventoryArea: allItems.find((item) => item.id === itemSelect.value)?.inventoryArea || areaFilter.value || "",
        requestedBy: requestedByInput.value,
        notes: notesInput.value
      })
    });

    quantityInput.value = "";
    notesInput.value = "";
    setMessage("Request submitted.");
    recentRequests = [data.request, ...recentRequests].slice(0, 20);
    renderRequests(recentRequests);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

refreshButton.addEventListener("click", () => {
  refresh().catch((error) => setMessage(error.message, true));
});

requestList.addEventListener("click", (event) => {
  const button = event.target.closest(".receive-button");
  if (!button) return;

  button.disabled = true;
  markReceived(button.dataset.requestId).catch((error) => {
    setMessage(error.message, true);
    button.disabled = false;
  });
});

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

logoutButton.addEventListener("click", () => {
  showLogin();
});

areaFilter.addEventListener("change", () => renderItems(allItems));
locationFilter.addEventListener("change", () => renderItems(allItems));

if (sessionToken && sessionUser) {
  showApp();
  refresh().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
