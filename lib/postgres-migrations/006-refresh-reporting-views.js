import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPORTING_VIEW_DROPS = [
  "order_report_summary_vw",
  "audit_daily_summary_vw",
  "driver_sheet_request_vw",
  "management_order_item_totals_vw",
  "management_order_summary_vw",
  "management_order_lines_vw",
  "standing_order_due_vw",
  "inventory_below_minimum_vw",
  "order_request_attention_vw",
  "order_request_supply_vw",
  "standing_order_overview_vw",
  "order_request_details_vw",
  "internal_order_details_vw"
];

async function readReportingViewStatements() {
  const schemaPath = join(__dirname, "..", "..", "database", "schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");
  const beginMarker = "-- BEGIN REPORTING_VIEWS";
  const endMarker = "-- END REPORTING_VIEWS";
  const beginIndex = schemaSql.indexOf(beginMarker);
  const endIndex = schemaSql.indexOf(endMarker);
  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw new Error("Could not find reporting view markers in database/schema.sql.");
  }
  const section = schemaSql
    .slice(beginIndex + beginMarker.length, endIndex)
    .trim();
  return section
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

export async function refreshReportingViews(query) {
  for (const viewName of REPORTING_VIEW_DROPS) {
    await query(`drop view if exists ${viewName}`);
  }
  const statements = await readReportingViewStatements();
  for (const statement of statements) {
    await query(statement);
  }
}
