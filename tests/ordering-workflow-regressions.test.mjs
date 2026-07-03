import test from "node:test";
import assert from "node:assert/strict";

import { submitOrderingSelection } from "../public/ordering/controller-actions.js";
import { createMutationApi } from "../lib/mutation-api.js";
import { createRequestDomain } from "../lib/request-domain.js";

function createOrderingHarness(overrides = {}) {
  const queueCalls = [];
  const messages = [];
  const renders = [];
  const refreshCalls = [];
  const submitButton = { disabled: false };
  globalThis.window = {
    setTimeout(callback) {
      callback();
      return 1;
    }
  };

  const selected = overrides.selected || new Map();
  const recentRequests = overrides.recentRequests || [];

  return {
    queueCalls,
    messages,
    renders,
    refreshCalls,
    submitButton,
    selected,
    recentRequests,
    args: {
      selected,
      recentRequests,
      submitButton,
      setMessage: (text, isError = false) => messages.push({ text, isError }),
      queueApi: async (path, options, meta) => {
        queueCalls.push({ path, options, meta });
        if (path === "/api/requests/batch") {
          return {
            requests: [{
              id: "saved-request-1",
              itemId: "item-save",
              requestedAt: "2026-07-03T10:00:00.000Z",
              requestId: 99
            }]
          };
        }
        if (path === "/api/requests/existing-request-1") {
          return {
            request: {
              id: "existing-request-1",
              itemId: "item-existing",
              requestedAt: "2026-07-03T11:00:00.000Z",
              requestId: 101
            }
          };
        }
        return { ok: true };
      },
      confirmDuplicateSave: overrides.confirmDuplicateSave || (() => true),
      itemUnit: (item) => item.unit || "box",
      sessionUser: "Enno",
      optimisticRequestFromEntry: (entry, index) => ({
        id: `offline-${index}`,
        itemId: entry.item.id,
        requestedAt: "2026-07-03T10:00:00.000Z",
        requestId: index + 1
      }),
      buildSelectedFromRecentRequests: overrides.buildSelectedFromRecentRequests || ((requests) => new Map(
        requests.map((request) => [request.itemId, { item: { id: request.itemId }, requestId: request.id }])
      )),
      render: (requests, nextSelected) => renders.push({ requests, nextSelected }),
      updateSaveButton: () => {
        submitButton.disabled = false;
      },
      refresh: async () => {
        refreshCalls.push("refresh");
      }
    }
  };
}

test("submitOrderingSelection saves new items and deletes removed ones in one batch", async () => {
  const selected = new Map([
    ["item-save", {
      item: {
        id: "item-save",
        name: "Mint",
        unit: "bag",
        storageLocation: "Cooler",
        inventoryArea: "Kitchen",
        shelfCode: "A1"
      },
      quantity: 3,
      urgency: "Medium",
      unit: "bag",
      deleteRequested: false
    }],
    ["item-delete", {
      item: {
        id: "item-delete",
        name: "Sugar",
        unit: "box",
        storageLocation: "Dry Storage",
        inventoryArea: "General",
        shelfCode: "B1"
      },
      requestId: "delete-me-1",
      quantity: 1,
      urgency: "Low",
      unit: "box",
      deleteRequested: true
    }]
  ]);
  const recentRequests = [
    { id: "delete-me-1", itemId: "item-delete", requestedAt: "2026-07-02T10:00:00.000Z", requestId: 10 }
  ];
  const harness = createOrderingHarness({ selected, recentRequests });

  const result = await submitOrderingSelection(harness.args);

  assert.equal(harness.queueCalls.length, 2);
  assert.equal(harness.queueCalls[0].path, "/api/requests/delete-me-1");
  assert.equal(harness.queueCalls[0].options.method, "DELETE");
  assert.equal(harness.queueCalls[1].path, "/api/requests/batch");
  assert.equal(harness.queueCalls[1].options.method, "POST");
  assert.match(harness.queueCalls[1].options.body, /"itemId":"item-save"/);
  assert.equal(harness.messages.at(-1)?.text, "1 item(s) saved and 1 item(s) deleted.");
  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(result.recentRequests.length, 1);
  assert.equal(result.recentRequests[0].id, "saved-request-1");
});

test("submitOrderingSelection cancels duplicate saves without calling the API", async () => {
  const selected = new Map([
    ["item-save", {
      item: { id: "item-save", name: "Mint", unit: "bag" },
      quantity: 2,
      urgency: "Medium",
      unit: "bag",
      deleteRequested: false
    }]
  ]);
  const harness = createOrderingHarness({
    selected,
    confirmDuplicateSave: () => false
  });

  const result = await submitOrderingSelection(harness.args);

  assert.equal(harness.queueCalls.length, 0);
  assert.equal(harness.messages.at(-1)?.text, "Duplicate save cancelled.");
  assert.equal(result.selected, selected);
});

