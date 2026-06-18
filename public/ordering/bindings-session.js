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
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginMessage("Logging in...");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
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
      await refresh();
    } catch (error) {
      setLoginMessage(error.message, true);
    }
  });

  document.querySelector("#logoutButton")?.addEventListener("click", showLogin);
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
