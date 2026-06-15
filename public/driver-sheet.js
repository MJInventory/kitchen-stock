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

function isStandingOrderRequest(request) {
  return Boolean(String(request?.standingRunId || "").trim())
    || String(request?.requestedBy || "").toLowerCase().includes("standing order")
    || String(request?.notes || "").toLowerCase().includes("standing order");
}

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
  currentUser.textContent = formatUserDisplay(sessionUser);
  window.refreshKitchenMenus?.();
  const canAssignDriver = Boolean(sessionPermissions.canAdminUsers);
  driverName.disabled = !canAssignDriver;
  saveDriverButton.hidden = !canAssignDriver;
  saveDriverButton.disabled = !canAssignDriver;
  if (canAssignDriver && !driverName.value) {
    driverName.value = formatUserDisplay(sessionUser || "");
  }
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

function unitOptions(selectedUnit) {
  const current = String(selectedUnit || "item").trim().toLowerCase() || "item";
  return ["box", "bag", "item", "bottle"]
    .map((unit) => `<option value="${escapeHtml(unit)}"${unit === current ? " selected" : ""}>${escapeHtml(unit)}</option>`)
    .join("");
}

function formatQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "").trim();
  return Number.isInteger(number) ? String(number) : String(number);
}

function plainTextFileName(label) {
  return String(label || "supplier")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "supplier";
}

function buildPlainTextSheet(supplierFilter = "") {
  const grouped = new Map();
  const requests = [...(currentSheet.requests || [])]
    .filter((request) => !supplierFilter || String(request.supplierName || "Unassigned Supplier").trim() === supplierFilter)
    .sort((left, right) => {
      const supplier = String(left.supplierName || "").localeCompare(String(right.supplierName || ""), undefined, { sensitivity: "base" });
      if (supplier) return supplier;
      return String(left.itemName || "").localeCompare(String(right.itemName || ""), undefined, { numeric: true, sensitivity: "base" });
    });

  for (const request of requests) {
    const supplier = String(request.supplierName || "Unassigned Supplier").trim() || "Unassigned Supplier";
    if (!grouped.has(supplier)) grouped.set(supplier, []);
    grouped.get(supplier).push(request);
  }

  return [...grouped.entries()]
    .map(([supplier, supplierRequests]) => {
      const lines = supplierRequests.map((request) => `${formatQuantity(request.quantity)} x ${String(request.unit || "item").trim() || "item"} ${String(request.itemName || "").trim()}`.trim());
      return [
        supplier,
        "",
        "Bon dia,",
        "Can i please order the following items:",
        "",
        ...lines,
        "",
        "thank in advance"
      ].join("\n");
    })
    .join("\n\n");
}

function openTextSheet(supplierFilter = "") {
  if (!currentSheet.requests?.length) {
    setMessage("Load a driver sheet first.", true);
    return;
  }
  const text = buildPlainTextSheet(supplierFilter);
  if (!String(text || "").trim()) {
    setMessage("No items found for that supplier.", true);
    return;
  }
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    const link = document.createElement("a");
    link.href = url;
    const label = supplierFilter ? plainTextFileName(supplierFilter) : "driver-sheet";
    link.download = `${label}-${sheetDate.value || todayLocal()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function chooseSupplierChangeMode(itemName, supplierName) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "choice-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="choice-dialog-card">
        <h2>Change Supplier</h2>
        <p>How should we save <strong>${escapeHtml(supplierName || "this supplier")}</strong> for <strong>${escapeHtml(itemName || "this item")}</strong>?</p>
        <div class="choice-dialog-actions">
          <button type="button" class="icon-button" data-choice="permanent">Permanent</button>
          <button type="button" class="icon-button" data-choice="one-time">One-Time</button>
          <button type="button" class="icon-button" data-choice="cancel">Cancel</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);

    const finish = (value) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(null);
    });
    dialog.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const choice = button.dataset.choice;
        if (choice === "cancel") finish(null);
        else finish(choice);
      });
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.showModal();
  });
}

function renderSheet(data) {
  currentSheet = {
    ...data,
    requests: (data.requests || []).filter((request) => !isStandingOrderRequest(request))
  };
  driverName.value = formatUserDisplay(data.driverName || driverName.value || "");
  printDate.textContent = `Date: ${data.date}`;
  printDriver.textContent = `Driver: ${formatUserDisplay(driverName.value) || "________________"}`;

  if (!currentSheet.requests.length) {
    sheetList.innerHTML = '<p class="empty-sheet">No pending or approved requests for this date.</p>';
    return;
  }

  const groups = groupRequests(currentSheet.requests);
  sheetList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, supplier]) => `
      <section class="sheet-group">
        <div class="supplier-heading supplier-text-trigger" role="button" tabindex="0" data-supplier-name="${escapeHtml(supplier.supplier)}" aria-label="Open text list for ${escapeHtml(supplier.supplier)}">
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
                          <span class="print-value">${escapeHtml(request.supplierName || "Unassigned Supplier")}</span>
                        </td>
                        <td>
                          <input class="driver-qty-input" type="number" min="0.01" step="0.01" value="${escapeHtml(request.quantity ?? "")}" ${request.driverLineId ? "" : "disabled"} aria-label="Quantity for ${escapeHtml(request.itemName)}">
                          <span class="print-value">${escapeHtml(request.quantity ?? "")}</span>
                        </td>
                        <td>
                          <select class="driver-unit-select" ${request.driverLineId ? "" : "disabled"} aria-label="Unit for ${escapeHtml(request.itemName)}">
                            ${unitOptions(request.unit)}
                          </select>
                          <span class="print-value">${escapeHtml(request.unit || "item")}</span>
                        </td>
                        <td>${escapeHtml(request.urgency || "")}</td>
                        <td>
                          <button class="driver-check-button${request.toDeliver ? " checked" : ""}" type="button" data-action="toDeliver" ${request.driverLineId ? "" : "disabled"} aria-label="Mark 2Deliver">
                            ${request.toDeliver ? "&#10003;" : ""}
                          </button>
                        </td>
                        <td>
                          <input class="delivery-day-input" type="date" value="${escapeHtml(request.deliveryDay || "")}" ${request.driverLineId ? "" : "disabled"} aria-label="Delivery day for ${escapeHtml(request.itemName)}">
                          <span class="print-value">${escapeHtml(request.deliveryDay || "")}</span>
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
      supplierContact: line.supplierContact || request.supplierContact,
      unit: line.unit || request.unit,
      quantity: line.quantity ?? request.quantity
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
    if (toDeliver) {
      const orderedButton = row.querySelector('[data-action="ordered"]');
      if (orderedButton && !orderedButton.classList.contains("checked")) {
        orderedButton.classList.add("checked");
        orderedButton.innerHTML = "&#10003;";
      }
    }
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
  driverName.value = result.driverName || driverName.value;
  currentSheet.driverName = result.driverName;
  printDriver.textContent = `Driver: ${formatUserDisplay(result.driverName)}`;
  await loadSheet();
  setMessage(`Driver assigned to ${result.updated} line(s).`);
}

