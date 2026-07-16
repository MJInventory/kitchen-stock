import test from "node:test";
import assert from "node:assert/strict";

import { addSupplierSpecificItemPrices } from "../lib/postgres-migrations/016-add-supplier-specific-item-prices.js";
import { createPostgresRowMappers } from "../lib/postgres-row-mappers.js";
import { createRequestDomain } from "../lib/request-domain.js";
import { renderReport } from "../public/order-report/render.js";

test("supplier pricing migration backfills current prices and refreshes price-aware reports", async () => {
  const statements = [];
  await addSupplierSpecificItemPrices(async (sql) => {
    statements.push(String(sql));
    return { rows: [], rowCount: 0 };
  });
  const sql = statements.join("\n");
  assert.match(sql, /create table if not exists inventory_item_supplier_prices/i);
  assert.match(sql, /on conflict \(inventory_item_id, supplier_id\) do nothing/i);
  assert.match(sql, /add column if not exists unit_price numeric\(12,2\)/i);
  assert.match(sql, /resolved_price\.unit_price/i);
  assert.match(sql, /total_value/i);
});

test("inventory item mapper exposes prices for every supplier", () => {
  const { pgItemFromRow } = createPostgresRowMappers();
  const item = pgItemFromRow({
    id: "item-1",
    name: "Coffee",
    supplier_id: "supplier-a",
    unit_price: "12.50",
    supplier_prices: [
      { supplierId: "supplier-a", unitPrice: "12.50" },
      { supplierId: "supplier-b", unitPrice: "10.25" }
    ]
  });
  assert.equal(item.unitPrice, 12.5);
  assert.deepEqual(item.supplierPrices, [
    { supplierId: "supplier-a", unitPrice: 12.5 },
    { supplierId: "supplier-b", unitPrice: 10.25 }
  ]);
});

test("order reports show supplier unit prices and line totals", () => {
  const host = () => ({ innerHTML: "", textContent: "", value: "" });
  const reportList = host();
  const standingReportList = host();
  renderReport({
    data: {
      date: "2026-07-16",
      summary: { totalLines: 1, deliveredValue: 25 },
      guestCount: {},
      rows: [{
        itemName: "Coffee",
        supplierName: "Supplier A",
        quantity: 2,
        unit: "box",
        unitPrice: 12.5,
        status: "Waiting"
      }],
      standingOrders: [{
        name: "Weekly Coffee",
        supplierName: "Supplier B",
        expectedDate: "2099-07-17",
        active: true,
        items: [{ itemName: "Coffee", quantity: 3, unit: "box", unitPrice: 10.25, lineTotal: 30.75 }]
      }],
      activity: [],
      activitySummary: {}
    },
    reportList,
    printDate: host(),
    guestCountInput: host(),
    guestNotesInput: host(),
    reportSummary: host(),
    standingReportSummaryList: host(),
    standingReportList,
    activitySummary: host(),
    activityReportList: host(),
    activeReportFilter: "all",
    activeActivityFilter: "all"
  });
  assert.match(reportList.innerHTML, /Price \/ unit/);
  assert.match(reportList.innerHTML, />12\.50</);
  assert.match(reportList.innerHTML, />25\.00</);
  assert.match(standingReportList.innerHTML, />10\.25</);
  assert.match(standingReportList.innerHTML, />30\.75</);
});

test("receiving without a typed price preserves the selected supplier price", async () => {
  const executed = [];
  const query = async (sql, params = []) => {
    const text = String(sql);
    executed.push({ sql: text, params });
    if (text.includes("from order_requests r") && text.includes("for update of r, i")) {
      return { rows: [{
        id: "request-1",
        request_number: 1,
        inventory_item_id: "item-1",
        quantity_needed: 2,
        requested_by_username: "Lizzy",
        delivered: false,
        status: "Approved",
        notes: "",
        standing_order_run_line_id: null,
        item_name: "Coffee",
        current_quantity: 4,
        supplier_id: "supplier-1",
        current_unit_price: "7.25",
        unit: "box"
      }] };
    }
    if (text.includes("from order_request_details_vw") && text.includes("order by request_number")) {
      return { rows: [{ id: "request-1", delivered: true, unit_price: "7.25" }] };
    }
    return { rows: [], rowCount: 1 };
  };
  const client = { query, release() {} };
  const handle = { query, connect: async () => client };
  const domain = createRequestDomain({
    db: () => handle,
    cache: { items: { expiresAt: 1 }, requests: { expiresAt: 1 } },
    allowedUnits: [],
    isValidId: (value) => Boolean(value),
    pgRequestFromRow: (row) => row,
    pgNumber: Number,
    pgRecordAuditEntry: async () => {},
    pgAreasForInventoryItemIds: async () => [],
    pgNotificationUsers: async () => [],
    pgCreateNotificationsForUsers: async () => {},
    presentUserName: (value) => value,
    getPgCloseStandingOrderRunIfCompleteTx: () => null
  });

  const result = await domain.pgDeliverRequest("request-1", "Enno", { quantityReceived: 2 });
  assert.equal(result.unitPrice, 7.25);
  const supplierPriceWrite = executed.find((entry) => entry.sql.includes("insert into inventory_item_supplier_prices"));
  assert.deepEqual(supplierPriceWrite?.params, ["item-1", "supplier-1", 7.25, "Enno"]);
  const snapshotWrite = executed.find((entry) => entry.sql.includes("set unit_price = $2") && entry.params[0] === "request-1");
  assert.deepEqual(snapshotWrite?.params, ["request-1", 7.25]);
});
