import { bindKitchenLogin } from "/login-flow.js";
import { bindLogoutButton } from "/session-bootstrap.js";

export function bindOrderingLogin({
  loginForm,
  usernameInput,
  passwordInput,
  setLoginMessage,
  saveSession,
  showApp,
  refresh,
  showLogin
}) {
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
      setLoginMessage("");
      showApp();
      await refresh();
    }
  });

  bindLogoutButton(document.querySelector("#logoutButton"), showLogin);
}

export function bindOrderingBootstrap({
  sessionToken,
  sessionUser,
  showApp,
  loadBootstrapCache,
  applyBootstrapData,
  applyPendingJump,
  setMessage,
  refreshSession,
  refresh,
  showLogin,
  updateSaveButton
}) {
  if (sessionToken() && sessionUser()) {
    showApp();
    const cached = loadBootstrapCache();
    if (cached) {
      applyBootstrapData(cached);
      applyPendingJump();
      setMessage("");
    }
    refreshSession()
      .then((ok) => {
        if (ok) return refresh(Boolean(cached));
        return null;
      })
      .catch((error) => setMessage(error.message, true));
  } else {
    showLogin();
    updateSaveButton();
  }
}
