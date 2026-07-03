import { createJsonApiClient } from "/api-client.js";

export function createOrderingRuntime({
  loginScreen,
  currentUser,
  featureMenu,
  backofficeMenu,
  loginMessage,
  message,
  formatUserDisplay,
  setUiMessage,
  showOrderingApp,
  saveOrderingSession,
  showOrderingLogin,
  refreshOrderingSession,
  localStorageObject,
  windowObject,
  documentObject,
  getSessionToken,
  getSessionUser,
  getSessionPermissions,
  setSessionState
}) {
  function setMessage(text, isError = false) {
    setUiMessage(message, text, isError);
  }

  function setLoginMessage(text, isError = false) {
    setUiMessage(loginMessage, text, isError);
  }

  function showApp() {
    showOrderingApp({
      loginScreen,
      sessionPermissions: getSessionPermissions(),
      currentUser,
      sessionUser: getSessionUser(),
      featureMenu,
      backofficeMenu,
      formatUserDisplay,
      windowObject,
      documentObject
    });
  }

  function saveSession(data) {
    const nextSession = saveOrderingSession(data, {
      sessionToken: getSessionToken(),
      localStorageObject,
      applyTheme: windowObject.applyKitchenTheme,
      setupPush: windowObject.setupKitchenPush
    });
    setSessionState(nextSession);
  }

  function showLogin() {
    showOrderingLogin({
      loginScreen,
      currentUser,
      localStorageObject
    });
    setSessionState({
      token: "",
      user: "",
      role: "user",
      permissions: {}
    });
  }

  const api = createJsonApiClient({
    getToken: () => getSessionToken(),
    onUnauthorized: () => showLogin(),
    onPasswordChangeRequired: () => {
      windowObject.location.href = "/change-password.html";
    },
    windowObject
  });

  async function queueApi(path, options = {}, meta = {}) {
    if (!windowObject.kitchenOfflineQueue?.request) return api(path, options);
    return windowObject.kitchenOfflineQueue.request(path, options, {
      allowQueue: true,
      token: getSessionToken(),
      ...meta
    });
  }

  async function refreshSession() {
    return refreshOrderingSession({
      api,
      sessionToken: getSessionToken(),
      saveSession,
      showApp,
      windowObject
    });
  }

  return {
    setMessage,
    setLoginMessage,
    showApp,
    saveSession,
    showLogin,
    api,
    queueApi,
    refreshSession
  };
}
