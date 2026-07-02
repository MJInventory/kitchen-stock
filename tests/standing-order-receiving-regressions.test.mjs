import test from "node:test";
import assert from "node:assert/strict";

import { receivingItemDateLabel } from "../public/receiving-sheet/helpers.js";
import { renderStandingOrderRuns } from "../public/standing-orders/render.js";
import { createMutationApi } from "../lib/mutation-api.js";
import { createRequestDomain } from "../lib/request-domain.js";
import { createStandingOrderDomain } from "../lib/standing-order-domain.js";

test("receivingItemDateLabel shows scheduled date for standing orders from expectedDate", () => {
  const label = receivingItemDateLabel({
    originType: "standing",
    expectedDate: "2026-07-02T11:12:13.000Z"
  });
  assert.equal(label, "Scheduled 2026-07-02");
});

test("receivingItemDateLabel falls back to notes for standing orders", () => {
  const label = receivingItemDateLabel({
    originType: "standing",
    notes: "Standing order name: Weekly herbs.\nExpected arrival: 2026-07-03.\nOther note."
  });
  assert.equal(label, "Scheduled 2026-07-03");
});

test("receivingItemDateLabel shows ordered date for regular requests", () => {
  const label = receivingItemDateLabel({
    originType: "user",
    orderedAt: "2026-07-01T04:05:06.000Z"
  });
  assert.equal(label, "Ordered 2026-07-01");
});

