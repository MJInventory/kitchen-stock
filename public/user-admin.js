const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const userList = document.querySelector("#userList");
const newUserForm = document.querySelector("#newUserForm");
const adminMessage = document.querySelector("#adminMessage");
const userSearch = document.querySelector("#userSearch");
const roleFilter = document.querySelector("#roleFilter");
const statusFilter = document.querySelector("#statusFilter");
const userCount = document.querySelector("#userCount");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
let allUsers = [];

function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
      .join("-"))
    .join(" ");
}

function formatLastLogin(value) {
  if (!value) return "Never logged in";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Last login: ${value}`;
  return `Last login: ${date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function setMessage(text, isError = false) {
  adminMessage.textContent = text;
  adminMessage.classList.toggle("error", isError);
}

function setLoginMessage(text, isError = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function roleLabel(role) {
  return role === "god" ? "God"
    : role === "admin" ? "Admin"
    : role === "power-user" ? "Power User"
    : role === "staff" ? "Staff"
    : "User";
}

function matchesSearch(user, term) {
  if (!term) return true;
  const haystack = [
    user.name,
    roleLabel(user.role),
    user.isDriver ? "driver" : "",
    user.isPicker ? "picker" : "",
    user.active ? "active" : "inactive",
    user.mustChangePassword ? "password change" : "",
    user.notifyOnNewOrders ? "new orders" : "",
    user.notifyOnDelivery ? "delivery" : ""
  ].join(" ").toLowerCase();
  return haystack.includes(term);
}

function filterUsers(users) {
  const term = (userSearch?.value || "").trim().toLowerCase();
  const wantedRole = roleFilter?.value || "all";
  const wantedStatus = statusFilter?.value || "all";
  return users.filter((user) => {
    if (wantedRole !== "all" && user.role !== wantedRole) return false;
    if (wantedStatus === "active" && !user.active) return false;
    if (wantedStatus === "inactive" && user.active) return false;
    if (wantedStatus === "must-change" && !user.mustChangePassword) return false;
    if (wantedStatus === "drivers" && !user.isDriver) return false;
    if (wantedStatus === "pickers" && !user.isPicker) return false;
    return matchesSearch(user, term);
  });
}

function updateUserCount(filtered, total) {
  if (!userCount) return;
  if (!total) {
    userCount.textContent = "No users found yet.";
    return;
  }
  userCount.textContent = filtered === total
    ? `${total} user${total === 1 ? "" : "s"} shown.`
    : `${filtered} of ${total} user${total === 1 ? "" : "s"} shown.`;
}

function userMetaBadges(user) {
  return [
    `<span class="user-meta-pill role">${escapeHtml(roleLabel(user.role))}</span>`,
    user.active ? `<span class="user-meta-pill ok">Active</span>` : `<span class="user-meta-pill muted">Inactive</span>`,
    user.mustChangePassword ? `<span class="user-meta-pill warn">Change password</span>` : "",
    user.isDriver ? `<span class="user-meta-pill accent">Driver</span>` : "",
    user.isPicker ? `<span class="user-meta-pill accent">Picker</span>` : "",
    user.notifyOnNewOrders ? `<span class="user-meta-pill info">Order alerts</span>` : "",
    user.notifyOnDelivery ? `<span class="user-meta-pill info">Delivery alerts</span>` : ""
  ].filter(Boolean).join("");
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
  window.setupKitchenPush?.();
}

function showApp() {
  loginScreen.hidden = true;
  const role = localStorage.getItem("kitchenStockRole") || "user";
  currentUser.textContent = sessionUser ? `${formatUserDisplay(sessionUser)} / ${roleLabel(role)}` : "";
  window.refreshKitchenMenus?.();
  document.querySelectorAll("[data-god-only]").forEach((option) => {
    option.hidden = !permissions.canManageAdminRoles;
    option.disabled = !permissions.canManageAdminRoles;
  });
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

function renderUsers(users) {
  const filteredUsers = filterUsers(users);
  updateUserCount(filteredUsers.length, users.length);
  if (!filteredUsers.length) {
    userList.innerHTML = `<article class="panel empty-state-panel"><p>No users match the current filters.</p></article>`;
    return;
  }
  userList.innerHTML = filteredUsers.map((user) => `
    <article class="user-admin-card" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name)}">
      <button class="user-admin-summary" type="button" aria-expanded="false">
        <div class="user-admin-summary-main">
          <strong>${escapeHtml(user.name)}</strong>
          <span>${user.editable ? "Online user" : "Render user - move to App Users to edit"}</span>
          <span>${escapeHtml(formatLastLogin(user.lastLoginAt))}</span>
        </div>
        <div class="user-admin-summary-side">
          <div class="user-admin-pill-row">${userMetaBadges(user)}</div>
          <span class="user-admin-open-text">Open details</span>
        </div>
      </button>
      <div class="user-admin-body">
        <div class="user-admin-sections">
          <section class="user-admin-section">
            <h3>Access</h3>
            <div class="user-admin-fields">
              <label>Role
                <select class="user-role" ${user.editable && user.canEditRole ? "" : "disabled"}>
                  <option value="user"${user.role === "user" ? " selected" : ""}>User</option>
                  <option value="staff"${user.role === "staff" ? " selected" : ""}>Staff</option>
                  <option value="power-user"${user.role === "power-user" ? " selected" : ""}>Power User</option>
                  <option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option>
                  <option value="god"${user.role === "god" ? " selected" : ""}>God</option>
                </select>
              </label>
              <label>Theme
                <select class="user-theme" ${user.editable ? "" : "disabled"}>
                  <option value="dark"${user.theme !== "light" ? " selected" : ""}>Dark</option>
                  <option value="light"${user.theme === "light" ? " selected" : ""}>Light</option>
                </select>
              </label>
              <label>New password
                <input class="user-password" type="text" placeholder="Leave blank to keep current" ${user.editable && user.canSave ? "" : "disabled"}>
              </label>
            </div>
            <div class="user-admin-toggle-row">
              <label class="check-label"><input class="user-active" type="checkbox" ${user.active ? "checked" : ""} ${user.editable ? "" : "disabled"}> Active</label>
              <label class="check-label"><input class="user-must-change" type="checkbox" ${user.mustChangePassword ? "checked" : ""} ${user.editable ? "" : "disabled"}> Force password change</label>
            </div>
          </section>

          <section class="user-admin-section">
            <h3>Work Flow</h3>
            <div class="user-admin-toggle-row">
              <label class="check-label"><input class="user-is-driver" type="checkbox" ${user.isDriver ? "checked" : ""} ${user.editable ? "" : "disabled"}> Dedicated driver</label>
              <label class="check-label"><input class="user-is-picker" type="checkbox" ${user.isPicker ? "checked" : ""} ${user.editable ? "" : "disabled"}> Picker</label>
              <label class="check-label"><input class="user-notify-orders" type="checkbox" ${user.notifyOnNewOrders ? "checked" : ""} ${user.editable ? "" : "disabled"}> Notify on new orders</label>
              <label class="check-label"><input class="user-notify-delivery" type="checkbox" ${user.notifyOnDelivery ? "checked" : ""} ${user.editable ? "" : "disabled"}> Notify on delivered items</label>
            </div>
          </section>

          <section class="user-admin-section user-admin-section-wide">
            <h3>Notify For Area Orders</h3>
            <div class="notify-area-grid compact">
              <label class="check-label"><input class="user-notify-area-bar" type="checkbox" ${user.notifyAreas?.bar !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> Bar</label>
              <label class="check-label"><input class="user-notify-area-foh" type="checkbox" ${user.notifyAreas?.foh !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> FOH</label>
              <label class="check-label"><input class="user-notify-area-kitchen" type="checkbox" ${user.notifyAreas?.kitchen !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> Kitchen</label>
              <label class="check-label"><input class="user-notify-area-general" type="checkbox" ${user.notifyAreas?.general !== false ? "checked" : ""} ${user.editable ? "" : "disabled"}> General</label>
            </div>
          </section>
        </div>
        <div class="user-admin-actions">
          <label class="check-label delete-check"><input class="user-delete" type="checkbox" ${user.editable && user.canDelete ? "" : "disabled"}> Delete user</label>
          <button class="save-user" type="button" ${user.canSave || user.canDelete ? "" : "disabled"}>Save Changes</button>
        </div>
      </div>
    </article>
  `).join("");
}

async function loadUsers() {
  const me = await api("/api/me");
  if (me.token) saveSession(me);
  if (!permissions.canAdminUsers) throw new Error("Only admins can open user administration.");
  setMessage("Loading users...");
  const data = await api("/api/app-users");
  allUsers = data.users;
  renderUsers(allUsers);
  setMessage("");
}

async function saveUser(row) {
  const id = row.dataset.userId;
  const name = row.querySelector("strong").textContent;
  const wantsDelete = row.querySelector(".user-delete")?.checked;
  if (wantsDelete) {
    if (!confirm(`Delete user ${name}?`)) return { deleted: false };
    if (!confirm(`Really delete ${name}? This cannot be undone.`)) return { deleted: false };
    await api(`/api/app-users/${id}`, { method: "DELETE" });
    return { deleted: true };
  }

  const data = await api(`/api/app-users/${id}`, {
    method: "PATCH",
      body: JSON.stringify({
        name,
        password: row.querySelector(".user-password").value,
        role: row.querySelector(".user-role").value,
        theme: row.querySelector(".user-theme").value,
        isDriver: row.querySelector(".user-is-driver").checked,
        isPicker: row.querySelector(".user-is-picker").checked,
        notifyOnNewOrders: row.querySelector(".user-notify-orders").checked,
        notifyOnDelivery: row.querySelector(".user-notify-delivery").checked,
        notifyAreas: {
          bar: row.querySelector(".user-notify-area-bar").checked,
          foh: row.querySelector(".user-notify-area-foh").checked,
          kitchen: row.querySelector(".user-notify-area-kitchen").checked,
          general: row.querySelector(".user-notify-area-general").checked
        },
        active: row.querySelector(".user-active").checked,
        mustChangePassword: row.querySelector(".user-must-change").checked
      })
  });
  row.querySelector(".user-password").value = "";
  row.querySelector(".user-must-change").checked = data.user.mustChangePassword;
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
    await loadUsers();
  } catch (error) {
    setLoginMessage(error.message, true);
  }
});

newUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Adding user...");
  try {
    await api("/api/app-users", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#newName").value,
        password: document.querySelector("#newPassword").value,
        role: document.querySelector("#newRole").value,
        theme: document.querySelector("#newTheme").value,
        isDriver: document.querySelector("#newIsDriver").checked,
        isPicker: document.querySelector("#newIsPicker").checked,
        notifyOnNewOrders: document.querySelector("#newNotifyOrders").checked,
        notifyOnDelivery: document.querySelector("#newNotifyDelivery").checked,
        notifyAreas: {
          bar: document.querySelector("#newNotifyBar").checked,
          foh: document.querySelector("#newNotifyFoh").checked,
          kitchen: document.querySelector("#newNotifyKitchen").checked,
          general: document.querySelector("#newNotifyGeneral").checked
        },
        active: true,
        mustChangePassword: document.querySelector("#newMustChange").checked
      })
    });
    newUserForm.reset();
    await loadUsers();
    setMessage("User added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

userList.addEventListener("click", (event) => {
  const summary = event.target.closest(".user-admin-summary");
  if (summary) {
    const card = summary.closest(".user-admin-card");
    const expanded = card.classList.toggle("expanded");
    summary.setAttribute("aria-expanded", expanded ? "true" : "false");
    const hint = summary.querySelector(".user-admin-open-text");
    if (hint) hint.textContent = expanded ? "Hide details" : "Open details";
    return;
  }
  const button = event.target.closest(".save-user");
  if (!button) return;
  const row = button.closest(".user-admin-card");
  button.disabled = true;
  saveUser(row)
    .then((result) => loadUsers().then(() => setMessage(result?.deleted ? "User deleted." : "User saved.")))
    .catch((error) => setMessage(error.message, true))
    .finally(() => { button.disabled = false; });
});

[userSearch, roleFilter, statusFilter].forEach((control) => {
  control?.addEventListener("input", () => renderUsers(allUsers));
  control?.addEventListener("change", () => renderUsers(allUsers));
});

logoutButton.addEventListener("click", showLogin);

if (sessionToken && sessionUser) {
  showApp();
  loadUsers().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}







