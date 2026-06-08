const reportDate = document.querySelector("#reportDate");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const loadReportButton = document.querySelector("#loadReportButton");
const saveGuestsButton = document.querySelector("#saveGuestsButton");
const printReportButton = document.querySelector("#printReportButton");
const reportMessage = document.querySelector("#reportMessage");
const guestCountField = document.querySelector("#guestCountField");
const guestNotesField = document.querySelector("#guestNotesField");
const guestCountInput = document.querySelector("#guestCountInput");
const guestNotesInput = document.querySelector("#guestNotesInput");
const printDate = document.querySelector("#printDate");
const reportSummary = document.querySelector("#reportSummary");
const reportList = document.querySelector("#reportList");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");

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

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setMessage(text, isError = false) {
  reportMessage.textContent = text;
  reportMessage.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = sessionUser;
  const canAdmin = Boolean(sessionPermissions.canAdminUsers);
  guestCountField.hidden = !canAdmin;
  guestNotesField.hidden = !canAdmin;
  saveGuestsButton.hidden = !canAdmin;
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

function groupBySupplier(rows) {
  const groups = new Map();
  for (const row of rows) {
    const supplier = row.supplierName || "Unassigned Supplier";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(row);
  }
  return groups;
}

function logicalRowCompare(a, b) {
  const category = String(a.inventorySubgroup || a.category || "").localeCompare(String(b.inventorySubgroup || b.category || ""));
  if (category) return category;
  const item = String(a.itemName || "").localeCompare(String(b.itemName || ""));
  if (item) return item;
  return String(a.status || "").localeCompare(String(b.status || ""));
}

function renderSummary(summary) {
  const cards = [
    ["Guests", summary.guests ?? "-"],
    ["Total lines", summary.totalLines || 0],
    ["Picked / ordered", summary.orderedLines || 0],
    ["2Deliver", summary.toDeliverLines || 0],
    ["Delivered", summary.deliveredLines || 0],
    ["Waiting", summary.waitingLines || 0]
  ];

  reportSummary.innerHTML = cards
    .map(
      ([label, value]) => `
        <article>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </article>
      `
    )
    .join("");
}

function renderReport(data) {
  printDate.textContent = `Date: ${data.date}`;
  guestCountInput.value = data.guestCount?.guests ?? "";
  guestNotesInput.value = data.guestCount?.notes ?? "";
  renderSummary(data.summary || {});

  if (!data.rows.length) {
    reportList.innerHTML = '<p class="empty-sheet">No order lines found for this date.</p>';
    return;
  }

  const groups = groupBySupplier(data.rows);
  reportList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplier, rows]) => `
      <section class="sheet-group">
        <div class="supplier-heading">
          <h2>${escapeHtml(supplier)}</h2>
        </div>
        <table class="order-report-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Requested By</th>
              <th>Picked / Ordered</th>
              <th>2Deliver</th>
              <th>Delivered / Accepted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .sort((a, b) => {
                const waiting = Number(b.waiting) - Number(a.waiting);
                if (waiting) return waiting;
                return logicalRowCompare(a, b);
              })
              .map((row) => `
                <tr class="${row.waiting ? "report-waiting" : "report-delivered"}">
                  <td>
                    ${escapeHtml(row.itemName)}
                    <small>${escapeHtml([row.inventoryArea, row.storageLocation, row.shelfCode].filter(Boolean).join(" / "))}</small>
                  </td>
                  <td>${escapeHtml(row.quantity ?? "")} ${escapeHtml(row.unit || "")}</td>
                  <td>
                    ${escapeHtml(row.requestedBy || "")}
                    <small>${escapeHtml(formatDateTime(row.requestedAt))}</small>
                  </td>
                  <td>
                    ${row.ordered ? "Yes" : "No"}
                    <small>${escapeHtml([row.orderedBy, formatDateTime(row.orderedAt)].filter(Boolean).join(" / "))}</small>
                  </td>
                  <td>${row.toDeliver ? "Yes" : "No"}</td>
                  <td>
                    ${row.delivered ? "Yes" : "No"}
                    <small>${escapeHtml([row.receivedBy, formatDateTime(row.receivedAt)].filter(Boolean).join(" / "))}</small>
                  </td>
                  <td>${escapeHtml(row.status)}</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </section>
    `)
    .join("");
}

async function loadReport() {
  setMessage("Loading report...");
  const data = await api(`/api/order-report?date=${encodeURIComponent(reportDate.value)}`);
  renderReport(data);
  setMessage("");
}

async function saveGuests() {
  setMessage("Saving guests...");
  await api("/api/daily-guests", {
    method: "POST",
    body: JSON.stringify({
      date: reportDate.value,
      guests: guestCountInput.value,
      notes: guestNotesInput.value
    })
  });
  await loadReport();
  setMessage("Guest count saved.");
}

reportDate.value = todayLocal();
loadReportButton.addEventListener("click", () => loadReport().catch((error) => setMessage(error.message, true)));
saveGuestsButton.addEventListener("click", () => saveGuests().catch((error) => setMessage(error.message, true)));
printReportButton.addEventListener("click", () => window.print());
logoutButton.addEventListener("click", showLogin);

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
    sessionPermissions = data.user.permissions || {};
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockRole", data.user.role || "user");
    localStorage.setItem("kitchenStockPermissions", JSON.stringify(sessionPermissions));
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    if (data.user.mustChangePassword) {
      window.location.href = "/change-password.html";
      return;
    }
    passwordInput.value = "";
    setLoginMessage("");
    showApp();
    await loadReport();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

if (sessionToken && sessionUser) {
  showApp();
  loadReport().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}