test("renderStandingOrderRuns keeps received rows reopenable and open rows editable", () => {
  const standingRunList = { innerHTML: "" };
  renderStandingOrderRuns({
    runs: [{
      id: "run-1",
      name: "Weekly Produce",
      supplierName: "Deli Nova",
      expectedDate: "2026-07-02",
      status: "Open",
      generatedAt: "2026-07-02T08:00:00.000Z",
      openLines: 1,
      totalLines: 2,
      receivedLines: 1,
      lines: [
        {
          id: "line-open",
          orderRequestId: "11111111-1111-1111-1111-111111111111",
          itemName: "Arugulla",
          quantity: 8,
          unit: "box",
          shelfCode: "TBD",
          inventoryArea: "Kitchen",
          storageLocation: "Cooler",
          received: false
        },
        {
          id: "line-received",
          orderRequestId: "",
          itemName: "Mint Fresh",
          quantity: 2,
          unit: "bag",
          shelfCode: "TBD",
          inventoryArea: "General",
          storageLocation: "Cooler",
          received: true
        }
      ]
    }],
    standingRunList,
    expandedRunId: "run-1",
    statusFilter: "open"
  });

  assert.match(standingRunList.innerHTML, /standing-run-open-qty/);
  assert.match(standingRunList.innerHTML, /data-run-line-id="line-received"/);
  assert.doesNotMatch(standingRunList.innerHTML, /standing-run-received-button checked" type="button" disabled/);
  assert.doesNotMatch(standingRunList.innerHTML, /data-run-line-id="line-received"[\s\S]*standing-run-delete-button/);
});

function createMutationApiHarness(overrides = {}) {
  const calls = [];
  let sent = null;
  const noop = async () => ({});
  const handler = createMutationApi({
    requireUser: () => ({ name: "Enno", permissions: { canAddInventoryItems: true } }),
    requireRole: () => true,
    readJson: async () => overrides.payload || {},
    send: (_res, status, body) => {
      sent = { status, body };
    },
    updateItemSettings: noop,
    deleteInventoryItem: noop,
    createInventoryItem: noop,
    createStockCount: noop,
    createInvoiceCapture: noop,
    createInvoiceLine: noop,
    listOcrRules: noop,
    createOcrRule: noop,
    emailInvoicePicture: noop,
    ocrSpaceParseImage: noop,
    deliverRequest: async (...args) => {
      calls.push(["deliverRequest", ...args]);
      return { ok: true };
    },
    deliverStandingOrderRunLine: async (...args) => {
      calls.push(["deliverStandingOrderRunLine", ...args]);
      return { ok: true };
    },
    updateStandingOrderRunLine: async (...args) => {
      calls.push(["updateStandingOrderRunLine", ...args]);
      return { ok: true };
    },
    undoDeliveredStandingOrderRunLine: async (...args) => {
      calls.push(["undoDeliveredStandingOrderRunLine", ...args]);
      return { ok: true };
    },
    undoDeliveredRequest: async (...args) => {
      calls.push(["undoDeliveredRequest", ...args]);
      return { ok: true };
    },
    updateDriverLine: noop,
    deliverDriverLine: noop,
    canDeleteRequest: async () => true,
    deleteRequest: noop,
    deleteStandingOrderRunLine: noop
  });
  return { handler, calls, getSent: () => sent };
}

test("mutation api routes standing-order run line undo-delivery to the dedicated handler", async () => {
  const { handler, calls, getSent } = createMutationApiHarness();
  const handled = await handler(
    { method: "POST", url: "/api/standing-order-run-lines/22222222-2222-2222-2222-222222222222/undo-delivery" },
    {}
  );
  assert.equal(handled, true);
  assert.deepEqual(calls, [[
    "undoDeliveredStandingOrderRunLine",
    "22222222-2222-2222-2222-222222222222",
    "Enno"
  ]]);
  assert.equal(getSent()?.status, 200);
});

test("mutation api routes standing-order run line quantity edits through updateStandingOrderRunLine", async () => {
  const payload = { quantity: 5 };
  const { handler, calls, getSent } = createMutationApiHarness({ payload });
  const handled = await handler(
    { method: "PATCH", url: "/api/standing-order-run-lines/33333333-3333-3333-3333-333333333333" },
    {}
  );
  assert.equal(handled, true);
  assert.deepEqual(calls, [[
    "updateStandingOrderRunLine",
    "33333333-3333-3333-3333-333333333333",
    payload,
    "Enno"
  ]]);
  assert.equal(getSent()?.status, 200);
});

test("request domain can reopen a received standing-order run line without a request id", async () => {
  const executed = [];
  const queryImpl = async (sql, params = []) => {
    const text = String(sql);
    executed.push({ sql: text, params });
    if (text.includes("from standing_order_run_lines sorl")) {
      return {
        rows: [{
          id: "line-1",
          standing_order_run_id: "run-1",
          inventory_item_id: "item-1",
          order_request_id: null,
          quantity: 2,
          received: true,
          status: "Received",
          unit: "bag",
          item_name: "Mint Fresh",
          current_quantity: 10,
          resolved_request_id: null
        }]
      };
    }
    return { rows: [], rowCount: 1 };
  };
  const client = {
    query: queryImpl,
    release() {}
  };
  const dbHandle = {
    query: queryImpl,
    connect: async () => client
  };
  const domain = createRequestDomain({
    db: () => dbHandle,
    cache: { items: { expiresAt: 1 }, requests: { expiresAt: 1 } },
    allowedUnits: [],
    isValidId: (value) => Boolean(String(value || "").trim()),
    pgRequestFromRow: (row) => row,
    pgNumber: Number,
    pgRecordAuditEntry: async () => {},
    pgAreasForInventoryItemIds: async () => [],
    pgNotificationUsers: async () => [],
    pgCreateNotificationsForUsers: async () => {},
    presentUserName: (value) => value,
    getPgCloseStandingOrderRunIfCompleteTx: () => null
  });

  const result = await domain.pgUndoDeliveredStandingOrderRunLine("line-1", "Enno");
  assert.deepEqual(result, { id: "line-1", reopened: true });
  assert.ok(executed.some((entry) => entry.sql.includes("insert into stock_counts")));
  assert.ok(executed.some((entry) => entry.sql.includes("update standing_order_run_lines")));
  assert.ok(executed.some((entry) => entry.sql.includes("update standing_order_runs")));
});

test("standing-order rebuild recreates stale request links instead of updating missing requests", async () => {
  const executed = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      executed.push({ sql: text, params });
      if (text.includes("from standing_order_run_lines sorl")) {
        return {
          rows: [{
            id: "line-stale",
            inventory_item_id: "item-1",
            order_request_id: "missing-request",
            quantity: 4,
            unit: "box",
            supplier_name: "Deli Nova",
            received: false,
            status: "Scheduled",
            resolved_request_id: null,
            partial_receipt: false
          }]
        };
      }
      if (text.includes("insert into order_requests")) {
        return { rows: [{ id: "new-request-1" }] };
      }
      if (text.includes("insert into standing_order_run_lines")) {
        return { rows: [{ id: "new-line-1" }] };
      }
      return { rows: [], rowCount: 1 };
    }
  };

  const domain = createStandingOrderDomain({
    db: {
      query: async () => ({ rows: [] }),
      connect: async () => client
    },
    cache: { requests: { expiresAt: 1 } },
    todayIso: () => "2026-07-02",
    isValidId: (value) => Boolean(String(value || "").trim()),
    ensurePostgresSchemaUpgrades: async () => {},
    pgStandingOrderFromRow: (row) => row,
    pgFindOrCreateSupplierByName: async () => ({ id: "supplier-1" }),
    pgCreateRequest: async () => ({ id: "unused" }),
    pgCreateNotificationsForUsers: async () => {},
    pgNotificationUsers: async () => [],
    pgRecordAuditEntry: async () => {}
  });

  await domain.pgRebuildStandingOrderRunTx(
    client,
    "run-1",
    "order-1",
    "2026-07-02",
    {
      schedule: "Weekly",
      name: "Weekly produce",
      supplierName: "Deli Nova",
      otherSchedule: "",
      notes: "",
      items: [{ itemId: "item-1", quantity: 6 }]
    },
    "Enno"
  );

  assert.ok(executed.some((entry) => entry.sql.includes("insert into order_requests")));
  assert.ok(executed.some((entry) => entry.sql.includes("insert into standing_order_run_lines")));
  assert.ok(executed.every((entry) => !entry.sql.includes("update order_requests\n          set quantity_needed")));
});
