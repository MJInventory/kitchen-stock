import {
  formatUserDisplay,
  todayLocal,
  escapeHtml,
  plainTextFileName,
  buildPlainTextSheet
} from "./helpers.js";
import { renderSheet } from "./render.js";
import { createDriverSheetActions } from "./actions.js";

export function initDriverSheetPage() {
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
  let currentSheet = { date: "", requests: [], suppliers: [], units: [] };

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

  function openTextSheet(supplierFilter = "") {
    if (!currentSheet.requests?.length) {
      setMessage("Load a driver sheet first.", true);
      return;
    }
    const text = buildPlainTextSheet(currentSheet.requests || [], supplierFilter);
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
      if (typeof HTMLDialogElement === "undefined") {
        const response = window.prompt(
          `Change supplier for ${itemName || "this item"}.\nType P for Permanent, O for One-Time, or C to cancel.`,
          "O"
        );
        const choice = String(response || "").trim().toLowerCase();
        if (choice === "p" || choice === "permanent") {
          resolve("permanent");
          return;
        }
        if (choice === "o" || choice === "one-time" || choice === "onetime") {
          resolve("one-time");
          return;
        }
        resolve(null);
        return;
      }

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
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        const response = window.prompt(
          `Change supplier for ${itemName || "this item"}.\nType P for Permanent, O for One-Time, or C to cancel.`,
          "O"
        );
        dialog.remove();
        const choice = String(response || "").trim().toLowerCase();
        if (choice === "p" || choice === "permanent") {
          resolve("permanent");
          return;
        }
        if (choice === "o" || choice === "one-time" || choice === "onetime") {
          resolve("one-time");
          return;
        }
        resolve(null);
      }
    });
  }

  function renderCurrentSheet(data) {
    currentSheet = renderSheet(data, {
      driverName,
      printDate,
      printDriver,
      sheetList
    });
  }

  async function loadSheet() {
    setMessage("Loading...");
    const [data, formOptions] = await Promise.all([
      api(`/api/driver-sheet?date=${encodeURIComponent(sheetDate.value)}`),
      api("/api/item-form-options")
    ]);
    renderCurrentSheet({ ...data, units: formOptions.units || [] });
    setMessage("");
  }

  const driverSheetActions = createDriverSheetActions({
    api,
    setMessage,
    renderCurrentSheet,
    loadSheet,
    chooseSupplierChangeMode
  });

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
      driverSheetActions.toggleOrdered(row, button, currentSheet);
    }
    if (button.dataset.action === "delivered") {
      driverSheetActions.markDelivered(row, button, currentSheet);
    }
    if (button.dataset.action === "toDeliver") {
      driverSheetActions.toggleToDeliver(row, button, currentSheet);
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
      driverSheetActions.changeSupplier(row, supplierSelect, currentSheet);
      return;
    }

    const unitSelect = event.target.closest(".driver-unit-select");
    if (unitSelect) {
      const row = unitSelect.closest("tr");
      if (!row?.dataset.lineId) return;
      driverSheetActions.changeUnit(row, unitSelect, currentSheet);
      return;
    }

    const qtyInput = event.target.closest(".driver-qty-input");
    if (qtyInput) {
      const row = qtyInput.closest("tr");
      if (!row?.dataset.lineId) return;
      driverSheetActions.changeQuantity(row, qtyInput, currentSheet);
      return;
    }

    const deliveryDayInput = event.target.closest(".delivery-day-input");
    if (deliveryDayInput) {
      const row = deliveryDayInput.closest("tr");
      if (!row?.dataset.lineId) return;
      driverSheetActions.changeDeliveryDay(row, deliveryDayInput, currentSheet);
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
}
