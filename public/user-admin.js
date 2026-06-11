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

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");

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
}

function showApp() {
  loginScreen.hidden = true;
  const role = localStorage.getItem("kitchenStockRole") || "user";
  const roleLabel = role === "god" ? "God" : role === "admin" ? "Admin" : role === "power-user" ? "Power User" : "User";
  currentUser.textContent = sessionUser ? `${formatUserDisplay(sessionUser)} / ${roleLabel}` : "";
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
  userList.innerHTML = users.map((user) => `
    <article class="setting-row user-admin-row" data-user-id="${escapeHtml(user.id)}">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <span>${user.editable ? "Online user" : "Render user - move to App Users to edit"}</span>
        <span>${escapeHtml(formatLastLogin(user.lastLoginAt))}</span>
      </div>
      <label>New password
        <input class="user-password" type="text" placeholder="Leave blank to keep current" ${user.editable && user.canSave ? "" : "disabled"}>
      </label>
      <label>Role
        <select class="user-role" ${user.editable && user.canEditRole ? "" : "disabled"}>
          <option value="user"${user.role === "user" ? " selected" : ""}>User</option>
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
      <label class="check-label"><input class="user-active" type="checkbox" ${user.active ? "checked" : ""} ${user.editable ? "" : "disabled"}> Active</label>
      <label class="check-label"><input class="user-must-change" type="checkbox" ${user.mustChangePassword ? "checked" : ""} ${user.editable ? "" : "disabled"}> Force password change</label>
      <label class="check-label delete-check"><input class="user-delete" type="checkbox" ${user.editable && user.canDelete ? "" : "disabled"}> Delete user</label>
      <button class="save-user" type="button" ${user.canSave || user.canDelete ? "" : "disabled"}>Save</button>
    </article>
  `).join("");
}

async function loadUsers() {
  const me = await api("/api/me");
  if (me.token) saveSession(me);
  if (!permissions.canAdminUsers) throw new Error("Only admins can open user administration.");
  setMessage("Loading users...");
  const data = await api("/api/app-users");
  renderUsers(data.users);
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
  const button = event.target.closest(".save-user");
  if (!button) return;
  const row = button.closest(".user-admin-row");
  button.disabled = true;
  saveUser(row)
    .then((result) => loadUsers().then(() => setMessage(result?.deleted ? "User deleted." : "User saved.")))
    .catch((error) => setMessage(error.message, true))
    .finally(() => { button.disabled = false; });
});

logoutButton.addEventListener("click", showLogin);

if (sessionToken && sessionUser) {
  showApp();
  loadUsers().catch((error) => setMessage(error.message, true));
} else {
  showLogin();
}







