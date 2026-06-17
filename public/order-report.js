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
const standingReportSummaryList = document.querySelector("#standingReportSummaryList");
const standingReportList = document.querySelector("#standingReportList");
const activitySummary = document.querySelector("#activitySummary");
const activityReportList = document.querySelector("#activityReportList");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let currentReportRows = [];
let currentActivityEntries = [];
let currentStandingOrders = [];
let currentGuestCount = { guests: "", notes: "" };
let activeReportFilter = "all";
let activeActivityFilter = "all";

function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
      .join("-"))
    .join(" ");
}

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
  currentUser.textContent = formatUserDisplay(sessionUser);
  window.refreshKitchenMenus?.();
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
  const category = String(a.category || "").localeCompare(String(b.category || ""));
  if (category) return category;
  const item = String(a.itemName || "").localeCompare(String(b.itemName || ""));
  if (item) return item;
  return String(a.status || "").localeCompare(String(b.status || ""));
}

function reportRowsForFilter(rows = [], filter = "all") {
  if (filter === "picked") return rows.filter((row) => row.ordered);
  if (filter === "deliver") return rows.filter((row) => row.toDeliver);
  if (filter === "delivered") return rows.filter((row) => row.delivered);
  if (filter === "waiting") return rows.filter((row) => row.waiting);
  return rows;
}

function renderSummary(summary) {
  const cards = [
    ["Guests", summary.guests ?? "-", ""],
    ["Total lines", summary.totalLines || 0, "all"],
    ["Picked / ordered", summary.orderedLines || 0, "picked"],
    ["2Deliver", summary.toDeliverLines || 0, "deliver"],
    ["Delivered", summary.deliveredLines || 0, "delivered"],
    ["Waiting", summary.waitingLines || 0, "waiting"]
  ];

  reportSummary.innerHTML = cards
    .map(
      ([label, value, filter]) => `
        <article class="${filter ? "report-filter-card" : "report-info-card"}${filter && activeReportFilter === filter ? " active" : ""}"${filter ? ` data-report-filter="${escapeHtml(filter)}" role="button" tabindex="0"` : ""}>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </article>
      `
    )
    .join("");
}

