export function clearKitchenSession(storage = window.localStorage) {
  storage.removeItem("kitchenStockToken");
  storage.removeItem("kitchenStockUser");
  storage.removeItem("kitchenStockRole");
  storage.removeItem("kitchenStockPermissions");
  storage.removeItem("kitchenStockSettings");
}

export function readKitchenSession(storage = window.localStorage) {
  return {
    token: storage.getItem("kitchenStockToken") || "",
    user: storage.getItem("kitchenStockUser") || "",
    role: storage.getItem("kitchenStockRole") || "user",
    permissions: JSON.parse(storage.getItem("kitchenStockPermissions") || "{}"),
    settings: JSON.parse(storage.getItem("kitchenStockSettings") || "{}"),
    theme: storage.getItem("kitchenStockTheme") || ""
  };
}

export function writeKitchenSession(session = {}, storage = window.localStorage) {
  const current = readKitchenSession(storage);
  const next = {
    ...current,
    ...session,
    permissions: session.permissions ?? current.permissions,
    settings: session.settings ?? current.settings
  };
  storage.setItem("kitchenStockToken", next.token || "");
  storage.setItem("kitchenStockUser", next.user || "");
  storage.setItem("kitchenStockRole", next.role || "user");
  storage.setItem("kitchenStockPermissions", JSON.stringify(next.permissions || {}));
  storage.setItem("kitchenStockSettings", JSON.stringify(next.settings || {}));
  if (next.theme) {
    storage.setItem("kitchenStockTheme", next.theme);
  }
  return next;
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

if (typeof window !== "undefined") {
  window.kitchenSessionBridge = {
    clearKitchenSession,
    readKitchenSession,
    writeKitchenSession,
    applyLoggedOutShell,
    applyAuthenticatedShell,
    persistKitchenSession
  };
}