async function changeSupplier(row, select) {
  const lineId = row.dataset.lineId;
  const itemName = row.querySelector("td:nth-child(3)")?.textContent?.trim() || "this item";
  const choice = await chooseSupplierChangeMode(itemName, select.value || "this supplier");
  if (!choice) {
    renderSheet(currentSheet);
    setMessage("Supplier change cancelled.");
    return;
  }
  const updatePrimarySupplier = choice === "permanent";
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

async function changeUnit(row, select) {
  const lineId = row.dataset.lineId;
  select.disabled = true;
  setMessage("Saving order unit...");
  try {
    const { line } = await api(`/api/driver-lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ unit: select.value })
    });
    updateRequestFromLine(line);
    renderSheet(currentSheet);
    setMessage("Order unit updated for this line.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    select.disabled = false;
  }
}

async function changeQuantity(row, input) {
  const lineId = row.dataset.lineId;
  const quantity = Number(input.value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    setMessage("Quantity must be greater than zero.", true);
    renderSheet(currentSheet);
    return;
  }
  input.disabled = true;
  setMessage("Saving quantity...");
  try {
    const { line } = await api(`/api/driver-lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity })
    });
    updateRequestFromLine(line);
    renderSheet(currentSheet);
    setMessage("Quantity updated for this line.");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    input.disabled = false;
  }
}

sheetDate.value = todayLocal();
loadSheetButton.addEventListener("click", () => loadSheet().catch((error) => setMessage(error.message, true)));
saveDriverButton.addEventListener("click", () => saveDriverAssignment().catch((error) => setMessage(error.message, true)));
driverName.addEventListener("input", () => {
  printDriver.textContent = `Driver: ${formatUserDisplay(driverName.value) || "________________"}`;
});
printSheetButton.addEventListener("click", () => window.print());

sheetList.addEventListener("click", (event) => {
  const supplierTrigger = event.target.closest(".supplier-text-trigger");
  if (supplierTrigger?.dataset.supplierName) {
    openTextSheet(supplierTrigger.dataset.supplierName);
    return;
  }
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

sheetList.addEventListener("keydown", (event) => {
  const supplierTrigger = event.target.closest(".supplier-text-trigger");
  if (!supplierTrigger?.dataset.supplierName) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openTextSheet(supplierTrigger.dataset.supplierName);
});

sheetList.addEventListener("change", (event) => {
  const supplierSelect = event.target.closest(".driver-supplier-select");
  if (supplierSelect) {
    const row = supplierSelect.closest("tr");
    if (!row?.dataset.lineId) return;
    changeSupplier(row, supplierSelect);
    return;
  }

  const unitSelect = event.target.closest(".driver-unit-select");
  if (unitSelect) {
    const row = unitSelect.closest("tr");
    if (!row?.dataset.lineId) return;
    changeUnit(row, unitSelect);
    return;
  }

  const qtyInput = event.target.closest(".driver-qty-input");
  if (qtyInput) {
    const row = qtyInput.closest("tr");
    if (!row?.dataset.lineId) return;
    changeQuantity(row, qtyInput);
  }
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
    window.setupKitchenPush?.();
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








