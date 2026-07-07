import { formatUserDisplay, todayLocal } from "./helpers.js";
import { renderReceivingSheet } from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell, persistKitchenSession, readKitchenSession } from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";
import { bindAuthenticatedBootstrap, bindLogoutButton } from "/session-bootstrap.js";

export function initReceivingSheetPage() {
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

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
  let currentSheet = { date: "", requests: [], suppliers: [], supplierNotes: [], displayRows: new Map() };

  function setMessage(text, isError = false) {
    sheetMessage.textContent = text;
    sheetMessage.classList.toggle("error", isError);
  }

  function setLoginMessage(text, isError = false) {
    loginMessage.textContent = text;
    loginMessage.classList.toggle("error", isError);
  }

  function showApp() {
    applyAuthenticatedShell({
      loginScreen,
      currentUser,
      sessionUser,
      formatUserDisplay
    });
    printReceiver.textContent = `Receiver: ${formatUserDisplay(sessionUser) || "________________"}`;
  }

  function showLogin() {
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
  }

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      window.location.href = "/change-password.html";
    }
  });

  function renderSheet(data) {
    renderReceivingSheet({
      data,
      sessionUser,
      currentSheet,
      receivingList,
      printDate,
      printReceiver
    });
  }

  async function loadSheet() {
    setMessage("Loading...");
    const data = await api(`/api/receiving-sheet?date=${encodeURIComponent(sheetDate.value)}`);
    renderSheet(data);
    setMessage("");
  }

  async function markReceived(row, button) {
    const displayKey = row.dataset.displayKey || "";
    const displayRow = currentSheet.displayRows?.get(displayKey);
    const request = displayRow?.request?.id ? displayRow.request : null;
    if (button.disabled) return;
    if (!request?.id) {
      setMessage("Could not find the receiving line to update.", true);
      return;
    }
    const quantityInput = row.querySelector(".receive-qty-input");
    const priceInput = row.querySelector(".receive-price-input");
    const receiveQty = Number(quantityInput?.value || 0);
    const receivedUnitPriceRaw = priceInput?.value ?? "";
    const receivedUnitPrice = receivedUnitPriceRaw === "" ? null : Number(receivedUnitPriceRaw);
    if (!Number.isFinite(receiveQty) || receiveQty <= 0) {
      setMessage("Receive quantity must be greater than zero.", true);
      return;
    }
    if (receivedUnitPrice !== null && (!Number.isFinite(receivedUnitPrice) || receivedUnitPrice < 0)) {
      setMessage("Received price must be zero or greater.", true);
      return;
    }
    button.disabled = true;
    button.classList.add("checked");
    button.innerHTML = "&#10003;";
    setMessage("Receiving item and updating stock...");
    try {
      await api(`/api/requests/${request.id}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          quantityReceived: receiveQty,
          receivedQuantity: receiveQty,
          receiveQuantity: receiveQty,
          unitPrice: receivedUnitPrice
        })
      });
      await loadSheet();
      setMessage(`Delivery updated for ${formatUserDisplay(sessionUser)}. Stock updated.`);
    } catch (error) {
      button.classList.remove("checked");
      button.innerHTML = "&nbsp;";
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteReceivingRow(row, button) {
    const displayKey = row.dataset.displayKey || "";
    const displayRow = currentSheet.displayRows?.get(displayKey);
    const request = displayRow?.request?.id ? displayRow.request : null;
    if (!request?.id) {
      setMessage("Could not find the receiving line to remove.", true);
      return;
    }
    const itemName = displayRow?.itemName || "this item";
    if (!confirm(`Remove ${itemName} from the receiving list?`)) return;
    if (!confirm(`Really remove ${itemName}? This cannot be undone.`)) return;

    button.disabled = true;
    setMessage(`Removing ${itemName}...`);
    try {
      await api(`/api/requests/${request.id}`, { method: "DELETE" });
      await loadSheet();
      setMessage(`${itemName} removed from receiving.`);
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function saveSupplierMemo(supplierName, textarea, button) {
    button.disabled = true;
    setMessage("Saving supplier memo...");
    try {
      await api("/api/receiving-notes", {
        method: "POST",
        body: JSON.stringify({
          date: sheetDate.value,
          supplierName,
          memo: textarea.value
        })
      });
      await loadSheet();
      setMessage("Supplier memo saved.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  sheetDate.value = todayLocal();
  loadSheetButton.addEventListener("click", () => loadSheet().catch((error) => setMessage(error.message, true)));
  bindLogoutButton(logoutButton, showLogin);

  receivingList.addEventListener("click", (event) => {
    const button = event.target.closest(".driver-check-button");
    if (button) {
      const row = button.closest("tr");
      if (!row?.dataset.displayKey) return;
      markReceived(row, button);
      return;
    }

    const memoButton = event.target.closest(".supplier-note-save");
    if (memoButton) {
      const card = memoButton.closest("[data-supplier-note]");
      const supplierName = card?.dataset.supplierNote || "";
      const textarea = card?.querySelector(".supplier-note-input");
      if (!supplierName || !textarea) return;
      saveSupplierMemo(supplierName, textarea, memoButton);
      return;
    }

    const deleteButton = event.target.closest(".receiving-delete-button");
    if (deleteButton) {
      const row = deleteButton.closest("tr");
      if (!row?.dataset.displayKey) return;
      deleteReceivingRow(row, deleteButton);
    }
  });

  bindKitchenLogin({
    loginForm,
    usernameInput,
    passwordInput,
    setLoginMessage,
    onSuccess: async (data) => {
      const saved = persistKitchenSession(data, {
        currentToken: sessionToken,
        applyTheme: window.applyKitchenTheme,
        forcedTheme: "light"
      });
      sessionToken = saved.token;
      sessionUser = saved.user;
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      passwordInput.value = "";
      setLoginMessage("");
      showApp();
      await loadSheet();
    }
  });

  bindAuthenticatedBootstrap({
    hasSession: () => Boolean(sessionToken && sessionUser),
    showApp,
    showLogin,
    load: loadSheet,
    onError: (error) => setMessage(error.message, true)
  });
}
