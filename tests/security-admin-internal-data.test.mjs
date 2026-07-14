import test from "node:test";
import assert from "node:assert/strict";

import { createUserHelpers } from "../lib/user-helpers.js";
import { createAppUserApi } from "../lib/app-user-api.js";
import { createInternalDataDomain } from "../lib/internal-data-domain.js";
import { normalizeHiddenMenuItems } from "../lib/server-core-utils.js";

test("security-admin role gets admin rights plus internal-data access", () => {
  const helpers = createUserHelpers({
    userConfig: "",
    editableUserSources: new Set(["postgres"]),
    gotoMenuOptions: ["/ordering.html"],
    backofficeMenuOptions: ["/standing-orders.html"],
    authSecret: "secret",
    sessionMaxAgeMs: 1000,
    clampOpenOrderDays: (value) => Number(value || 7),
    normalizeHiddenMenuItems: () => []
  });

  const role = helpers.normalizeRole("Security Admin");
  const permissions = helpers.userPermissions(role, {});
  assert.equal(role, "security-admin");
  assert.equal(permissions.canViewInternalData, true);
  assert.equal(permissions.canAdminUsers, true);
  assert.equal(permissions.canManageKitchenRoster, true);
  assert.equal(permissions.canAddInventoryItems, true);
  assert.equal(permissions.canManageSecurityRole, false);
});

test("public user settings expose desktop inactivity timeout and default it to enabled", () => {
  const helpers = createUserHelpers({
    userConfig: "",
    editableUserSources: new Set(["postgres"]),
    gotoMenuOptions: ["/ordering.html"],
    backofficeMenuOptions: ["/standing-orders.html"],
    authSecret: "secret",
    sessionMaxAgeMs: 1000,
    clampOpenOrderDays: (value) => Number(value || 7),
    normalizeHiddenMenuItems
  });

  const enabledByDefault = helpers.publicUser({ name: "Enno", role: "god" });
  assert.equal(enabledByDefault.settings.desktopIdleTimeoutEnabled, true);
  assert.deepEqual(enabledByDefault.settings.blockedGotoMenu, []);
  assert.deepEqual(enabledByDefault.settings.blockedBackofficeMenu, []);

  const disabled = helpers.publicUser({
    name: "Freddy",
    role: "user",
    desktop_idle_timeout_enabled: false,
    blocked_goto_menu: ["/ordering.html"],
    blocked_backoffice_menu: ["/standing-orders.html"]
  });
  assert.equal(disabled.settings.desktopIdleTimeoutEnabled, false);
  assert.deepEqual(disabled.settings.blockedGotoMenu, ["/ordering.html"]);
  assert.deepEqual(disabled.settings.blockedBackofficeMenu, ["/standing-orders.html"]);
});

function createManagedUserApiHarness(actor) {
  let updatedPayload = null;
  let response = null;
  const handler = createAppUserApi({
    bcrypt: { compare: async () => false },
    hasPostgres: () => true,
    pushEnabled: false,
    vapidPublicKey: "",
    readJson: async () => ({
      role: "user",
      blockedGotoMenu: ["/ordering.html"],
      blockedBackofficeMenu: ["/standing-orders.html"],
      desktopIdleTimeoutEnabled: false
    }),
    send: (_res, status, body) => { response = { status, body }; },
    requireUser: () => actor,
    requireRole: () => true,
    storeSession: (user) => user,
    publicUser: (user) => user,
    publicUserForAdmin: (user) => user,
    canChangeAppUserRole: () => true,
    canDeleteAppUserRecord: () => true,
    findAppUserByName: async () => null,
    changeOwnPassword: async () => ({}),
    refreshUserFromDirectory: async (user) => user,
    pgRecordSuccessfulLogin: async () => "",
    pgGetOwnSettings: async () => ({}),
    pgUpdateOwnSettings: async () => ({}),
    pgSavePushSubscription: async () => ({}),
    pgRemovePushSubscription: async () => ({}),
    getAppUsers: async () => [],
    createAppUser: async () => ({}),
    findAppUserById: async () => ({ id: "user-1", role: "user" }),
    updateAppUser: async (_id, payload) => {
      updatedPayload = payload;
      return payload;
    },
    deleteAppUser: async () => ({})
  });
  return {
    async patch() {
      await handler({ method: "PATCH", url: "/api/app-users/user-1" }, {});
      return { updatedPayload, response };
    }
  };
}

test("ordinary admins cannot change God-only screen access or inactivity controls", async () => {
  const harness = createManagedUserApiHarness({
    name: "Admin",
    permissions: { canAdminUsers: true, canManageAdminRoles: false }
  });
  const { updatedPayload, response } = await harness.patch();
  assert.equal(response.status, 200);
  assert.equal(updatedPayload.role, "user");
  assert.equal("blockedGotoMenu" in updatedPayload, false);
  assert.equal("blockedBackofficeMenu" in updatedPayload, false);
  assert.equal("desktopIdleTimeoutEnabled" in updatedPayload, false);
});

test("God can change per-user screen access and inactivity controls", async () => {
  const harness = createManagedUserApiHarness({
    name: "Enno",
    permissions: { canAdminUsers: true, canManageAdminRoles: true }
  });
  const { updatedPayload, response } = await harness.patch();
  assert.equal(response.status, 200);
  assert.deepEqual(updatedPayload.blockedGotoMenu, ["/ordering.html"]);
  assert.deepEqual(updatedPayload.blockedBackofficeMenu, ["/standing-orders.html"]);
  assert.equal(updatedPayload.desktopIdleTimeoutEnabled, false);
});

test("internal data domain stores encrypted password, lists safe summaries, and audits changes", async () => {
  let storedRow = null;
  const auditCalls = [];
  const db = () => ({
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("insert into internal_data_services")) {
        storedRow = {
          id: "11111111-1111-1111-1111-111111111111",
          service_name: params[0],
          service_url: params[1],
          username: params[2],
          password_encrypted: params[3],
          two_factor_enabled: params[4],
          two_factor_details: params[5],
          memo: params[6],
          created_by_username: params[7],
          updated_by_username: params[7],
          created_at: "",
          updated_at: ""
        };
        return { rows: [storedRow] };
      }
      if (text.includes("from internal_data_services")) {
        return { rows: [storedRow] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  });

  const domain = createInternalDataDomain({
    assertPostgresSchemaReady: () => {},
    db,
    isValidId: () => true,
    authSecret: "top-secret",
    auditChanged: (before, after) => JSON.stringify(before) !== JSON.stringify(after),
    pgRecordAuditEntry: async (payload) => { auditCalls.push(payload); }
  });

  const saved = await domain.saveInternalDataService({
    serviceName: "Render",
    serviceUrl: "render.com",
    username: "enno",
    password: "super-secret",
    twoFactorEnabled: true,
    twoFactorDetails: "Phone",
    memo: "Production"
  }, "", "Enno");

  assert.notEqual(storedRow.password_encrypted, "super-secret");
  assert.equal(saved.password, "super-secret");

  const listed = await domain.listInternalDataServices();
  assert.equal(listed[0].password, undefined);
  assert.equal(listed[0].serviceUrl, "https://render.com");
  assert.equal(auditCalls[0]?.reasonCode, "internal-data-create");
  assert.equal(auditCalls[0]?.after?.password, "[hidden]");

  const detail = await domain.getInternalDataServiceDetail(saved.id);
  assert.equal(detail.password, "super-secret");

  const exportRows = await domain.listInternalDataServicesForExport();
  assert.equal(exportRows[0].password, "super-secret");
  assert.equal(exportRows[0].username, "enno");
});
