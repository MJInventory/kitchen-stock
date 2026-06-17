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
  if (currentUser) {
    currentUser.textContent = formatUserDisplay(sessionUser);
    currentUser.hidden = false;
  }
  windowObject.refreshKitchenMenus?.();
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
  const nextToken = data.token || sessionToken;
  const nextUser = data.user.name;
  const nextRole = data.user.role || "user";
  const nextPermissions = data.user.permissions || {};
  localStorageObject.setItem("kitchenStockToken", nextToken);
  localStorageObject.setItem("kitchenStockUser", nextUser);
  localStorageObject.setItem("kitchenStockRole", nextRole);
  localStorageObject.setItem("kitchenStockPermissions", JSON.stringify(nextPermissions));
  localStorageObject.setItem("kitchenStockTheme", data.user.theme || "dark");
  applyTheme?.(data.user.theme || "dark");
  setupPush?.();
  return {
    token: nextToken,
    user: nextUser,
    role: nextRole,
    permissions: nextPermissions
  };
}

export function showOrderingLogin(context) {
  const { loginScreen, currentUser, localStorageObject } = context;
  if (loginScreen) loginScreen.hidden = false;
  if (currentUser) {
    currentUser.textContent = "";
    currentUser.hidden = true;
  }
  localStorageObject.removeItem("kitchenStockToken");
  localStorageObject.removeItem("kitchenStockUser");
  localStorageObject.removeItem("kitchenStockRole");
  localStorageObject.removeItem("kitchenStockPermissions");
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
