export function authPage({ permission = "", messageSelector = "" } = {}) {
  const loginScreen = document.querySelector("#loginScreen");
  const loginForm = document.querySelector("#loginForm");
  const usernameInput = document.querySelector("#usernameInput");
  const passwordInput = document.querySelector("#passwordInput");
  const loginMessage = document.querySelector("#loginMessage");
  const currentUser = document.querySelector("#currentUser");
  const logoutButton = document.querySelector("#logoutButton");
  const pageMessage = messageSelector ? document.querySelector(messageSelector) : null;

  let sessionToken = localStorage.getItem("kitchenStockToken") || "";
  let sessionUser = localStorage.getItem("kitchenStockUser") || "";
  let permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");

  function setLoginMessage(text, isError = false) {
    if (!loginMessage) return;
    loginMessage.textContent = text;
    loginMessage.classList.toggle("error", isError);
  }

  function setPageMessage(text, isError = false) {
    if (!pageMessage) return;
    pageMessage.textContent = text;
    pageMessage.classList.toggle("error", isError);
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
    if (loginScreen) loginScreen.hidden = true;
    if (currentUser) currentUser.textContent = sessionUser;
  }

  function showLogin() {
    if (loginScreen) loginScreen.hidden = false;
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

  async function verifyPermission() {
    const data = await api("/api/me");
    if (data.token) saveSession(data);
    permissions = data.user.permissions || permissions;
    if (permission && !permissions[permission]) throw new Error("You do not have permission to use this screen.");
  }

  loginForm?.addEventListener("submit", async (event) => {
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
      setLoginMessage("");
      showApp();
      await verifyPermission();
      document.dispatchEvent(new CustomEvent("auth-ready"));
    } catch (error) {
      setLoginMessage(error.message, true);
    }
  });

  logoutButton?.addEventListener("click", showLogin);

  return {
    api,
    ready(callback) {
      document.addEventListener("auth-ready", () => callback().catch((error) => setPageMessage(error.message, true)));
      if (sessionToken && sessionUser) {
        showApp();
        verifyPermission()
          .then(callback)
          .catch((error) => setPageMessage(error.message, true));
      } else {
        showLogin();
      }
    }
  };
}




