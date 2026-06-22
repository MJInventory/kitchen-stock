import {
  formatUserDisplay,
  todayLocal
} from "./helpers.js";
import {
  renderActivity,
  renderReport
} from "./render.js";

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
  let currentActivitySummary = {};
  let currentStandingOrders = [];
  let currentGuestCount = { guests: "", notes: "" };
  let activeReportFilter = "all";
  let activeActivityFilter = "all";

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
      activeActivityFilter
    });
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
      activeActivityFilter
    });
  }

  function updateActivityFilter(filter) {
    activeActivityFilter = filter || "all";
    renderActivity({
      entries: currentActivityEntries,
      summary: currentActivitySummary,
      activitySummary,
      activityReportList,
      activeActivityFilter
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
  activityReportList?.addEventListener("click", async (event) => {
    const button = event.target.closest(".undo-delivery-button");
    if (!button) return;
    const requestId = button.dataset.requestId || "";
    if (!requestId) return;
    if (!window.confirm("Undo this received item? This will subtract the received quantity from stock and reopen the order.")) return;
    button.disabled = true;
    try {
      setMessage("Undoing received item...");
      await api(`/api/requests/${encodeURIComponent(requestId)}/undo-delivery`, { method: "POST" });
      await loadReport();
      setMessage("Received item was undone and the order was reopened.");
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
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
}
