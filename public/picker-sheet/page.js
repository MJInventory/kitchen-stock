import { formatUserDisplay } from "./helpers.js";
import { renderPickerBoard } from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell, persistKitchenSession, readKitchenSession } from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";
import { bindAuthenticatedBootstrap, bindLogoutButton } from "/session-bootstrap.js";

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

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
  let sessionPermissions = initialSession.permissions;
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

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      window.location.href = "/change-password.html";
    }
  });

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

  bindKitchenLogin({
    loginForm,
    usernameInput,
    passwordInput,
    setLoginMessage,
    onSuccess: async (data) => {
      const saved = persistKitchenSession(data, {
        currentToken: sessionToken,
        applyTheme: window.applyKitchenTheme
      });
      sessionToken = saved.token;
      sessionUser = saved.user;
      sessionPermissions = saved.permissions;
      if (!sessionPermissions.canPickInternalOrders) throw new Error("This user is not allowed to pick internal requests.");
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      showApp();
      await loadData();
      setLoginMessage("");
    }
  });

  bindLogoutButton(logoutButton, showLogin);
  refreshButton?.addEventListener("click", () => loadData().catch((error) => setMessage(error.message, true)));
  window.addEventListener("kitchen-offline-queue-synced", () => {
    loadData().catch((error) => setMessage(error.message, true));
  });

  bindAuthenticatedBootstrap({
    hasSession: () => Boolean(sessionToken && sessionUser),
    showApp,
    showLogin,
    load: loadData,
    onError: (error) => setMessage(error.message, true)
  });
}
