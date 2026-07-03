import { formatUserDisplay } from "./helpers.js";
import { renderPickerBoard } from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell } from "/session-shell.js";

export function initPickerSheetPage() {
  const loginScreen = document.querySelector("#loginScreen");
  const loginForm = document.querySelector("#loginForm");
  const usernameInput = document.querySelector("#usernameInput");
  const passwordInput = document.querySelector("#passwordInput");
  const loginMessage = document.querySelector("#loginMessage");
  const currentUser = document.querySelector("#currentUser");
  const logoutButton = document.querySelector("#logoutButton");
  const refreshButton = document.querySelector("#refreshButton");
  const message = document.querySelector("#message");
  const pickerGroups = document.querySelector("#pickerGroups");

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let sessionPermissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
  let internalOrders = [];

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
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
  }

  function showLogin() {
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
    sessionPermissions = {};
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

  async function queueApi(path, options = {}, meta = {}) {
    if (!window.kitchenOfflineQueue?.request) return api(path, options);
    return window.kitchenOfflineQueue.request(path, options, {
      allowQueue: true,
      token: sessionToken,
      ...meta
    });
  }

  function render() {
    renderPickerBoard({ internalOrders, pickerGroups });
  }

  async function loadData() {
    setMessage("Loading picker board...");
    const data = await api("/api/internal-orders");
    internalOrders = data.internalOrders || [];
    render();
    setMessage("");
  }

  async function saveRequesterGroup(group) {
    const requester = group.querySelector(".daily-order-heading h2")?.textContent?.trim() || "picker";
    const batchCards = [...group.querySelectorAll("[data-batch-id]")];
    const payloads = batchCards
      .map((card) => ({
        batchId: card.dataset.batchId,
        lines: [...card.querySelectorAll("[data-line-id]")].map((row) => ({
          lineId: row.dataset.lineId,
          pickedItemQuantity: Number(row.querySelector(".picker-qty-input")?.value || 0),
          removeRequested: Boolean(row.querySelector(".picker-remove-input")?.checked)
        }))
      }))
      .filter((entry) => entry.batchId && entry.lines.length);

    if (!payloads.length) {
      setMessage("No picker lines found for this person.", true);
      return;
    }

    setMessage(`Saving picked items for ${requester}...`);
    try {
      let queuedOffline = false;
      for (const payload of payloads) {
        const result = await queueApi(`/api/internal-orders/${payload.batchId}/pick`, {
          method: "PATCH",
          body: JSON.stringify({ lines: payload.lines })
        }, {
          label: `Picker save for ${requester}`
        });
        queuedOffline = queuedOffline || Boolean(result?.offlineQueued);
      }
      if (queuedOffline) {
        setMessage(`Picker save for ${requester} is stored offline. It will sync automatically.`);
      } else {
        await loadData();
        setMessage(`Picker save complete for ${requester}. Shortages and automatic minimum restock orders were updated.`);
      }
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  pickerGroups.addEventListener("input", (event) => {
    const input = event.target.closest(".picker-qty-input");
    if (!input) return;
    const row = input.closest("[data-line-id]");
    if (!row) return;
    const max = Number(input.max || 0);
    const value = Math.max(0, Math.min(max, Number(input.value || 0)));
    input.value = value;
    const shortage = Math.max(0, max - value);
    const label = row.querySelector(".picker-line-shortage strong");
    if (label) label.textContent = `${shortage} item(s)`;
  });

  pickerGroups.addEventListener("change", (event) => {
    const toggle = event.target.closest(".picker-remove-input");
    if (!toggle) return;
    const row = toggle.closest("[data-line-id]");
    if (!row) return;
    row.classList.toggle("remove-requested", toggle.checked);
  });

  pickerGroups.addEventListener("click", (event) => {
    const button = event.target.closest(".save-requester-group");
    if (!button) return;
    const group = button.closest(".picker-requester-group");
    if (!group) return;
    saveRequesterGroup(group);
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginMessage("Logging in...");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
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
      if (!sessionPermissions.canPickInternalOrders) throw new Error("This user is not allowed to pick internal requests.");
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      showApp();
      await loadData();
      setLoginMessage("");
    } catch (error) {
      setLoginMessage(error.message, true);
    }
  });

  logoutButton.addEventListener("click", showLogin);
  refreshButton?.addEventListener("click", () => loadData().catch((error) => setMessage(error.message, true)));
  window.addEventListener("kitchen-offline-queue-synced", () => {
    loadData().catch((error) => setMessage(error.message, true));
  });

  if (sessionToken && sessionUser) {
    showApp();
    loadData().catch((error) => setMessage(error.message, true));
  } else {
    showLogin();
  }
}
