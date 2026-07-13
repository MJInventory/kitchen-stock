import { formatUserDisplay, roleLabel } from "./helpers.js";
import { renderUsers } from "./render.js";
import {
  applyAuthenticatedShell,
  applyLoggedOutShell,
  persistKitchenSession,
  readKitchenSession
} from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";
import { bindKitchenLogin } from "/login-flow.js";
import { bindAuthenticatedBootstrap, bindLogoutButton } from "/session-bootstrap.js";

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

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;
  let permissions = initialSession.permissions;
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
    const saved = persistKitchenSession(data, {
      currentToken: sessionToken,
      applyTheme: window.applyKitchenTheme,
      setupPush: window.setupKitchenPush,
      forcedTheme: "light"
    });
    sessionToken = saved.token;
    sessionUser = saved.user;
    permissions = saved.permissions;
  }

  function showApp() {
    const role = readKitchenSession().role;
    applyAuthenticatedShell({
      loginScreen,
      currentUser,
      sessionUser: sessionUser ? `${formatUserDisplay(sessionUser)} / ${roleLabel(role)}` : "",
      formatUserDisplay: (value) => value,
      refreshMenus: true
    });
    document.querySelectorAll("[data-god-only]").forEach((option) => {
      option.hidden = !permissions.canManageAdminRoles;
      option.disabled = !permissions.canManageAdminRoles;
    });
  }

  function showLogin() {
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
    permissions = {};
  }

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      window.location.href = "/change-password.html";
    }
  });

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
      userCount,
      canManageSecurityRole: Boolean(permissions.canManageSecurityRole),
      canManageAdminRoles: Boolean(permissions.canManageAdminRoles)
    });
  }

  async function saveUser(row) {
    const id = row.dataset.userId;
    const data = await api(`/api/app-users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.dataset.userName || row.querySelector("strong").textContent,
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
        desktopIdleTimeoutEnabled: row.querySelector(".user-desktop-idle-timeout")?.checked,
        active: row.querySelector(".user-active").checked,
        mustChangePassword: row.querySelector(".user-must-change").checked
      })
    });
    row.querySelector(".user-password").value = "";
    row.querySelector(".user-must-change").checked = data.user.mustChangePassword;
  }

  function getUserRecord(row) {
    return allUsers.find((user) => user.id === row.dataset.userId);
  }

  function isUserDirty(row) {
    const user = getUserRecord(row);
    if (!user) return false;
    const desktopIdleTimeoutControl = row.querySelector(".user-desktop-idle-timeout");
    return (row.querySelector(".user-password")?.value || "") !== ""
      || (row.querySelector(".user-role")?.value || "") !== String(user.role || "")
      || Boolean(row.querySelector(".user-is-driver")?.checked) !== Boolean(user.isDriver)
      || Boolean(row.querySelector(".user-is-picker")?.checked) !== Boolean(user.isPicker)
      || Boolean(row.querySelector(".user-is-kitchen-staff")?.checked) !== Boolean(user.isKitchenStaff)
      || (row.querySelector(".user-kitchen-function")?.value || "") !== String(user.kitchenFunction || "")
      || Boolean(row.querySelector(".user-notify-orders")?.checked) !== Boolean(user.notifyOnNewOrders)
      || Boolean(row.querySelector(".user-notify-delivery")?.checked) !== Boolean(user.notifyOnDelivery)
      || Boolean(row.querySelector(".user-notify-area-bar")?.checked) !== (user.notifyAreas?.bar !== false)
      || Boolean(row.querySelector(".user-notify-area-foh")?.checked) !== (user.notifyAreas?.foh !== false)
      || Boolean(row.querySelector(".user-notify-area-kitchen")?.checked) !== (user.notifyAreas?.kitchen !== false)
      || Boolean(row.querySelector(".user-notify-area-general")?.checked) !== (user.notifyAreas?.general !== false)
      || (desktopIdleTimeoutControl
        ? Boolean(desktopIdleTimeoutControl.checked) !== (user.settings?.desktopIdleTimeoutEnabled !== false)
        : false)
      || Boolean(row.querySelector(".user-active")?.checked) !== Boolean(user.active)
      || Boolean(row.querySelector(".user-must-change")?.checked) !== Boolean(user.mustChangePassword);
  }

  async function deleteUser(row) {
    const id = row.dataset.userId;
    const name = row.dataset.userName || row.querySelector("strong").textContent;
    if (!confirm(`Delete user ${name}?`)) return;
    if (!confirm(`Really delete ${name}? This cannot be undone.`)) return;
    await api(`/api/app-users/${id}`, { method: "DELETE" });
    await loadUsers();
    setMessage("User deleted.");
  }

  bindKitchenLogin({
    loginForm,
    usernameInput,
    passwordInput,
    setLoginMessage,
    onSuccess: async (data) => {
      saveSession(data);
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      passwordInput.value = "";
      showApp();
      await loadUsers();
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
          desktopIdleTimeoutEnabled: document.querySelector("#newDesktopIdleTimeoutEnabled")?.checked,
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
    const deleteButton = event.target.closest(".delete-user");
    if (!deleteButton) return;
    const row = deleteButton.closest(".user-admin-card");
    deleteButton.disabled = true;
    deleteUser(row)
      .catch((error) => setMessage(error.message, true))
      .finally(() => { deleteButton.disabled = false; });
  });

  userList.addEventListener("input", (event) => {
    const row = event.target.closest(".user-admin-card");
    if (!row) return;
    row.classList.toggle("dirty", isUserDirty(row));
  });

  userList.addEventListener("change", (event) => {
    const row = event.target.closest(".user-admin-card");
    if (!row) return;
    row.classList.toggle("dirty", isUserDirty(row));
  });

  userList.addEventListener("focusout", (event) => {
    const row = event.target.closest(".user-admin-card");
    if (!row) return;
    const next = event.relatedTarget;
    if (next && row.contains(next)) return;
    if (!isUserDirty(row) || row.dataset.saving === "true") return;
    row.dataset.saving = "true";
    row.classList.add("dirty");
    setMessage("Saving user...");
    saveUser(row)
      .then(() => loadUsers())
      .then(() => setMessage("User saved."))
      .catch((error) => setMessage(error.message, true))
      .finally(() => { row.dataset.saving = "false"; });
  });

  [userSearch, roleFilter, statusFilter].forEach((control) => {
    control?.addEventListener("input", renderUserList);
    control?.addEventListener("change", renderUserList);
  });

  bindLogoutButton(logoutButton, showLogin);

  bindAuthenticatedBootstrap({
    hasSession: () => Boolean(sessionToken && sessionUser),
    showApp,
    showLogin,
    load: loadUsers,
    onError: (error) => setMessage(error.message, true)
  });
}
