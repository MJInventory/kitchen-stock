const sheetDate = document.querySelector("#sheetDate");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const driverName = document.querySelector("#driverName");
const loadSheetButton = document.querySelector("#loadSheetButton");
const printSheetButton = document.querySelector("#printSheetButton");
const sheetMessage = document.querySelector("#sheetMessage");
const printDate = document.querySelector("#printDate");
const printDriver = document.querySelector("#printDriver");
const sheetList = document.querySelector("#sheetList");
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
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
  if (!driverName.value) {
    driverName.value = sessionUser || "";
  }
}

function showLogin() {
  loginScreen.hidden = false;
  currentUser.textContent = "";
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
}

function groupRequests(requests) {
  return requests.reduce((groups, request) => {
    const key = [request.inventoryArea || "Unassigned", request.storageLocation || "No location"].join(" - ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(request);
    return groups;
  }, new Map());
}

function renderSheet(data) {
  printDate.textContent = `Date: ${data.date}`;
  printDriver.textContent = `Driver: ${driverName.value || "________________"}`;

  if (!data.requests.length) {
    sheetList.innerHTML = '<p class="empty-sheet">No pending or approved requests for this date.</p>';
    return;
  }

  const groups = groupRequests(data.requests);
  sheetList.innerHTML = [...groups.entries()]
    .map(([group, requests]) => `
      <section class="sheet-group">
        <h2>${group}</h2>
        <table>
          <thead>
            <tr>
              <th>Picked</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Urgency</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${requests
              .map((request) => `
                <tr>
                  <td class="check-cell"></td>
                  <td>${request.itemName}</td>
                  <td>${request.quantity ?? ""}</td>
                  <td>${request.unit || ""}</td>
                  <td>${request.urgency || ""}</td>
                  <td>${request.status || ""}</td>
                  <td>${request.notes || ""}</td>
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
  const response = await fetch(`/api/driver-sheet?date=${encodeURIComponent(sheetDate.value)}`, {
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}
  });
  const data = await response.json();
  if (response.status === 401) {
    showLogin();
  }
  if (!response.ok) throw new Error(data.error || "Could not load driver sheet.");
  renderSheet(data);
  setMessage("");
}

sheetDate.value = todayLocal();
loadSheetButton.addEventListener("click", () => loadSheet().catch((error) => setMessage(error.message, true)));
driverName.addEventListener("input", () => {
  printDriver.textContent = `Driver: ${driverName.value || "________________"}`;
});
printSheetButton.addEventListener("click", () => window.print());

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

logoutButton.addEventListener("click", () => {
  showLogin();
});

if (sessionToken && sessionUser) {
  showApp();
  loadSheet().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}
