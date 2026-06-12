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
let currentSheet = { date: "", requests: [], suppliers: [] };

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
  printReceiver.textContent = `Receiver: ${formatUserDisplay(sessionUser) || "________________"}`;
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

function groupBySupplier(requests) {
  const groups = new Map();
  for (const request of requests) {
    const supplier = request.supplierName || "Unassigned Supplier";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(request);
  }
  return groups;
}

function logicalRequestCompare(a, b) {
  const storage = String(a.storageLocation || "").localeCompare(String(b.storageLocation || ""));
  if (storage) return storage;
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
  printDate.textContent = `Date: ${data.date}`;
  printReceiver.textContent = `Receiver: ${sessionUser || "________________"}`;

  if (!data.requests.length) {
    receivingList.innerHTML = '<p class="empty-sheet">No items waiting to be received.</p>';
    return;
  }

  const groups = groupBySupplier(data.requests);
  receivingList.innerHTML = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplier, requests]) => `
      <section class="sheet-group">
        <div class="supplier-heading">
          <h2>${escapeHtml(supplier)}</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Item</th>
              <th>Supplier</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Shelf</th>
              <th>Area / Location</th>
            </tr>
          </thead>
          <tbody>
            ${requests
              .sort(logicalRequestCompare)
              .map((request) => `
                <tr data-line-id="${escapeHtml(request.driverLineId || "")}" data-request-id="${escapeHtml(request.id || "")}">
                  <td>
                    <button class="driver-check-button${request.delivered ? " checked" : ""}" type="button" data-action="received" ${request.driverLineId ? "" : "disabled"} aria-label="Mark received">
                      ${request.delivered ? "&#10003;" : ""}
                    </button>
                  </td>
                  <td>${escapeHtml(request.itemName)}</td>
                  <td>
                    <select class="driver-supplier-select receiving-supplier-select" ${request.driverLineId ? "" : "disabled"} aria-label="Supplier for ${escapeHtml(request.itemName)}">
                      ${supplierOptions(request.supplierName)}
                    </select>
                  </td>
                  <td>${escapeHtml(request.quantity ?? "")}</td>
                  <td>${escapeHtml(request.unit || "")}</td>
                  <td>${escapeHtml(request.shelfCode || "")}</td>
                  <td>${escapeHtml([request.inventoryArea, request.storageLocation].filter(Boolean).join(" / "))}</td>
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

function updateRequestFromLine(line) {
  currentSheet.requests = currentSheet.requests.map((request) => {
    if (request.driverLineId !== line.id) return request;
    return {
      ...request,
      supplierName: line.supplierName || request.supplierName,
      supplierContact: line.supplierContact || request.supplierContact
    };
  });
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

async function changeSupplier(row, select) {
  const lineId = row.dataset.lineId;
  const itemName = row.querySelector("td:nth-child(2)")?.textContent?.trim() || "this item";
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

receivingList.addEventListener("change", (event) => {
  const select = event.target.closest(".receiving-supplier-select");
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
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockRole", data.user.role || "user");
    localStorage.setItem("kitchenStockPermissions", JSON.stringify(data.user.permissions || {}));
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

if (sessionToken && sessionUser) {
  showApp();
  loadSheet().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}








