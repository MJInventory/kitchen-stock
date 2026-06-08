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
const saveDriverButton = document.querySelector("#saveDriverButton");
const printSheetButton = document.querySelector("#printSheetButton");
const sheetMessage = document.querySelector("#sheetMessage");
const printDate = document.querySelector("#printDate");
const printDriver = document.querySelector("#printDriver");
const sheetList = document.querySelector("#sheetList");
let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let currentSheet = { date: "", requests: [], suppliers: [] };

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
  const canAssignDriver = Boolean(sessionPermissions.canAdminUsers);
  driverName.disabled = !canAssignDriver;
  saveDriverButton.hidden = !canAssignDriver;
  saveDriverButton.disabled = !canAssignDriver;
  if (canAssignDriver && !driverName.value) {
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function groupRequests(requests) {
  const groups = new Map();

  for (const request of requests) {
    const supplier = request.supplierName || "Unassigned Supplier";
    const category = request.category || "Unassigned Category";

    if (!groups.has(supplier)) {
      groups.set(supplier, {
        supplier,
        contact: request.supplierContact || "",
        categories: new Map()
      });
    }

    const supplierEntry = groups.get(supplier);
    if (!supplierEntry.categories.has(category)) {
      supplierEntry.categories.set(category, {
        category,
        requests: []
      });
    }

    supplierEntry.categories.get(category).requests.push(request);
  }

  return groups;
}

function logicalRequestCompare(a, b) {
  const category = String(a.category || "").localeCompare(String(b.category || ""));
  if (category) return category;
  const shelf = String(a.shelfCode || "").localeCompare(String(b.shelfCode || ""), undefined, { numeric: true });
  if (shelf) return shelf;
  return String(a.itemName || "").localeCompare(String(b.itemName || ""));
}

function supplierOptions(selectedSupplier) {
  const selected = selectedSupplier || "";
  const known = currentSheet.suppliers || [];
  const hasSelected = known.some((supplier) => supplier.name === selected);
  const options = [
    ...(selected && !hasSelected ? [{ name: selected }] : []),
    ...known
  ];

  return options
    .map((supplier) => {
      const name = supplier.name || "";
      return `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function renderSheet(data) {
  currentSheet = data;
  if (data.driverName && !driverName.value) driverName.value = data.driverName;
  printDate.textContent = `Date: ${data.date}`;
  printDriver.textContent = `Driver: ${driverName.value || "________________"}`;

  if (!data.requests.length) {
    sheetList.innerHTML = '<p class="empty-sheet">No pending or approved requests for this date.</p>';
    return;
  }

  const groups = groupRequests(data.requests);
  sheetList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, supplier]) => `
      <section class="sheet-group">
        <div class="supplier-heading">
          <h2>${escapeHtml(supplier.supplier)}</h2>
          ${supplier.contact ? `<pre>${escapeHtml(supplier.contact)}</pre>` : ""}
        </div>
        ${[...supplier.categories.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, category]) => `
            <div class="driver-supplier">
              <div class="driver-supplier-title">
                <h3>${escapeHtml(category.category)}</h3>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Ordered</th>
                    <th>Delivered</th>
                    <th>Item</th>
                    <th>Supplier</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Priority</th>
                    <th>2Deliver</th>
                    <th>Delivery Day</th>
                  </tr>
                </thead>
                <tbody>
                  ${category.requests
                    .sort(logicalRequestCompare)
                    .map((request) => `
                      <tr data-line-id="${escapeHtml(request.driverLineId || "")}" data-request-id="${escapeHtml(request.id || "")}">
                        <td>
                          <button class="driver-check-button${request.ordered ? " checked" : ""}" type="button" data-action="ordered" ${request.driverLineId ? "" : "disabled"} aria-label="Mark ordered">
                            ${request.ordered ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>
                          <button class="driver-check-button${request.delivered ? " checked" : ""}" type="button" data-action="delivered" ${request.driverLineId || request.delivered ? "" : "disabled"} aria-label="Mark delivered">
                            ${request.delivered ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>${escapeHtml(request.itemName)}</td>
                        <td>
                          <select class="driver-supplier-select" ${request.driverLineId ? "" : "disabled"} aria-label="Supplier for ${escapeHtml(request.itemName)}">
                            ${supplierOptions(request.supplierName)}
                          </select>
                        </td>
                        <td>${escapeHtml(request.quantity ?? "")}</td>
                        <td>${escapeHtml(request.unit || "")}</td>
                        <td>${escapeHtml(request.urgency || "")}</td>
                        <td>
                          <button class="driver-check-button${request.toDeliver ? " checked" : ""}" type="button" data-action="toDeliver" ${request.driverLineId ? "" : "disabled"} aria-label="Mark 2Deliver">
                            ${request.toDeliver ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>
                          <input class="delivery-day-input" type="date" value="${escapeHtml(request.deliveryDay || "")}" ${request.driverLineId ? "" : "disabled"} aria-label="Delivery day for ${escapeHtml(request.itemName)}">
                        </td>
                      </tr>
                    `)
                    .join("")}
                </tbody>
              </table>
            </div>
          `)
          .join("")}
      </section>
    `)
    .join("");
}

async function loadSheet() {
  setMessage("Loading...");
  const data = await api(`/api/driver-sheet?date=${encodeURIComponent(sheetDate.value)}`);
  renderSheet(data);
  setMessage("");
}

function updateRequestFromLine(line) {
  currentSheet.requests = currentSheet.requests.map((request) => {
    if (request.driverLineId !== line.id) return request;
    return {
      ...request,
      ordered: line.ordered,
      toDeliver: line.toDeliver,
      deliveryDay: line.deliveryDay || "",
      driverName: line.driverName || request.driverName,
      delivered: line.received || request.delivered,
      supplierName: line.supplierName || request.supplierName,
      supplierContact: line.supplierContact || request.supplierContact
    };
  });
}

async function toggleOrdered(row, button) {
  const lineId = row.dataset.lineId;
  const ordered = !button.classList.contains("checked");
  button.disabled = true;
  setMessage("Saving ordered status...");
  try {
    const { line } = await api(`/api/driver-lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ ordered })
    });
    updateRequestFromLine(line);
    renderSheet(currentSheet);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function markDelivered(row, button) {
  const lineId = row.dataset.lineId;
  const requestId = row.dataset.requestId;
  if (button.classList.contains("checked")) return;
  button.disabled = true;
  setMessage("Marking delivered and updating stock...");
  try {
    await api(`/api/driver-lines/${lineId}/deliver`, {
      method: "POST",
      body: JSON.stringify({ requestId })
    });
    await loadSheet();
    setMessage("Delivered. Stock updated.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function toggleToDeliver(row, button) {
  const lineId = row.dataset.lineId;
  const toDeliver = !button.classList.contains("checked");
  const deliveryDay = row.querySelector(".delivery-day-input")?.value || "";
  button.disabled = true;
  setMessage("Saving 2Deliver status...");
  try {
    const { line } = await api(`/api/driver-lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ toDeliver, deliveryDay })
    });
    updateRequestFromLine(line);
    renderSheet(currentSheet);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveDriverAssignment() {
  if (!sessionPermissions.canAdminUsers) {
    setMessage("Only admins can assign a driver.", true);
    return;
  }
  setMessage("Assigning driver...");
  const result = await api("/api/driver-sheet/driver", {
    method: "PATCH",
    body: JSON.stringify({
      date: sheetDate.value,
      driverName: driverName.value
    })
  });
  currentSheet.driverName = result.driverName;
  printDriver.textContent = `Driver: ${result.driverName}`;
  setMessage(`Driver assigned to ${result.updated} line(s).`);
}

async function changeSupplier(row, select) {
  const lineId = row.dataset.lineId;
  const itemName = row.querySelector("td:nth-child(3)")?.textContent?.trim() || "this item";
  const updatePrimarySupplier = window.confirm(
    `Make ${select.value || "this supplier"} the primary supplier for ${itemName}?\n\nOK = change the inventory item's primary supplier.\nCancel = temporary change for this order only.`
  );
  select.disabled = true;
  setMessage(updatePrimarySupplier ? "Saving supplier and updating primary supplier..." : "Saving temporary supplier...");
  try {
    const { line } = await api(`/api/driver-lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ supplierName: select.value, updatePrimarySupplier })
    });
    updateRequestFromLine(line);
    renderSheet(currentSheet);
    setMessage(updatePrimarySupplier ? "Supplier saved and primary supplier updated." : "Temporary supplier saved for this order.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    select.disabled = false;
  }
}

sheetDate.value = todayLocal();
loadSheetButton.addEventListener("click", () => loadSheet().catch((error) => setMessage(error.message, true)));
saveDriverButton.addEventListener("click", () => saveDriverAssignment().catch((error) => setMessage(error.message, true)));
driverName.addEventListener("input", () => {
  printDriver.textContent = `Driver: ${driverName.value || "________________"}`;
});
printSheetButton.addEventListener("click", () => window.print());

sheetList.addEventListener("click", (event) => {
  const button = event.target.closest(".driver-check-button");
  if (!button) return;
  const row = button.closest("tr");
  if (!row?.dataset.lineId) return;
  if (button.dataset.action === "ordered") {
    toggleOrdered(row, button);
  }
  if (button.dataset.action === "delivered") {
    markDelivered(row, button);
  }
  if (button.dataset.action === "toDeliver") {
    toggleToDeliver(row, button);
  }
});

sheetList.addEventListener("change", (event) => {
  const select = event.target.closest(".driver-supplier-select");
  if (!select) return;
  const row = select.closest("tr");
  if (!row?.dataset.lineId) return;
  changeSupplier(row, select);
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
    sessionPermissions = data.user.permissions || {};
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockPermissions", JSON.stringify(sessionPermissions));
    localStorage.setItem("kitchenStockRole", data.user.role || "user");
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    if (data.user.mustChangePassword) {
      window.location.href = "/change-password.html";
      return;
    }
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








