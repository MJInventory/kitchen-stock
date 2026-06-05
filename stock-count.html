const sheetDate = document.querySelector("#sheetDate");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const loadSheetButton = document.querySelector("#loadSheetButton");
const sheetMessage = document.querySelector("#sheetMessage");
const printDate = document.querySelector("#printDate");
const printReceiver = document.querySelector("#printReceiver");
const receivingList = document.querySelector("#receivingList");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let currentSheet = { date: "", requests: [] };

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
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
  sheetMessage.textContent = text;
  sheetMessage.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = sessionUser;
  printReceiver.textContent = `Receiver: ${sessionUser || "________________"}`;
}

function showLogin() {
  loginScreen.hidden = false;
  currentUser.textContent = "";
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
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
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function groupByStorage(requests) {
  const groups = new Map();
  for (const request of requests) {
    const location = request.storageLocation || "Unassigned Storage";
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location).push(request);
  }
  return groups;
}

function renderSheet(data) {
  currentSheet = data;
  printDate.textContent = `Date: ${data.date}`;
  printReceiver.textContent = `Receiver: ${sessionUser || "________________"}`;

  if (!data.requests.length) {
    receivingList.innerHTML = '<p class="empty-sheet">No items waiting to be received.</p>';
    return;
  }

  const groups = groupByStorage(data.requests);
  receivingList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([location, requests]) => `
      <section class="sheet-group">
        <div class="supplier-heading">
          <h2>${escapeHtml(location)}</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Shelf</th>
              <th>Area / Location</th>
              <th>Supplier</th>
            </tr>
          </thead>
          <tbody>
            ${requests
              .sort((a, b) => `${a.shelfCode || ""} ${a.itemName || ""}`.localeCompare(`${b.shelfCode || ""} ${b.itemName || ""}`, undefined, { numeric: true }))
              .map((request) => `
                <tr data-line-id="${escapeHtml(request.driverLineId || "")}" data-request-id="${escapeHtml(request.id || "")}">
                  <td>
                    <button class="driver-check-button${request.delivered ? " checked" : ""}" type="button" data-action="received" ${request.driverLineId ? "" : "disabled"} aria-label="Mark received">
                      ${request.delivered ? "&#10003;" : ""}
                    </button>
                  </td>
                  <td>${escapeHtml(request.itemName)}</td>
                  <td>${escapeHtml(request.quantity ?? "")}</td>
                  <td>${escapeHtml(request.unit || "")}</td>
                  <td>${escapeHtml(request.shelfCode || "")}</td>
                  <td>${escapeHtml([request.inventoryArea, request.storageLocation].filter(Boolean).join(" / "))}</td>
                  <td>${escapeHtml(request.supplierName || "")}</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </section>
    `)
    .join("");
}

async function loadSheet() {
  setMessage("Loading...");
  const data = await api(`/api/receiving-sheet?date=${encodeURIComponent(sheetDate.value)}`);
  renderSheet(data);
  setMessage("");
}

async function markReceived(row, button) {
  const lineId = row.dataset.lineId;
  const requestId = row.dataset.requestId;
  if (button.classList.contains("checked")) return;
  button.disabled = true;
  setMessage("Receiving item and updating stock...");
  try {
    await api(`/api/driver-lines/${lineId}/deliver`, {
      method: "POST",
      body: JSON.stringify({ requestId })
    });
    await loadSheet();
    setMessage(`Received by ${sessionUser}. Stock updated.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

sheetDate.value = todayLocal();
loadSheetButton.addEventListener("click", () => loadSheet().catch((error) => setMessage(error.message, true)));
logoutButton.addEventListener("click", showLogin);

receivingList.addEventListener("click", (event) => {
  const button = event.target.closest(".driver-check-button");
  if (!button) return;
  const row = button.closest("tr");
  if (!row?.dataset.lineId) return;
  markReceived(row, button);
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
    await loadSheet();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

if (sessionToken && sessionUser) {
  showApp();
  loadSheet().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}

