import test from "node:test";
import assert from "node:assert/strict";

import { receivingItemDateLabel } from "../public/receiving-sheet/helpers.js";
import { renderStandingOrderRuns } from "../public/standing-orders/render.js";
import { createMutationApi } from "../lib/mutation-api.js";

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
