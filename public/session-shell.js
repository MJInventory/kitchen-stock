export function clearKitchenSession(storage = window.localStorage) {
  storage.removeItem("kitchenStockToken");
  storage.removeItem("kitchenStockUser");
  storage.removeItem("kitchenStockRole");
  storage.removeItem("kitchenStockPermissions");
  storage.removeItem("kitchenStockSettings");
}

export function applyLoggedOutShell({
  loginScreen,
  currentUser,
  storage = window.localStorage
}) {
  if (loginScreen) loginScreen.hidden = false;
  if (currentUser) {
    currentUser.textContent = "";
    currentUser.hidden = true;
  }
  clearKitchenSession(storage);
}

export function applyAuthenticatedShell({
  loginScreen,
  currentUser,
  sessionUser,
  formatUserDisplay,
  refreshMenus = true,
  windowObject = window
}) {
  if (loginScreen) loginScreen.hidden = true;
  if (currentUser) {
    currentUser.textContent = formatUserDisplay(sessionUser);
    currentUser.hidden = false;
  }
  if (refreshMenus) {
    windowObject.refreshKitchenMenus?.();
  }
}

export function persistKitchenSession(data, {
  currentToken = "",
  storage = window.localStorage,
  applyTheme,
  setupPush,
  forcedTheme = ""
} = {}) {
  const nextToken = data.token || currentToken;
  const nextUser = data.user.name;
  const nextRole = data.user.role || "user";
  const nextPermissions = data.user.permissions || {};
  const nextTheme = forcedTheme || data.user.theme || "dark";
  storage.setItem("kitchenStockToken", nextToken);
  storage.setItem("kitchenStockUser", nextUser);
  storage.setItem("kitchenStockRole", nextRole);
  storage.setItem("kitchenStockPermissions", JSON.stringify(nextPermissions));
  storage.setItem("kitchenStockSettings", JSON.stringify(data.user.settings || {}));
  storage.setItem("kitchenStockTheme", nextTheme);
  applyTheme?.(nextTheme);
  setupPush?.();
  return {
    token: nextToken,
    user: nextUser,
    role: nextRole,
    permissions: nextPermissions,
    theme: nextTheme
  };
}
