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
}

function showApp() {
  loginScreen.hidden = true;
  const role = localStorage.getItem("kitchenStockRole") || "user";
  const roleLabel = role === "admin" ? "Admin" : role === "power-user" ? "Power User" : "User";
  currentUser.textContent = sessionUser ? `${sessionUser} / ${roleLabel}` : "";
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
        <span>${escapeHtml(user.source)}${user.editable ? "" : " / Render user"}</span>
      </div>
      <label>Password <input class="user-password" type="text" value="${escapeHtml(user.password)}" ${user.editable ? "" : "disabled"}></label>
      <label>Role
        <select class="user-role" ${user.editable ? "" : "disabled"}>
          <option value="user"${user.role === "user" ? " selected" : ""}>User</option>
          <option value="power-user"${user.role === "power-user" ? " selected" : ""}>Power User</option>
          <option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option>
        </select>
      </label>
      <label class="check-label"><input class="user-active" type="checkbox" ${user.active ? "checked" : ""} ${user.editable ? "" : "disabled"}> Active</label>
      <label class="check-label"><input class="user-must-change" type="checkbox" ${user.mustChangePassword ? "checked" : ""} ${user.editable ? "" : "disabled"}> Force password change</label>
      <button class="save-user" type="button" ${user.editable ? "" : "disabled"}>Save</button>
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
  const data = await api(`/api/app-users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: row.querySelector("strong").textContent,
      password: row.querySelector(".user-password").value,
      role: row.querySelector(".user-role").value,
      active: row.querySelector(".user-active").checked,
      mustChangePassword: row.querySelector(".user-must-change").checked
    })
  });
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
    .then(() => setMessage("User saved."))
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
