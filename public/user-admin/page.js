import { formatUserDisplay, roleLabel } from "./helpers.js";
import { renderUsers } from "./render.js";

export function initUserAdminPage() {
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

  function setMessage(text, isError = false) {
    adminMessage.textContent = text;
    adminMessage.classList.toggle("error", isError);
  }

  function setLoginMessage(text, isError = false) {
    loginMessage.textContent = text;
    loginMessage.classList.toggle("error", isError);
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

  async function loadUsers() {
    const me = await api("/api/me");
    if (me.token) saveSession(me);
    if (!permissions.canAdminUsers) throw new Error("Only admins can open user administration.");
    setMessage("Loading users...");
    const data = await api("/api/app-users");
    allUsers = data.users;
    renderUserList();
    setMessage("");
  }

  function renderUserList() {
    renderUsers({
      users: allUsers,
      filters: {
        term: (userSearch?.value || "").trim().toLowerCase(),
        wantedRole: roleFilter?.value || "all",
        wantedStatus: statusFilter?.value || "all"
      },
      userList,
      userCount
    });
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
        theme: "light",
        isDriver: row.querySelector(".user-is-driver").checked,
        isPicker: row.querySelector(".user-is-picker").checked,
        isKitchenStaff: row.querySelector(".user-is-kitchen-staff").checked,
        kitchenFunction: row.querySelector(".user-kitchen-function").value,
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
          theme: "light",
          isDriver: document.querySelector("#newIsDriver").checked,
          isPicker: document.querySelector("#newIsPicker").checked,
          isKitchenStaff: document.querySelector("#newIsKitchenStaff").checked,
          kitchenFunction: document.querySelector("#newKitchenFunction").value,
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
    control?.addEventListener("input", renderUserList);
    control?.addEventListener("change", renderUserList);
  });

  logoutButton.addEventListener("click", showLogin);

  if (sessionToken && sessionUser) {
    showApp();
    loadUsers().catch((error) => setMessage(error.message, true));
  } else {
    showLogin();
  }
}
