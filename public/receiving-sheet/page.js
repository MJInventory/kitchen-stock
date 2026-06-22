import { formatUserDisplay, todayLocal } from "./helpers.js";
import { renderReceivingSheet } from "./render.js";

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

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
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
    const requests = Array.isArray(displayRow?.requests)
      ? displayRow.requests.filter((request) => request?.id)
      : [];
    if (button.disabled) return;
    if (!requests.length) {
      setMessage("Could not find the receiving line to update.", true);
      return;
    }
    const quantityInput = row.querySelector(".receive-qty-input");
    let remainingQty = Number(quantityInput?.value || 0);
    if (!Number.isFinite(remainingQty) || remainingQty <= 0) {
      setMessage("Receive quantity must be greater than zero.", true);
      return;
    }
    button.disabled = true;
    button.classList.add("checked");
    button.innerHTML = "&#10003;";
    setMessage("Receiving item and updating stock...");
    try {
      const orderedRequests = [...requests].sort((left, right) => {
        const leftTime = new Date(left.requestedAt || 0).getTime();
        const rightTime = new Date(right.requestedAt || 0).getTime();
        return leftTime - rightTime;
      });
      for (const request of orderedRequests) {
        if (remainingQty <= 0) break;
        const requestQty = Number(request.quantity || 0);
        if (!Number.isFinite(requestQty) || requestQty <= 0) continue;
        const applyQty = Math.min(remainingQty, requestQty);
        await api(`/api/requests/${request.id}/deliver`, {
          method: "POST",
          body: JSON.stringify({
            quantityReceived: applyQty,
            receivedQuantity: applyQty,
            receiveQuantity: applyQty
          })
        });
        remainingQty -= applyQty;
      }
      if (remainingQty > 0 && orderedRequests.length) {
        setMessage("Received quantity was higher than the open quantity. Open lines were closed and stock was updated.");
      }
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
    const requests = Array.isArray(displayRow?.requests)
      ? displayRow.requests.filter((request) => request?.id)
      : [];
    if (!requests.length) {
      setMessage("Could not find the receiving line to remove.", true);
      return;
    }
    const itemName = displayRow?.itemName || "this item";
    const suffix = requests.length > 1 ? ` (${requests.length} open lines)` : "";
    if (!confirm(`Remove ${itemName}${suffix} from the receiving list?`)) return;
    if (!confirm(`Really remove ${itemName}? This cannot be undone.`)) return;

    button.disabled = true;
    setMessage(`Removing ${itemName}...`);
    try {
      for (const request of requests) {
        await api(`/api/requests/${request.id}`, { method: "DELETE" });
      }
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
  logoutButton.addEventListener("click", showLogin);

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
      localStorage.setItem("kitchenStockTheme", "light");
      window.applyKitchenTheme?.("light");
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
}
