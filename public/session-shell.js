function safeJsonParse(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const LAST_ACTIVITY_KEY = "kitchenStockLastActivityAt";
const DESKTOP_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DESKTOP_IDLE_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "focus"];

export function isMobileOrTabletBrowser({
  windowObject = window,
  navigatorObject = window.navigator
} = {}) {
  const userAgent = String(
    navigatorObject?.userAgent ||
    navigatorObject?.vendor ||
    windowObject?.opera ||
    ""
  ).toLowerCase();
  if (navigatorObject?.userAgentData?.mobile) return true;
  if (/(android|iphone|ipad|ipod|mobile|tablet|silk|kindle)/i.test(userAgent)) return true;
  if ((navigatorObject?.maxTouchPoints || 0) > 1 && windowObject?.matchMedia?.("(pointer: coarse)")?.matches) return true;
  return false;
}

function inactivityState(windowObject = window) {
  if (!windowObject.__kitchenInactivityState) {
    windowObject.__kitchenInactivityState = {
      timer: null,
      stop: null
    };
  }
  return windowObject.__kitchenInactivityState;
}

export function stopKitchenInactivityMonitor({
  windowObject = window,
  storage = window.localStorage
} = {}) {
  const state = inactivityState(windowObject);
  state.stop?.();
  state.stop = null;
  if (state.timer) {
    windowObject.clearTimeout?.(state.timer);
    state.timer = null;
  }
  storage.removeItem(LAST_ACTIVITY_KEY);
}

export function startKitchenInactivityMonitor({
  timeoutMs = DESKTOP_IDLE_TIMEOUT_MS,
  windowObject = window,
  navigatorObject = window.navigator,
  storage = window.localStorage,
  onTimeout = () => {
    clearKitchenSession(storage);
    windowObject.location?.reload?.();
  }
} = {}) {
  stopKitchenInactivityMonitor({ windowObject, storage });
  if (isMobileOrTabletBrowser({ windowObject, navigatorObject })) {
    return { enabled: false, stop: () => {} };
  }

  const state = inactivityState(windowObject);
  const markActivity = () => {
    storage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    if (state.timer) {
      windowObject.clearTimeout?.(state.timer);
    }
    state.timer = windowObject.setTimeout?.(() => {
      const lastActivity = Number(storage.getItem(LAST_ACTIVITY_KEY) || 0);
      if (lastActivity && Date.now() - lastActivity >= timeoutMs) {
        onTimeout();
      } else {
        markActivity();
      }
    }, timeoutMs);
  };

  for (const eventName of DESKTOP_IDLE_EVENTS) {
    windowObject.addEventListener?.(eventName, markActivity, { passive: true });
  }

  state.stop = () => {
    for (const eventName of DESKTOP_IDLE_EVENTS) {
      windowObject.removeEventListener?.(eventName, markActivity, { passive: true });
    }
  };

  markActivity();
  return {
    enabled: true,
    stop: () => stopKitchenInactivityMonitor({ windowObject, storage })
  };
}

export function clearKitchenSession(storage = window.localStorage) {
  storage.removeItem("kitchenStockToken");
  storage.removeItem("kitchenStockUser");
  storage.removeItem("kitchenStockRole");
  storage.removeItem("kitchenStockPermissions");
  storage.removeItem("kitchenStockSettings");
  storage.removeItem(LAST_ACTIVITY_KEY);
}

export function readKitchenSession(storage = window.localStorage) {
  return {
    token: storage.getItem("kitchenStockToken") || "",
    user: storage.getItem("kitchenStockUser") || "",
    role: storage.getItem("kitchenStockRole") || "user",
    permissions: safeJsonParse(storage.getItem("kitchenStockPermissions"), {}),
    settings: safeJsonParse(storage.getItem("kitchenStockSettings"), {}),
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
  storage = window.localStorage,
  windowObject = window
}) {
  if (loginScreen) loginScreen.hidden = false;
  if (currentUser) {
    currentUser.textContent = "";
    currentUser.hidden = true;
  }
  stopKitchenInactivityMonitor({ windowObject, storage });
  clearKitchenSession(storage);
}

export function applyAuthenticatedShell({
  loginScreen,
  currentUser,
  sessionUser,
  formatUserDisplay,
  refreshMenus = true,
  windowObject = window,
  storage = window.localStorage
}) {
  if (loginScreen) loginScreen.hidden = true;
  if (currentUser) {
    currentUser.textContent = formatUserDisplay(sessionUser);
    currentUser.hidden = false;
  }
  if (refreshMenus) {
    windowObject.refreshKitchenMenus?.();
  }
  const session = readKitchenSession(storage);
  if (session.settings?.desktopIdleTimeoutEnabled === false) {
    stopKitchenInactivityMonitor({ windowObject, storage });
    return;
  }
  startKitchenInactivityMonitor({ windowObject, storage });
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
    persistKitchenSession,
    isMobileOrTabletBrowser,
    startKitchenInactivityMonitor,
    stopKitchenInactivityMonitor
  };
}
