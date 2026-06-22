(function initKitchenRosterPage() {
  const loginScreen = document.querySelector("#loginScreen");
  const loginForm = document.querySelector("#loginForm");
  const usernameInput = document.querySelector("#usernameInput");
  const passwordInput = document.querySelector("#passwordInput");
  const loginMessage = document.querySelector("#loginMessage");
  const currentUser = document.querySelector("#currentUser");
  const weekDate = document.querySelector("#weekDate");
  const loadButton = document.querySelector("#loadRosterButton");
  const saveButton = document.querySelector("#saveRosterButton");
  const printButton = document.querySelector("#printRosterButton");
  const message = document.querySelector("#rosterMessage");
  const weekRange = document.querySelector("#weekRange");
  const shiftLegend = document.querySelector("#shiftLegend");
  const rosterGrid = document.querySelector("#rosterGrid");

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
  let rosterData = null;

  function setMessage(text, isError = false) {
    message.textContent = text || "";
    message.classList.toggle("error", Boolean(isError));
  }

  function setLoginMessage(text, isError = false) {
    loginMessage.textContent = text || "";
    loginMessage.classList.toggle("error", Boolean(isError));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function formatDisplayName(value) {
    return String(value || "").trim().replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function toDisplayDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function saveSession(data) {
    sessionToken = data.token;
    sessionUser = data.user.name;
    permissions = data.user.permissions || {};
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockRole", data.user.role || "user");
    localStorage.setItem("kitchenStockPermissions", JSON.stringify(permissions));
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    window.refreshKitchenMenus?.();
  }

  function showLogin() {
    loginScreen.hidden = false;
    sessionToken = "";
    sessionUser = "";
    localStorage.removeItem("kitchenStockToken");
    localStorage.removeItem("kitchenStockUser");
    localStorage.removeItem("kitchenStockRole");
    localStorage.removeItem("kitchenStockPermissions");
  }

  function showApp() {
    loginScreen.hidden = true;
    currentUser.textContent = sessionUser ? formatDisplayName(sessionUser) : "";
    window.refreshKitchenMenus?.();
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
    if (response.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") window.location.href = "/change-password.html";
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function shiftById(id) {
    return rosterData?.shiftTypes?.find((shift) => shift.id === id) || null;
  }

  function updateSelectColor(select) {
    const shift = shiftById(select.value);
    select.style.backgroundColor = shift?.color || "";
    select.style.color = String(shift?.code || "").toUpperCase() === "OFF" ? "#f8fafc" : "#111827";
  }

  function renderLegend() {
    shiftLegend.innerHTML = (rosterData.shiftTypes || []).map((shift) => `
      <article class="shift-type-card">
        <span class="shift-dot" style="background:${escapeHtml(shift.color)}"></span>
        <strong>${escapeHtml(shift.label)}</strong>
      </article>
    `).join("");
  }

  function renderRoster() {
    if (!rosterData) return;
    weekRange.textContent = `${rosterData.weekStart} - ${rosterData.weekEnd}`;
    renderLegend();

    const shiftMap = new Map();
    (rosterData.shifts || []).forEach((shift) => {
      shiftMap.set(`${shift.user_id || shift.userId}:${String(shift.shift_date || shift.shiftDate).slice(0, 10)}`, shift);
    });

    if (!rosterData.staff?.length) {
      rosterGrid.innerHTML = "<p>No active kitchen staff found. Mark users as Kitchen Staff in User Administration first.</p>";
      return;
    }

    const options = (selectedId) => (rosterData.shiftTypes || []).map((shift) =>
      `<option value="${escapeHtml(shift.id)}"${shift.id === selectedId ? " selected" : ""}>${escapeHtml(shift.label)}</option>`
    ).join("");

    rosterGrid.innerHTML = `
      <table class="kitchen-roster-table">
        <thead>
          <tr>
            <th>Brigade</th>
            ${rosterData.days.map((day) => `<th>${escapeHtml(day.label)}<span>${escapeHtml(toDisplayDate(day.date))}</span></th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rosterData.staff.map((staff) => `
            <tr>
              <th>
                <strong>${escapeHtml(staff.display_name || staff.username)}</strong>
                <span>${escapeHtml(staff.kitchen_function || "Other")}</span>
              </th>
              ${rosterData.days.map((day) => {
                const shift = shiftMap.get(`${staff.id}:${day.date}`);
                return `
                  <td>
                    <select class="roster-shift-select" data-user-id="${escapeHtml(staff.id)}" data-shift-date="${escapeHtml(day.date)}">
                      ${options(shift?.shift_type_id)}
                    </select>
                  </td>
                `;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    rosterGrid.querySelectorAll(".roster-shift-select").forEach((select) => {
      updateSelectColor(select);
      select.addEventListener("change", () => updateSelectColor(select));
    });
  }

  async function loadRoster() {
    setMessage("Loading roster...");
    rosterData = await api(`/api/kitchen-roster?date=${encodeURIComponent(weekDate.value || todayIso())}`);
    renderRoster();
    setMessage("Roster loaded.");
  }

  async function saveRoster() {
    if (!rosterData) return;
    saveButton.disabled = true;
    setMessage("Saving roster...");
    const shifts = Array.from(rosterGrid.querySelectorAll(".roster-shift-select")).map((select) => ({
      userId: select.dataset.userId,
      shiftDate: select.dataset.shiftDate,
      shiftTypeId: select.value
    }));
    rosterData = await api("/api/kitchen-roster", {
      method: "POST",
      body: JSON.stringify({ weekStart: rosterData.weekStart, shifts })
    });
    renderRoster();
    setMessage("Roster saved.");
    saveButton.disabled = false;
  }

  async function bootstrap() {
    try {
      const me = await api("/api/me");
      if (me.token) saveSession(me);
      if (!me.user?.permissions?.canManageKitchenRoster) {
        throw new Error("Only admins marked as Kitchen Staff can manage the kitchen roster.");
      }
      showApp();
      await loadRoster();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

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
      saveSession(data);
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      passwordInput.value = "";
      showApp();
      await bootstrap();
    } catch (error) {
      setLoginMessage(error.message, true);
    }
  });

  loadButton.addEventListener("click", () => loadRoster().catch((error) => setMessage(error.message, true)));
  saveButton.addEventListener("click", () => saveRoster().catch((error) => {
    saveButton.disabled = false;
    setMessage(error.message, true);
  }));
  printButton.addEventListener("click", () => window.print());

  weekDate.value = todayIso();
  if (sessionToken && sessionUser) {
    showApp();
    bootstrap();
  } else {
    showLogin();
  }
}());
