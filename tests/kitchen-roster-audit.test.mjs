import test from "node:test";
import assert from "node:assert/strict";

import { createKitchenRosterDomain } from "../lib/kitchen-roster-domain.js";
import { labelForReasonCode } from "../public/order-report/helpers.js";

function createRosterHarness({ locked = false } = {}) {
  const auditEntries = [];
  const queries = [];
  const db = () => ({
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (text.includes("select count(*)::int as count")) return { rows: [{ count: 1 }] };
      if (text.includes("select locked from kitchen_roster_weeks")) return { rows: [{ locked }] };
      if (text.includes("select user_id::text as user_id")) {
        return {
          rows: [{
            user_id: "11111111-1111-1111-1111-111111111111",
            shift_date: "2026-07-13",
            shift_type_id: "22222222-2222-2222-2222-222222222222",
            notes: ""
          }]
        };
      }
      if (text.includes("select locked, locked_by_username, locked_at")) {
        return { rows: [{ locked, locked_by_username: locked ? "Freddy" : "", locked_at: null }] };
      }
      if (text.includes("from kitchen_shift_type_admin_vw")) return { rows: [] };
      if (text.includes("from kitchen_staff_vw")) return { rows: [] };
      if (text.includes("from kitchen_roster_shift_vw")) return { rows: [] };
      return { rows: [] };
    }
  });
  const domain = createKitchenRosterDomain({
    assertPostgresSchemaReady() {},
    db,
    todayIso: () => "2026-07-14",
    presentUserName: (value) => value,
    pgRecordAuditEntry: async (entry) => { auditEntries.push(entry); }
  });
  return { auditEntries, domain, queries };
}

test("saving a changed kitchen schedule records who changed which week", async () => {
  const { auditEntries, domain } = createRosterHarness();
  await domain.pgSaveKitchenRoster({
    weekStart: "2026-07-13",
    shifts: [{
      userId: "11111111-1111-1111-1111-111111111111",
      shiftDate: "2026-07-13",
      shiftTypeId: "33333333-3333-3333-3333-333333333333",
      notes: "Changed shift"
    }]
  }, { name: "Enno" });

  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].actorUsername, "Enno");
  assert.equal(auditEntries[0].entityType, "kitchen-schedule");
  assert.equal(auditEntries[0].entityName, "Kitchen schedule 2026-07-13 to 2026-07-19");
  assert.equal(auditEntries[0].reasonCode, "kitchen-roster-update");
  assert.equal(auditEntries[0].note, "1 schedule cell changed.");
  assert.equal(auditEntries[0].before.cells[0].shiftTypeId, "22222222-2222-2222-2222-222222222222");
  assert.equal(auditEntries[0].after.cells[0].shiftTypeId, "33333333-3333-3333-3333-333333333333");
});

test("locking a kitchen schedule records the actor and lock event", async () => {
  const { auditEntries, domain } = createRosterHarness({ locked: false });
  await domain.pgSetKitchenRosterLocked({ weekStart: "2026-07-13", locked: true }, { name: "Enno" });
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].actorUsername, "Enno");
  assert.equal(auditEntries[0].reasonCode, "kitchen-roster-lock");
  assert.equal(auditEntries[0].after.locked, true);
  assert.equal(labelForReasonCode(auditEntries[0].reasonCode), "Kitchen schedule locked");
});
