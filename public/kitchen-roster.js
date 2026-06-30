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
  const shiftAdminToggleButton = document.querySelector("#shiftAdminToggleButton");
  const printButton = document.querySelector("#printRosterButton");
  const message = document.querySelector("#rosterMessage");
  const lockMessage = document.querySelector("#rosterLockMessage");
  const weekRange = document.querySelector("#weekRange");
  const shiftLegend = document.querySelector("#shiftLegend");
  const rosterGrid = document.querySelector("#rosterGrid");
  const shiftAdminPanel = document.querySelector("#shiftAdminPanel");
  const shiftAdminForm = document.querySelector("#shiftAdminForm");
  const shiftAdminLabel = document.querySelector("#shiftAdminLabel");
  const shiftAdminCode = document.querySelector("#shiftAdminCode");
  const shiftAdminGroup = document.querySelector("#shiftAdminGroup");
  const shiftAdminColor = document.querySelector("#shiftAdminColor");
  const shiftAdminSortOrder = document.querySelector("#shiftAdminSortOrder");
  const shiftAdminMessage = document.querySelector("#shiftAdminMessage");
  const shiftAdminList = document.querySelector("#shiftAdminList");
  const shiftAdminResetButton = document.querySelector("#shiftAdminResetButton");
  const SHIFT_COLOR_FALLBACKS = [
    { value: "#fff1b8", label: "Soft Gold" },
    { value: "#c7f9d4", label: "Mint" },
    { value: "#c7f3f8", label: "Aqua" },
    { value: "#d9ecff", label: "Sky" },
    { value: "#ffd9df", label: "Rose" },
    { value: "#ffe8c7", label: "Peach" },
    { value: "#e9defa", label: "Lavender" },
    { value: "#e5ffc7", label: "Lime" },
    { value: "#fde68a", label: "Honey" },
    { value: "#bfdbfe", label: "Powder Blue" },
    { value: "#fecdd3", label: "Blush" },
    { value: "#20242c", label: "Night" }
  ];

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
  let rosterData = null;
  let rosterDirty = false;
  let canManageRoster = false;
  let shiftAdminData = { shiftTypes: [], colorOptions: [] };
  let editingShiftId = "";

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

  function colorBrightness(hex) {
    const color = safeCssColor(hex);
    if (!/^#[0-9a-f]{6}$/i.test(color)) return 255;
    const value = color.slice(1);
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return ((red * 299) + (green * 587) + (blue * 114)) / 1000;
  }

  function contrastInk(hex) {
    return colorBrightness(hex) < 145 ? "#f8fafc" : "#111827";
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
    select.style.color = contrastInk(shift?.color || "");
  }

  function setShiftAdminMessage(text, isError = false) {
    if (!shiftAdminMessage) return;
    shiftAdminMessage.textContent = text || "";
    shiftAdminMessage.classList.toggle("error", Boolean(isError));
  }

  function closeShiftAdminPanel() {
    if (!shiftAdminPanel || !shiftAdminToggleButton) return;
    shiftAdminPanel.hidden = true;
    shiftAdminToggleButton.textContent = "Shift Admin";
    editingShiftId = "";
    resetShiftAdminForm();
  }

  function shiftGroupLabel(value) {
    const labels = {
      kitchen: "Kitchen Shift",
      foh: "FOH Shift",
      bar: "Bar Shift",
      other: "Others"
    };
    return labels[String(value || "").trim().toLowerCase()] || "Kitchen Shift";
  }

  function shiftAdminColorOptions(selectedColor = "") {
    const selected = safeCssColor(selectedColor).toLowerCase();
    const fallbackMap = new Map(
      SHIFT_COLOR_FALLBACKS.map((entry) => [String(entry.value || "").toLowerCase(), entry])
    );
    const apiOptions = Array.isArray(shiftAdminData.colorOptions) ? shiftAdminData.colorOptions : [];
    for (const entry of apiOptions) {
      const value = String(entry?.value || "").toLowerCase();
      if (value) fallbackMap.set(value, entry);
    }
    const options = [...fallbackMap.values()];
    if (selected && !options.some((entry) => String(entry?.value || "").toLowerCase() === selected)) {
      options.unshift({ value: selected, label: `Current ${selected}` });
    }
    return options
      .map((entry) => {
        const value = safeCssColor(entry?.value || "");
        const label = String(entry?.label || value).trim() || value;
        return `<option value="${escapeHtml(value)}" data-color="${escapeHtml(value)}" style="background:${escapeHtml(value)}; color:${escapeHtml(contrastInk(value))};"${value.toLowerCase() === selected ? " selected" : ""}>${escapeHtml(label)} - ${escapeHtml(value)}</option>`;
      })
      .join("");
  }

  function applyColorSelectAppearance(select) {
    if (!select) return;
    const color = safeCssColor(select.value || select.selectedOptions?.[0]?.dataset?.color || "");
    select.style.backgroundColor = color || "";
    select.style.color = contrastInk(color || "");
  }

  function resetShiftAdminForm() {
    if (!shiftAdminForm) return;
    shiftAdminLabel.value = "";
    shiftAdminCode.value = "";
    shiftAdminGroup.value = "kitchen";
    shiftAdminColor.innerHTML = shiftAdminColorOptions("#c7f9d4");
    shiftAdminColor.value = "#c7f9d4";
    applyColorSelectAppearance(shiftAdminColor);
    shiftAdminSortOrder.value = "100";
    editingShiftId = "";
    setShiftAdminMessage("");
  }

  function renderShiftAdminList() {
    if (!shiftAdminList) return;
    const shifts = Array.isArray(shiftAdminData.shiftTypes) ? shiftAdminData.shiftTypes : [];
    if (!shifts.length) {
      shiftAdminList.innerHTML = "<p>No shifts saved yet.</p>";
      return;
    }
    shiftAdminList.innerHTML = `
      <table class="roster-shift-admin-table">
        <thead>
          <tr>
            <th>Shift</th>
            <th>Type</th>
            <th>Color</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${shifts.map((shift) => {
            const isEditing = shift.id === editingShiftId;
            if (isEditing) {
              return `
                <tr class="shift-admin-editing-row" data-shift-id="${escapeHtml(shift.id)}">
                  <td>
                    <input class="shift-admin-inline-label" type="text" value="${escapeHtml(shift.label || "")}" maxlength="80">
                    <span><input class="shift-admin-inline-code" type="text" value="${escapeHtml(shift.code || "")}" maxlength="40"></span>
                  </td>
                  <td>
                    <select class="shift-admin-inline-group">
                      <option value="kitchen"${String(shift.shift_group || "").toLowerCase() === "kitchen" ? " selected" : ""}>Kitchen Shift</option>
                      <option value="foh"${String(shift.shift_group || "").toLowerCase() === "foh" ? " selected" : ""}>FOH Shift</option>
                      <option value="bar"${String(shift.shift_group || "").toLowerCase() === "bar" ? " selected" : ""}>Bar Shift</option>
                      <option value="other"${String(shift.shift_group || "").toLowerCase() === "other" ? " selected" : ""}>Others</option>
                    </select>
                  </td>
                  <td>
                    <select class="shift-admin-inline-color">
                      ${shiftAdminColorOptions(shift.color || "#c7f9d4")}
                    </select>
                    <span><input class="shift-admin-inline-sort" type="number" min="0" step="1" value="${escapeHtml(String(shift.sort_order ?? 100))}"></span>
                  </td>
                  <td>
                    <label class="checkbox shift-admin-inline-active">
                      <input class="shift-admin-inline-active-input" type="checkbox"${shift.active === false ? "" : " checked"}>
                      <span>${shift.active === false ? "Inactive" : "Active"}</span>
                    </label>
                  </td>
                  <td class="shift-admin-row-actions">
                    <button type="button" class="shift-admin-save-row" data-shift-id="${escapeHtml(shift.id)}">Save</button>
                    <button type="button" class="secondary shift-admin-cancel-row">Cancel</button>
                    <button type="button" class="danger-soft shift-admin-delete-row" data-shift-id="${escapeHtml(shift.id)}">Delete</button>
                  </td>
                </tr>
              `;
            }
            return `
              <tr data-shift-id="${escapeHtml(shift.id)}">
                <td>
                  <strong>${escapeHtml(shift.label || "")}</strong>
                  <span>${escapeHtml(shift.code || "")}</span>
                </td>
                <td>${escapeHtml(shiftGroupLabel(shift.shift_group))}</td>
                <td>
                  <span class="shift-admin-swatch" style="background:${escapeHtml(safeCssColor(shift.color))}; color:${escapeHtml(contrastInk(shift.color))}">${escapeHtml(safeCssColor(shift.color))}</span>
                </td>
                <td>${shift.active === false ? "Inactive" : "Active"}</td>
                <td class="shift-admin-row-actions">
                  <button type="button" class="secondary shift-admin-edit-button" data-shift-id="${escapeHtml(shift.id)}">Edit</button>
                  <button type="button" class="danger-soft shift-admin-delete-row" data-shift-id="${escapeHtml(shift.id)}">Delete</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
    shiftAdminList.querySelectorAll(".shift-admin-edit-button").forEach((button) => {
      button.addEventListener("click", () => {
        editingShiftId = button.dataset.shiftId || "";
        renderShiftAdminList();
      });
    });
    shiftAdminList.querySelectorAll(".shift-admin-inline-color").forEach((select) => {
      applyColorSelectAppearance(select);
      select.addEventListener("change", () => applyColorSelectAppearance(select));
    });
    shiftAdminList.querySelectorAll(".shift-admin-save-row").forEach((button) => {
      button.addEventListener("click", () => saveShiftRow(button.dataset.shiftId).catch((error) => setShiftAdminMessage(error.message, true)));
    });
    shiftAdminList.querySelectorAll(".shift-admin-cancel-row").forEach((button) => {
      button.addEventListener("click", () => {
        editingShiftId = "";
        renderShiftAdminList();
      });
    });
    shiftAdminList.querySelectorAll(".shift-admin-delete-row").forEach((button) => {
      button.addEventListener("click", () => deactivateShift(button.dataset.shiftId).catch((error) => setShiftAdminMessage(error.message, true)));
    });
  }

  async function loadShiftAdminData() {
    if (!canManageRoster) return;
    setShiftAdminMessage("Loading shifts...");
    shiftAdminData = await api("/api/kitchen-roster/shifts");
    renderShiftAdminList();
    shiftAdminColor.innerHTML = shiftAdminColorOptions("#c7f9d4");
    applyColorSelectAppearance(shiftAdminColor);
    resetShiftAdminForm();
    setShiftAdminMessage("");
  }

  async function saveShiftAdminForm() {
    if (!canManageRoster) {
      setShiftAdminMessage("Only admins can manage shifts.", true);
      return;
    }
    setShiftAdminMessage("Saving shift...");
    shiftAdminData = await api("/api/kitchen-roster/shifts", {
      method: "POST",
      body: JSON.stringify({
        label: shiftAdminLabel.value,
        code: shiftAdminCode.value,
        shiftGroup: shiftAdminGroup.value,
        color: shiftAdminColor.value,
        sortOrder: shiftAdminSortOrder.value,
        active: true
      })
    });
    renderShiftAdminList();
    resetShiftAdminForm();
    setShiftAdminMessage("Shift saved.");
    if (rosterData && !rosterDirty) {
      rosterData = await api(`/api/kitchen-roster?date=${encodeURIComponent(rosterData.weekStart)}`);
      renderRoster();
      setMessage("Shift saved and roster refreshed.");
    } else if (rosterDirty) {
      setMessage("Shift saved. Reload the week after saving your roster changes to use the new shift list.");
    }
    closeShiftAdminPanel();
  }

  async function saveShiftRow(shiftId) {
    const row = shiftAdminList.querySelector(`tr[data-shift-id="${CSS.escape(shiftId || "")}"]`);
    if (!row) return;
    setShiftAdminMessage("Saving shift...");
    const payload = {
      id: shiftId,
      label: row.querySelector(".shift-admin-inline-label")?.value || "",
      code: row.querySelector(".shift-admin-inline-code")?.value || "",
      shiftGroup: row.querySelector(".shift-admin-inline-group")?.value || "kitchen",
      color: row.querySelector(".shift-admin-inline-color")?.value || "#c7f9d4",
      sortOrder: row.querySelector(".shift-admin-inline-sort")?.value || "100",
      active: Boolean(row.querySelector(".shift-admin-inline-active-input")?.checked)
    };
    shiftAdminData = await api("/api/kitchen-roster/shifts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    editingShiftId = "";
    renderShiftAdminList();
    setShiftAdminMessage("Shift saved.");
    if (rosterData && !rosterDirty) {
      rosterData = await api(`/api/kitchen-roster?date=${encodeURIComponent(rosterData.weekStart)}`);
      renderRoster();
      setMessage("Shift saved and roster refreshed.");
    }
    closeShiftAdminPanel();
  }

  async function deactivateShift(shiftId) {
    const shift = (shiftAdminData.shiftTypes || []).find((entry) => entry.id === shiftId);
    if (!shift) return;
    if (!window.confirm(`Delete "${shift.label}" from future use? Existing roster history will keep it.`)) return;
    setShiftAdminMessage("Deleting shift...");
    shiftAdminData = await api("/api/kitchen-roster/shifts", {
      method: "POST",
      body: JSON.stringify({
        id: shift.id,
        label: shift.label,
        code: shift.code,
        shiftGroup: shift.shift_group,
        color: shift.color,
        sortOrder: shift.sort_order,
        active: false
      })
    });
    if (editingShiftId === shiftId) editingShiftId = "";
    renderShiftAdminList();
    setShiftAdminMessage("Shift deleted from future use.");
    if (rosterData && !rosterDirty) {
      rosterData = await api(`/api/kitchen-roster?date=${encodeURIComponent(rosterData.weekStart)}`);
      renderRoster();
      setMessage("Shift deleted and roster refreshed.");
    }
    closeShiftAdminPanel();
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
    const readOnly = !canManageRoster;
    if (shiftAdminToggleButton) {
      shiftAdminToggleButton.hidden = readOnly;
    }
    if (lockButton) {
      lockButton.hidden = !rosterData || readOnly;
      lockButton.textContent = locked ? "Unlock Week" : "Lock Week";
      lockButton.classList.toggle("danger-soft", locked);
    }
    if (lockMessage) {
      const lockText = locked
        ? `Roster is locked${rosterData?.lockedBy ? ` by ${formatDisplayName(rosterData.lockedBy)}` : ""}. Unlock this week before changing shifts.`
        : "Read-only access. Only Admin and God users can change this roster.";
      lockMessage.hidden = !locked && !readOnly;
      lockMessage.textContent = readOnly ? lockText : (locked ? lockText : "");
    }
    if (saveButton) {
      saveButton.disabled = locked || !rosterData || readOnly;
      saveButton.hidden = readOnly;
    }
    rosterGrid.querySelectorAll(".roster-shift-select").forEach((select) => {
      select.disabled = locked || readOnly;
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
    if (!canManageRoster) {
      setMessage("You can view the roster, but only Admin and God users can change it.", true);
      return;
    }
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
    if (!canManageRoster) {
      setMessage("Only Admin and God users can lock or unlock the roster.", true);
      return;
    }
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
      if (!me.user?.permissions?.canViewKitchenRoster) {
        throw new Error("You do not have access to the kitchen roster.");
      }
      canManageRoster = Boolean(me.user?.permissions?.canManageKitchenRoster);
      showApp();
      if (canManageRoster) {
        resetShiftAdminForm();
        await loadShiftAdminData();
      }
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
  shiftAdminToggleButton?.addEventListener("click", () => {
    if (!canManageRoster) return;
    const nextHidden = !shiftAdminPanel.hidden;
    shiftAdminPanel.hidden = nextHidden;
    shiftAdminToggleButton.textContent = nextHidden ? "Shift Admin" : "Hide Shift Admin";
    if (!nextHidden && !shiftAdminData.shiftTypes.length) {
      loadShiftAdminData().catch((error) => setShiftAdminMessage(error.message, true));
    }
  });
  shiftAdminForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveShiftAdminForm().catch((error) => setShiftAdminMessage(error.message, true));
  });
  shiftAdminResetButton?.addEventListener("click", () => resetShiftAdminForm());
  shiftAdminColor?.addEventListener("change", () => applyColorSelectAppearance(shiftAdminColor));
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
