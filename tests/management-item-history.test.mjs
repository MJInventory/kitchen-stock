import test from "node:test";
import assert from "node:assert/strict";

import { createReportSupportDomain } from "../lib/report-support-domain.js";
import {
  buildManagementHistoryTable,
  buildManagementPeriodTable
} from "../public/management-item-history.js";

test("management item history returns order snapshots and database period averages", async () => {
  const calls = [];
  const query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (text.includes("from inventory_items") && text.includes("name ilike")) {
      return { rows: [{ id: "item-1", name: "Coffee" }] };
    }
    if (text.includes("from inventory_items") && text.includes("where id = $1")) {
      return { rows: [{ id: "item-1", name: "Coffee" }] };
    }
    if (text.includes("from management_order_lines_vw") && !text.includes("date_trunc")) {
      return { rows: [{
        request_id: "request-1",
        request_number: 17,
        requested_at: "2026-07-30T12:00:00.000Z",
        requested_by_username: "Lizzy",
        supplier_name: "Supplier A",
        quantity_needed: "4",
        unit_name: "box",
        unit_price: "12.50",
        total_value: "50.00",
        status: "Approved",
        ordered: true,
        delivered: false,
        standing_order_run_id: null,
        standing_order_run_line_id: null
      }] };
    }
    if (text.includes("date_trunc")) {
      return { rows: [{
        period_start: "2026-07-30",
        order_count: "1",
        total_quantity: "4",
        average_order_quantity: "4",
        average_unit_price: "12.50",
        total_value: "50.00"
      }] };
    }
    return { rows: [] };
  };
  const domain = createReportSupportDomain({
    assertPostgresSchemaReady: () => {},
    db: () => ({ query }),
    pgRecordAuditEntry: async () => {},
    todayIso: () => "2026-07-31",
    isValidId: (value) => Boolean(value)
  });

  const matches = await domain.pgSearchManagementItems("cof");
  const result = await domain.pgGetManagementItemHistory("item-1");

  assert.deepEqual(matches, [{ id: "item-1", name: "Coffee" }]);
  assert.equal(result.item.name, "Coffee");
  assert.equal(result.history[0].unitPrice, 12.5);
  assert.equal(result.history[0].status, "Ordered");
  assert.equal(result.summary.averageUnitPrice, 12.5);
  assert.equal(result.averages.day[0].averageOrderQuantity, 4);
  assert.ok(calls.some((call) => call.params[1] === "week"));
  assert.ok(calls.some((call) => call.params[1] === "month"));
});

test("management item history tables show prices, suppliers, and period averages", () => {
  const periodHtml = buildManagementPeriodTable([{
    periodStart: "2026-07-28",
    orderCount: 2,
    totalQuantity: 5,
    averageOrderQuantity: 2.5,
    averageUnitPrice: 12.75,
    totalValue: 63.75
  }], "week");
  const historyHtml = buildManagementHistoryTable([{
    requestedAt: "2026-07-30T12:00:00.000Z",
    supplierName: "Supplier A",
    quantity: 4,
    unit: "box",
    unitPrice: 12.5,
    totalValue: 50,
    status: "Delivered",
    requestedBy: "Lizzy",
    standingOrder: true
  }]);

  assert.match(periodHtml, /Week starting/);
  assert.match(periodHtml, /12\.75/);
  assert.match(historyHtml, /Supplier A/);
  assert.match(historyHtml, /Lizzy/);
  assert.match(historyHtml, /Standing/);
  assert.match(historyHtml, /50\.00/);
});
