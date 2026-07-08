import test from "node:test";
import assert from "node:assert/strict";

import { createUserHelpers } from "../lib/user-helpers.js";
import { createInternalDataDomain } from "../lib/internal-data-domain.js";

test("security-admin role gets admin rights plus internal-data access", () => {
  const helpers = createUserHelpers({
    userConfig: "",
    editableUserSources: new Set(["postgres"]),
    gotoMenuOptions: [],
    backofficeMenuOptions: [],
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
});
