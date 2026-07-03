import test from "node:test";
import assert from "node:assert/strict";

import {
  clearKitchenSession,
  readKitchenSession,
  writeKitchenSession
} from "../public/session-shell.js";
import { createJsonApiClient } from "../public/api-client.js";
import { requestKitchenLogin, bindKitchenLogin } from "../public/login-flow.js";

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
