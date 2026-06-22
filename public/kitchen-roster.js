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
  const lockButton = document.querySelector("#lockRosterButton");
  const printButton = document.querySelector("#printRosterButton");
  const message = document.querySelector("#rosterMessage");
  const lockMessage = document.querySelector("#rosterLockMessage");
  const weekRange = document.querySelector("#weekRange");
  const shiftLegend = document.querySelector("#shiftLegend");
  const rosterGrid = document.querySelector("#rosterGrid");

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
  let rosterData = null;
  let rosterDirty = false;

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

  function safeCssColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{3,8}$/i.test(color) ? color : "";
  }

  function normalizeFunction(value) {
    return String(value || "Other").trim() || "Other";
  }

  function functionColor(value) {
    const key = normalizeFunction(value).toLowerCase();
    const colors = {
      chef: "#f8d7da",
      "sous-chef": "#fff1b8",
      "line cook": "#d8f3dc",
      "kitchen helper": "#d9ecff",
      dishwasher: "#eadcff",
      "pickup waiter": "#ffe8c7",
      other: "#e5e7eb"
    };
    return colors[key] || colors.other;
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
    localStorage.setItem("kitchenStockTheme", "light");
    window.applyKitchenTheme?.("light");
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

  function setRosterDirty(isDirty) {
    rosterDirty = Boolean(isDirty);
    saveButton.classList.toggle("attention", rosterDirty);
    if (rosterDirty) {
      setMessage("Unsaved changes. Save the week before leaving.");
    }
  }

  function confirmLeaveIfDirty() {
    if (!rosterDirty) return true;
    return window.confirm("You have unsaved roster changes. Leave without saving?");
  }
  window.confirmNavigationAllowed = confirmLeaveIfDirty;

  function applyRosterLockState() {
    const locked = Boolean(rosterData?.locked);
    if (lockButton) {
      lockButton.hidden = !rosterData;
      lockButton.textContent = locked ? "Unlock Week" : "Lock Week";
      lockButton.classList.toggle("danger-soft", locked);
    }
    if (lockMessage) {
      lockMessage.hidden = !locked;
      lockMessage.textContent = locked
        ? `Roster is locked${rosterData?.lockedBy ? ` by ${formatDisplayName(rosterData.lockedBy)}` : ""}. Unlock this week before changing shifts.`
        : "";
    }
    if (saveButton) saveButton.disabled = locked || !rosterData;
    rosterGrid.querySelectorAll(".roster-shift-select").forEach((select) => {
      select.disabled = locked;
    });
  }

  function renderLegend() {
    shiftLegend.innerHTML = (rosterData.shiftTypes || []).map((shift) => `
      <article class="shift-type-card">
        <span class="shift-dot" style="background:${escapeHtml(safeCssColor(shift.color))}"></span>
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
    const functionLegend = [...new Map((rosterData.staff || []).map((staff) => {
      const label = normalizeFunction(staff.kitchen_function);
      return [label.toLowerCase(), { label, color: functionColor(label) }];
    })).values()];

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
              <th class="roster-function-cell" style="--function-bg:${escapeHtml(functionColor(staff.kitchen_function))}">
                <strong>${escapeHtml(staff.display_name || staff.username)}</strong>
              </th>
              ${rosterData.days.map((day) => {
                const shift = shiftMap.get(`${staff.id}:${day.date}`);
                const selectedShift = shiftById(shift?.shift_type_id) || shift;
                const shiftColor = safeCssColor(selectedShift?.color || selectedShift?.shift_color);
                const shiftCode = selectedShift?.code || selectedShift?.shift_code || "";
                return `
                  <td class="roster-shift-cell" data-shift-code="${escapeHtml(shiftCode)}" style="${shiftColor ? `--shift-bg:${escapeHtml(shiftColor)}; background:${escapeHtml(shiftColor)};` : ""}">
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
      <div class="roster-function-legend">
        ${functionLegend.map((item) => `
          <span><i style="background:${escapeHtml(item.color)}"></i>${escapeHtml(item.label)}</span>
        `).join("")}
      </div>
    `;
    rosterGrid.querySelectorAll(".roster-shift-select").forEach((select) => {
      updateSelectColor(select);
      select.addEventListener("change", () => {
        updateSelectColor(select);
        setRosterDirty(true);
      });
    });
    applyRosterLockState();
  }

  async function loadRoster() {
    if (!confirmLeaveIfDirty()) return;
    setMessage("Loading roster...");
    rosterData = await api(`/api/kitchen-roster?date=${encodeURIComponent(weekDate.value || todayIso())}`);
    renderRoster();
    setRosterDirty(false);
    setMessage("Roster loaded.");
  }

  async function saveRoster() {
    if (!rosterData) return;
    if (rosterData.locked) {
      setMessage("Roster week is locked. Unlock it before saving changes.", true);
      return;
    }
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
    setRosterDirty(false);
    setMessage("Roster saved.");
    saveButton.disabled = false;
    applyRosterLockState();
  }

  async function toggleRosterLock() {
    if (!rosterData) return;
    if (!confirmLeaveIfDirty()) return;
    const nextLocked = !rosterData.locked;
    const prompt = nextLocked
      ? "Lock this roster week? Nobody can change shifts until it is unlocked."
      : "Unlock this roster week so shifts can be changed?";
    if (!window.confirm(prompt)) return;
    rosterData = await api("/api/kitchen-roster/lock", {
      method: "POST",
      body: JSON.stringify({ weekStart: rosterData.weekStart, locked: nextLocked })
    });
    renderRoster();
    setRosterDirty(false);
    setMessage(nextLocked ? "Roster locked." : "Roster unlocked.");
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
    applyRosterLockState();
    setMessage(error.message, true);
  }));
  lockButton?.addEventListener("click", () => toggleRosterLock().catch((error) => setMessage(error.message, true)));
  printButton.addEventListener("click", () => {
    const footer = document.querySelector("#rosterPrintFooter");
    if (footer) {
      footer.textContent = `Printed ${new Date().toLocaleString()} by ${formatDisplayName(sessionUser) || "Unknown"}`;
    }
    window.print();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!rosterDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  weekDate.value = todayIso();
  if (sessionToken && sessionUser) {
    showApp();
    bootstrap();
  } else {
    showLogin();
  }
}());