test("submitOrderingSelection updates existing orders instead of creating duplicates", async () => {
  const selected = new Map([
    ["item-existing", {
      item: {
        id: "item-existing",
        name: "Kahlua",
        unit: "box",
        storageLocation: "Bar",
        inventoryArea: "General",
        shelfCode: "C1"
      },
      requestId: "existing-request-1",
      quantity: 4,
      urgency: "High",
      unit: "box",
      deleteRequested: false
    }]
  ]);
  const recentRequests = [
    { id: "existing-request-1", itemId: "item-existing", requestedAt: "2026-07-03T09:00:00.000Z", requestId: 101 }
  ];
  const harness = createOrderingHarness({ selected, recentRequests });

  const result = await submitOrderingSelection(harness.args);

  assert.equal(harness.queueCalls.length, 1);
  assert.equal(harness.queueCalls[0].path, "/api/requests/existing-request-1");
  assert.equal(harness.queueCalls[0].options.method, "PATCH");
  assert.match(harness.queueCalls[0].options.body, /"quantityNeeded":4/);
  assert.equal(harness.messages.at(-1)?.text, "1 item(s) updated.");
  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(result.recentRequests[0].id, "existing-request-1");
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
    updateRequest: async (...args) => {
      calls.push(["updateRequest", ...args]);
      return { ok: true };
    },
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
    restoreDeletedRequestFromAudit: async (...args) => {
      calls.push(["restoreDeletedRequestFromAudit", ...args]);
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

test("mutation api routes request undo-delivery through undoDeliveredRequest", async () => {
  const { handler, calls, getSent } = createMutationApiHarness();
  const handled = await handler(
    { method: "POST", url: "/api/requests/44444444-4444-4444-4444-444444444444/undo-delivery" },
    {}
  );
  assert.equal(handled, true);
  assert.deepEqual(calls, [[
    "undoDeliveredRequest",
    "44444444-4444-4444-4444-444444444444",
    "Enno"
  ]]);
  assert.equal(getSent()?.status, 200);
});

test("mutation api routes request patch through updateRequest", async () => {
  const payload = { quantityNeeded: 5, unitOverride: "box", urgencyLevel: "High" };
  const { handler, calls, getSent } = createMutationApiHarness({ payload });
  const handled = await handler(
    { method: "PATCH", url: "/api/requests/55555555-5555-5555-5555-555555555555" },
    {}
  );
  assert.equal(handled, true);
  assert.deepEqual(calls, [[
    "updateRequest",
    "55555555-5555-5555-5555-555555555555",
    payload,
    "Enno"
  ]]);
  assert.equal(getSent()?.status, 200);
});

test("mutation api routes restore-deleted order through restoreDeletedRequestFromAudit", async () => {
  const { handler, calls, getSent } = createMutationApiHarness();
  const handled = await handler(
    { method: "POST", url: "/api/requests/restore-from-audit/c369ffd9-c8ec-4837-bf41-1a7d364da08d" },
    {}
  );
  assert.equal(handled, true);
  assert.deepEqual(calls, [[
    "restoreDeletedRequestFromAudit",
    "c369ffd9-c8ec-4837-bf41-1a7d364da08d",
    "Enno"
  ]]);
  assert.equal(getSent()?.status, 200);
});

test("request domain standing-order quantity edits reopen linked request and driver line", async () => {
  const executed = [];
  const queryImpl = async (sql, params = []) => {
    const text = String(sql);
    executed.push({ sql: text, params });
    if (text.includes("from standing_order_run_lines sorl")) {
      return {
        rows: [{
          id: "line-2",
          standing_order_run_id: "run-2",
          inventory_item_id: "item-2",
          order_request_id: "request-2",
          quantity: 4,
          received: false,
          status: "Scheduled",
          unit: "box",
          item_name: "Blueberry",
          current_quantity: 12,
          resolved_request_id: "request-2"
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

  const result = await domain.pgUpdateStandingOrderRunLine("line-2", { quantity: 7 }, "Enno");

  assert.equal(result.quantity, 7);
  assert.ok(executed.some((entry) => entry.sql.includes("update standing_order_run_lines")));
  assert.ok(executed.some((entry) => entry.sql.includes("update order_requests")));
  assert.ok(executed.some((entry) => entry.sql.includes("update driver_sheet_lines")));
  assert.ok(executed.some((entry) => entry.sql.includes("update standing_order_runs")));
});
