import test from "node:test";
import assert from "node:assert/strict";

import {
  clearKitchenSession,
  isMobileOrTabletBrowser,
  readKitchenSession,
  startKitchenInactivityMonitor,
  stopKitchenInactivityMonitor,
  writeKitchenSession
} from "../public/session-shell.js";
import { createJsonApiClient } from "../public/api-client.js";
import { requestKitchenLogin, bindKitchenLogin } from "../public/login-flow.js";
import { bindAuthenticatedBootstrap, bindLogoutButton } from "../public/session-bootstrap.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test("session helpers read, merge-write, and clear kitchen session state", () => {
  const storage = createStorage({
    kitchenStockToken: "token-1",
    kitchenStockUser: "Enno",
    kitchenStockRole: "admin",
    kitchenStockPermissions: JSON.stringify({ canAdminUsers: true }),
    kitchenStockSettings: JSON.stringify({ hiddenGotoMenu: ["/ordering.html"] }),
    kitchenStockTheme: "light"
  });

  assert.deepEqual(readKitchenSession(storage), {
    token: "token-1",
    user: "Enno",
    role: "admin",
    permissions: { canAdminUsers: true },
    settings: { hiddenGotoMenu: ["/ordering.html"] },
    theme: "light"
  });

  const next = writeKitchenSession({
    user: "Freddy",
    permissions: { canPickInternalOrders: true }
  }, storage);

  assert.equal(next.token, "token-1");
  assert.equal(next.user, "Freddy");
  assert.deepEqual(next.permissions, { canPickInternalOrders: true });
  assert.deepEqual(readKitchenSession(storage).settings, { hiddenGotoMenu: ["/ordering.html"] });

  clearKitchenSession(storage);
  assert.equal(storage.getItem("kitchenStockToken"), null);
  assert.equal(storage.getItem("kitchenStockUser"), null);
  assert.equal(storage.getItem("kitchenStockRole"), null);
  assert.equal(storage.getItem("kitchenStockPermissions"), null);
  assert.equal(storage.getItem("kitchenStockSettings"), null);
});

test("session helpers ignore broken saved json instead of crashing", () => {
  const storage = createStorage({
    kitchenStockPermissions: "{bad json",
    kitchenStockSettings: "[broken"
  });

  assert.deepEqual(readKitchenSession(storage), {
    token: "",
    user: "",
    role: "user",
    permissions: {},
    settings: {},
    theme: ""
  });
});

test("desktop inactivity monitor logs out after 15 minutes of no activity", () => {
  const storage = createStorage({
    kitchenStockToken: "token-1",
    kitchenStockUser: "Enno"
  });
  const listeners = new Map();
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  let reloads = 0;
  const windowObject = {
    navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 0 },
    location: { reload() { reloads += 1; } },
    matchMedia: () => ({ matches: false }),
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setTimeout(callback, delay) {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  const realNow = Date.now;
  Date.now = () => now;

  try {
    startKitchenInactivityMonitor({
      windowObject,
      navigatorObject: windowObject.navigator,
      storage
    });
    assert.equal(storage.getItem("kitchenStockLastActivityAt"), "1000");
    assert.equal(timers.size, 1);

    now += 15 * 60 * 1000 + 1;
    const timeout = [...timers.values()][0];
    timeout.callback();

    assert.equal(reloads, 1);
    assert.equal(storage.getItem("kitchenStockToken"), null);
    assert.equal(storage.getItem("kitchenStockLastActivityAt"), null);
  } finally {
    Date.now = realNow;
    stopKitchenInactivityMonitor({ windowObject, storage });
  }
});

test("desktop inactivity monitor stays off on phones and tablets", () => {
  const storage = createStorage({});
  let added = 0;
  const windowObject = {
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 },
    matchMedia: () => ({ matches: true }),
    addEventListener() {
      added += 1;
    },
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    location: { reload() {} }
  };

  assert.equal(isMobileOrTabletBrowser({ windowObject, navigatorObject: windowObject.navigator }), true);
  const monitor = startKitchenInactivityMonitor({
    windowObject,
    navigatorObject: windowObject.navigator,
    storage
  });
  assert.equal(monitor.enabled, false);
  assert.equal(added, 0);
});

test("json api client triggers unauthorized and password-change hooks", async () => {
  const events = [];
  const api = createJsonApiClient({
    getToken: () => "token-2",
    onUnauthorized: () => events.push("unauthorized"),
    onPasswordChangeRequired: () => events.push("password-change"),
    windowObject: { location: { href: "" } },
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      json: async () => ({ code: "PASSWORD_CHANGE_REQUIRED", error: "Change password" })
    })
  });

  await assert.rejects(() => api("/api/me"), /Change password/);
  assert.deepEqual(events, ["password-change"]);
});

test("json api client times out stalled requests", async () => {
  const api = createJsonApiClient({
    getToken: () => "token-2",
    requestTimeoutMs: 10,
    windowObject: {
      location: { href: "" },
      setTimeout,
      clearTimeout
    },
    fetchImpl: async (_path, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  await assert.rejects(() => api("/api/bootstrap"), /Request timed out after 10ms\./);
});

test("requestKitchenLogin returns parsed login payload", async () => {
  const data = await requestKitchenLogin({
    username: "enno",
    password: "1234",
    fetchImpl: async (path, options) => {
      assert.equal(path, "/api/login");
      assert.equal(options.method, "POST");
      assert.match(options.body, /"username":"enno"/);
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          token: "token-3",
          user: { name: "Enno", role: "admin", permissions: {} }
        })
      };
    }
  });

  assert.equal(data.token, "token-3");
  assert.equal(data.user.name, "Enno");
});

test("bindKitchenLogin submits credentials and forwards success result", async () => {
  const messages = [];
  const handlers = new Map();
  const form = {
    addEventListener(type, callback) {
      handlers.set(type, callback);
    }
  };

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      token: "token-4",
      user: { name: "Freddy", role: "user", permissions: {} }
    })
  });

  const results = [];
  bindKitchenLogin({
    loginForm: form,
    usernameInput: { value: "freddy" },
    passwordInput: { value: "5678" },
    setLoginMessage: (text, isError = false) => messages.push({ text, isError }),
    onSuccess: async (data) => {
      results.push(data.user.name);
    }
  });

  await handlers.get("submit")({
    preventDefault() {}
  });

  assert.deepEqual(results, ["Freddy"]);
  assert.deepEqual(messages, [{ text: "Logging in...", isError: false }]);
});

test("bindAuthenticatedBootstrap shows login when session is missing", () => {
  const events = [];
  bindAuthenticatedBootstrap({
    hasSession: () => false,
    showApp: () => events.push("app"),
    showLogin: () => events.push("login"),
    load: () => events.push("load"),
    onError: () => events.push("error")
  });
  assert.deepEqual(events, ["login"]);
});

test("bindAuthenticatedBootstrap shows app and runs loader when session exists", async () => {
  const events = [];
  bindAuthenticatedBootstrap({
    hasSession: () => true,
    showApp: () => events.push("app"),
    showLogin: () => events.push("login"),
    load: async () => {
      events.push("load");
    },
    onError: () => events.push("error")
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["app", "load"]);
});

test("bindLogoutButton wires the click handler to showLogin", async () => {
  const handlers = new Map();
  const button = {
    addEventListener(type, callback) {
      handlers.set(type, callback);
    }
  };
  const events = [];
  bindLogoutButton(button, () => events.push("login"));
  handlers.get("click")();
  assert.deepEqual(events, ["login"]);
});
