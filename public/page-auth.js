import {
  applyAuthenticatedShell,
  applyLoggedOutShell,
  persistKitchenSession,
  readKitchenSession
} from "/session-shell.js";
import { createJsonApiClient } from "/api-client.js";

export function authPage({ permission = "", messageSelector = "" } = {}) {
  const loginScreen = document.querySelector("#loginScreen");
  const loginForm = document.querySelector("#loginForm");
  const usernameInput = document.querySelector("#usernameInput");
  const passwordInput = document.querySelector("#passwordInput");
  const loginMessage = document.querySelector("#loginMessage");
  const currentUser = document.querySelector("#currentUser");
  const logoutButton = document.querySelector("#logoutButton");
  const pageMessage = messageSelector ? document.querySelector(messageSelector) : null;

  const initialSession = readKitchenSession();
  let sessionToken = initialSession.token;
  let sessionUser = initialSession.user;

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
  let permissions = initialSession.permissions;

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
    const saved = persistKitchenSession(data, {
      currentToken: sessionToken,
      applyTheme: window.applyKitchenTheme
    });
    sessionToken = saved.token;
    sessionUser = saved.user;
    permissions = saved.permissions;
  }

  function showApp() {
    applyAuthenticatedShell({
      loginScreen,
      currentUser,
      sessionUser,
      formatUserDisplay
    });
  }

  function showLogin() {
    applyLoggedOutShell({ loginScreen, currentUser });
    sessionToken = "";
    sessionUser = "";
  }

  const api = createJsonApiClient({
    getToken: () => sessionToken,
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      window.location.href = "/change-password.html";
    }
  });

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