function renderStandingOrders(orders) {
  if (!orders.length) {
    standingReportSummaryList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    standingReportList.innerHTML = '<p class="empty-sheet">No standing orders scheduled.</p>';
    return;
  }

  standingReportSummaryList.innerHTML = orders
    .map((order) => {
      const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [{ itemName: order.itemName, quantity: order.quantity }];
      return `
        <article class="standing-report-summary-row">
          <div>
            <strong>${escapeHtml(order.name || order.supplierName || "Standing Order")}</strong>
            <span>${escapeHtml(order.supplierName || "No supplier")}</span>
          </div>
          <div class="standing-report-summary-meta">
            <span><b>Expected</b> ${escapeHtml(order.expectedDate || "not set")}</span>
            <span><b>Schedule</b> ${escapeHtml(order.schedule || "Other")}</span>
            <span><b>Items</b> ${escapeHtml(items.length)}</span>
            <span><b>Status</b> ${escapeHtml(order.active ? "Scheduled" : "Inactive")}</span>
          </div>
        </article>
      `;
    })
    .join("");

  standingReportList.innerHTML = orders
    .map((order) => {
      const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [{ itemName: order.itemName, quantity: order.quantity }];
      return `
        <section class="sheet-group">
          <div class="supplier-heading">
            <h2>${escapeHtml(order.supplierName || order.name || "Standing Order")}</h2>
            <pre>${escapeHtml([
              order.expectedDate ? `Expected: ${order.expectedDate}` : "",
              order.schedule || "",
              order.active ? "Active" : "Inactive"
            ].filter(Boolean).join(" / "))}</pre>
          </div>
          <table class="order-report-table">
            <thead>
              <tr>
                <th>Standing order</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Expected delivery</th>
                <th>Schedule</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((line) => `
                <tr>
                  <td>
                    ${escapeHtml(order.name || "Standing Order")}
                    <small>${escapeHtml(order.notes || "")}</small>
                  </td>
                  <td>${escapeHtml(line.itemName || order.itemName || "")}</td>
                  <td>${escapeHtml(line.quantity ?? order.quantity ?? "")}</td>
                  <td>${escapeHtml(order.expectedDate || "")}</td>
                  <td>${escapeHtml(order.schedule || "")}</td>
                  <td>${escapeHtml(order.active ? "Scheduled" : "Inactive")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");
}

function labelForActionType(value) {
  if (value === "add") return "Adds";
  if (value === "delete") return "Deletes";
  return "Changes";
}

function labelForEntityType(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function labelForReasonCode(value) {
  const code = String(value || "").trim();
  const labels = {
    "category-create": "Category added",
    "category-delete": "Category removed",
    "category-update": "Category changed",
    "daily-guests": "Guest count changed",
    "delivery-complete": "Order fully received",
    "delivery-partial": "Order partly received",
    "driver-assign": "Driver assigned",
    "driver-line-change": "Driver sheet changed",
    "delivery-plan-change": "Delivery plan changed",
    "guest-count-create": "Guest count added",
    "guest-count-update": "Guest count changed",
    "inventory-create": "Item added",
    "inventory-delete": "Item removed",
    "inventory-update": "Item changed",
    "order-create": "Order added",
    "order-delete": "Order removed",
    "order-update": "Order changed",
    "password-change": "Own password changed",
    "password-reset": "Password reset",
    "picked-change": "Marked picked or unpicked",
    "shelf-code-create": "Shelf code added",
    "shelf-code-update": "Shelf code changed",
    "standing-order-create": "Standing order added",
    "standing-order-delete": "Standing order removed",
    "standing-order-update": "Standing order changed",
    "stock-count": "Stock count saved",
    "storage-location-create": "Storage location added",
    "storage-location-update": "Storage location changed",
    "supplier-create": "Supplier added",
    "supplier-delete": "Supplier removed",
    "supplier-note-create": "Delivery memo added",
    "supplier-note-delete": "Delivery memo removed",
    "supplier-note-update": "Delivery memo changed",
    "supplier-primary-change": "Supplier changed permanently",
    "supplier-temp-change": "Supplier changed one time",
    "supplier-update": "Supplier changed",
    "unit-change": "Order unit changed",
    "user-create": "User added",
    "user-delete": "User removed",
    "user-update": "User changed"
  };
  return labels[code] || labelForEntityType(code);
}

function renderActivity(entries) {
  const list = Array.isArray(entries) ? entries : [];
  currentActivityEntries = list;
  const adds = list.filter((entry) => entry.actionType === "add").length;
  const changes = list.filter((entry) => entry.actionType === "change").length;
  const deletes = list.filter((entry) => entry.actionType === "delete").length;
  const actors = new Set(list.map((entry) => String(entry.actorUsername || "").trim()).filter(Boolean)).size;

  activitySummary.innerHTML = [
    ["Adds", adds, "add"],
    ["Changes", changes, "change"],
    ["Deletes", deletes, "delete"],
    ["Users", actors, ""]
  ].map(([label, value, filter]) => `
    <article class="${filter ? "report-filter-card" : "report-info-card"}${filter && activeActivityFilter === filter ? " active" : ""}"${filter ? ` data-activity-filter="${escapeHtml(filter)}" role="button" tabindex="0"` : ""}>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `).join("");

  const visible = activeActivityFilter === "all"
    ? list
    : list.filter((entry) => entry.actionType === activeActivityFilter);

  if (!visible.length) {
    activityReportList.innerHTML = '<p class="empty-sheet">No recorded adds, changes, or deletes for this day.</p>';
    return;
  }

  activityReportList.innerHTML = visible
    .map((entry) => `
      <article class="activity-row action-${escapeHtml(entry.actionType)}">
        <div class="activity-row-top">
          <strong>${escapeHtml(entry.entityName || labelForEntityType(entry.entityType) || "Change")}</strong>
          <span>${escapeHtml(formatDateTime(entry.createdAt))}</span>
        </div>
        <div class="activity-row-meta">
          <span>${escapeHtml(labelForActionType(entry.actionType))}</span>
          <span>${escapeHtml(labelForEntityType(entry.entityType))}</span>
          <span>${escapeHtml(`By ${formatUserDisplay(entry.actorUsername || "System")}`)}</span>
          ${entry.reasonCode ? `<span>${escapeHtml(labelForReasonCode(entry.reasonCode))}</span>` : ""}
        </div>
        ${entry.note ? `<p class="activity-note">${escapeHtml(entry.note)}</p>` : ""}
      </article>
    `)
    .join("");
}

function renderReport(data) {
  currentReportRows = Array.isArray(data.rows) ? data.rows : [];
  currentStandingOrders = Array.isArray(data.standingOrders) ? data.standingOrders : [];
  currentGuestCount = data.guestCount || { guests: "", notes: "" };
  printDate.textContent = `Date: ${data.date}`;
  guestCountInput.value = data.guestCount?.guests ?? "";
  guestNotesInput.value = data.guestCount?.notes ?? "";
  renderSummary(data.summary || {});
  renderStandingOrders(currentStandingOrders);
  renderActivity(data.activity || []);

  const visibleRows = reportRowsForFilter(currentReportRows, activeReportFilter);

  if (!visibleRows.length) {
    reportList.innerHTML = '<p class="empty-sheet">No order lines found for this date.</p>';
    return;
  }

  const groups = groupBySupplier(visibleRows);
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

function updateReportFilter(filter) {
  activeReportFilter = filter || "all";
  renderReport({
    date: reportDate.value,
    summary: {
      guests: guestCountInput.value || "-",
      totalLines: currentReportRows.length,
      orderedLines: currentReportRows.filter((row) => row.ordered).length,
      toDeliverLines: currentReportRows.filter((row) => row.toDeliver).length,
      deliveredLines: currentReportRows.filter((row) => row.delivered).length,
      waitingLines: currentReportRows.filter((row) => row.waiting).length
    },
    rows: currentReportRows,
    standingOrders: currentStandingOrders,
    activity: currentActivityEntries,
    guestCount: currentGuestCount
  });
}

function updateActivityFilter(filter) {
  activeActivityFilter = filter || "all";
  renderActivity(currentActivityEntries);
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
reportSummary?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-report-filter]");
  if (!card) return;
  const nextFilter = card.dataset.reportFilter || "all";
  updateReportFilter(activeReportFilter === nextFilter ? "all" : nextFilter);
});
activitySummary?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-activity-filter]");
  if (!card) return;
  const nextFilter = card.dataset.activityFilter || "all";
  updateActivityFilter(activeActivityFilter === nextFilter ? "all" : nextFilter);
});
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







