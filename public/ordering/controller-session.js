import {
  applyAuthenticatedShell,
  applyLoggedOutShell,
  persistKitchenSession
} from "/session-shell.js";

export function setUiMessage(element, text, isError = false) {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", isError);
}

export function showOrderingApp(context) {
  const {
    loginScreen,
    sessionPermissions,
    currentUser,
    sessionUser,
    featureMenu,
    backofficeMenu,
    formatUserDisplay,
    windowObject,
    documentObject
  } = context;
  if (loginScreen) loginScreen.hidden = true;
  if (!sessionPermissions.canUseSupplierOrdering && sessionPermissions.canPlaceInternalOrders) {
    windowObject.location.href = "/internal-orders.html";
    return;
  }
  applyAuthenticatedShell({
    loginScreen,
    currentUser,
    sessionUser,
    formatUserDisplay,
    windowObject
  });
  documentObject.querySelectorAll("[data-permission]").forEach((element) => {
    element.hidden = !sessionPermissions[element.dataset.permission];
  });
  documentObject.querySelectorAll("#featureMenu option[data-permission]").forEach((option) => {
    option.hidden = !sessionPermissions[option.dataset.permission];
    option.disabled = !sessionPermissions[option.dataset.permission];
  });
  if (featureMenu) featureMenu.value = "/ordering.html";
  if (backofficeMenu) backofficeMenu.value = "";
}

export function saveOrderingSession(data, context) {
  const {
    sessionToken,
    localStorageObject,
    applyTheme,
    setupPush
  } = context;
  return persistKitchenSession(data, {
    currentToken: sessionToken,
    storage: localStorageObject,
    applyTheme,
    setupPush
  });
}

export function showOrderingLogin(context) {
  const { loginScreen, currentUser, localStorageObject } = context;
  applyLoggedOutShell({
    loginScreen,
    currentUser,
    storage: localStorageObject
  });
}

export async function refreshOrderingSession(context) {
  const {
    api,
    sessionToken,
    saveSession,
    showApp,
    windowObject
  } = context;
  const data = await api("/api/me");
  saveSession({ token: sessionToken, user: data.user });
  if (data.user.mustChangePassword) {
    windowObject.location.href = "/change-password.html";
    return false;
  }
  showApp();
  return true;
}
