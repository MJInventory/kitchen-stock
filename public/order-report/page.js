import {
  formatUserDisplay,
  todayLocal
} from "./helpers.js";
import {
  renderActivity,
  renderReport
} from "./render.js";
import { applyAuthenticatedShell, applyLoggedOutShell, persistKitchenSession, readKitchenSession } from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";
import { bindAuthenticatedBootstrap, bindLogoutButton } from "/session-bootstrap.js";

export function initOrderReportPage() {
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
  const reportViewToggle = document.querySelector("#reportViewToggle");
  const activityScopeToggle = document.querySelector("#activityScopeToggle");
  const activityScopeButton = document.querySelector("#activityScopeButton");
  const reportSummary = document.querySelector("#reportSummary");
  const reportList = document.querySelector("#reportList");
  const standingReportSummaryList = document.querySelector("#standingReportSummaryList");
  const standingReportList = document.querySelector("#standingReportList");
  const activitySummary = document.querySelector("#activitySummary");
  const activityReportList = document.querySelector("#activityReportList");

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
  let sessionPermissions = initialSession.permissions;
  let currentReportRows = [];
  let currentActivityEntries = [];
  let currentActivitySummary = {};
  let currentStandingOrders = [];
  let currentGuestCount = { guests: "", notes: "" };
  let activeReportFilter = "all";
  let activeActivityFilter = "all";
  let activeReportView = "status";
  let activeActivityScope = "all";

  function setMessage(text, isError = false) {
    reportMessage.textContent = text;
    reportMessage.classList.toggle("error", isError);
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
    const canAdmin = Boolean(sessionPermissions.canAdminUsers);
    guestCountField.hidden = !canAdmin;
    guestNotesField.hidden = !canAdmin;
    saveGuestsButton.hidden = !canAdmin;
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

  function renderReportViewState() {
    document.querySelectorAll("[data-report-view-section]").forEach((section) => {
      section.hidden = section.dataset.reportViewSection !== activeReportView;
    });
    reportViewToggle?.querySelectorAll("[data-report-view]").forEach((button) => {
      const active = button.dataset.reportView === activeReportView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (activityScopeToggle) activityScopeToggle.hidden = activeReportView !== "changes";
    if (activityScopeButton) {
      const receivedOnly = activeActivityScope === "received";
      activityScopeButton.classList.toggle("active", receivedOnly);
      activityScopeButton.setAttribute("aria-pressed", receivedOnly ? "true" : "false");
      activityScopeButton.textContent = receivedOnly ? "Showing: received items" : "Showing: all changes";
    }
  }

  async function loadReport() {
    setMessage("Loading report...");
    const data = await api(`/api/order-report?date=${encodeURIComponent(reportDate.value)}`);
    currentReportRows = Array.isArray(data.rows) ? data.rows : [];
    currentStandingOrders = Array.isArray(data.standingOrders) ? data.standingOrders : [];
    currentGuestCount = data.guestCount || { guests: "", notes: "" };
    currentActivityEntries = Array.isArray(data.activity) ? data.activity : [];
    currentActivitySummary = data.activitySummary || {};
    renderReport({
      data,
      reportList,
      printDate,
      guestCountInput,
      guestNotesInput,
      reportSummary,
      standingReportSummaryList,
      standingReportList,
      activitySummary,
      activityReportList,
      activeReportFilter,
      activeActivityFilter,
      activeActivityScope
    });
    renderReportViewState();
    setMessage("");
  }

  function updateReportFilter(filter) {
    activeReportFilter = filter || "all";
    renderReport({
      data: {
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
        activitySummary: currentActivitySummary,
        guestCount: currentGuestCount
      },
      reportList,
      printDate,
      guestCountInput,
      guestNotesInput,
      reportSummary,
      standingReportSummaryList,
      standingReportList,
      activitySummary,
      activityReportList,
      activeReportFilter,
      activeActivityFilter,
      activeActivityScope
    });
  }

  function updateActivityFilter(filter) {
    activeActivityFilter = filter || "all";
    renderActivity({
      entries: currentActivityEntries,
      summary: currentActivitySummary,
      activitySummary,
      activityReportList,
      activeActivityFilter,
      activeActivityScope
    });
  }

  function updateActivityScope(scope) {
    activeActivityScope = scope === "received" ? "received" : "all";
    renderReportViewState();
    renderActivity({
      entries: currentActivityEntries,
      summary: currentActivitySummary,
      activitySummary,
      activityReportList,
      activeActivityFilter,
      activeActivityScope
    });
  }

  function hideUndoDeliveryEntries(requestId) {
    const targetId = String(requestId || "").trim();
    if (!targetId) return;
    currentActivityEntries = currentActivityEntries.filter((entry) => {
      const entityId = String(entry?.entityId || entry?.entity_id || "").trim();
      const reason = String(entry?.reasonCode || "").trim();
      return entityId !== targetId || (reason !== "delivery-complete" && reason !== "delivery-partial");
    });
    renderActivity({
      entries: currentActivityEntries,
      summary: currentActivitySummary,
      activitySummary,
      activityReportList,
      activeActivityFilter,
      activeActivityScope
    });
  }

  function hideRemovedOrderEntries(auditId) {
    const targetId = Number(auditId || 0);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    currentActivityEntries = currentActivityEntries.filter((entry) => Number(entry?.id || 0) !== targetId);
    renderActivity({
      entries: currentActivityEntries,
      summary: currentActivitySummary,
      activitySummary,
      activityReportList,
      activeActivityFilter,
      activeActivityScope
    });
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
  reportViewToggle?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-view]");
    if (!button) return;
    activeReportView = button.dataset.reportView || "status";
    renderReportViewState();
  });
  activityScopeButton?.addEventListener("click", () => {
    updateActivityScope(activeActivityScope === "received" ? "all" : "received");
  });
  activityReportList?.addEventListener("click", async (event) => {
    const button = event.target.closest(".undo-delivery-button");
    if (button) {
      const requestId = button.dataset.requestId || "";
      if (!requestId) return;
      if (!window.confirm("Undo this received item? This will subtract the received quantity from stock and reopen the order.")) return;
      button.disabled = true;
      try {
        setMessage("Undoing received item...");
        await api(`/api/requests/${encodeURIComponent(requestId)}/undo-delivery`, { method: "POST" });
        await loadReport();
        hideUndoDeliveryEntries(requestId);
        setMessage("Received item was undone and the order was reopened.");
      } catch (error) {
        setMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }
    const restoreButton = event.target.closest(".undo-removed-button");
    if (!restoreButton) return;
    const auditId = restoreButton.dataset.auditId || "";
    if (!auditId) return;
    if (!window.confirm("Undo this removed item? This will restore the deleted order line.")) return;
    restoreButton.disabled = true;
    try {
      setMessage("Restoring removed item...");
      await api(`/api/requests/restore-from-audit/${encodeURIComponent(auditId)}`, { method: "POST" });
      await loadReport();
      hideRemovedOrderEntries(auditId);
      setMessage("Removed item was restored.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      restoreButton.disabled = false;
    }
  });
  bindLogoutButton(logoutButton, showLogin);

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
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      passwordInput.value = "";
      setLoginMessage("");
      showApp();
      await loadReport();
    }
  });

  bindAuthenticatedBootstrap({
    hasSession: () => Boolean(sessionToken && sessionUser),
    showApp,
    showLogin,
    load: loadReport,
    onError: (error) => setMessage(error.message, true)
  });
}
