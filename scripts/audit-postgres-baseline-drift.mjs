import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const schemaPath = join(__dirname, "..", "database", "schema.sql");
const schemaSql = await readFile(schemaPath, "utf8");

const checks = [
  {
    name: "app_users.is_kitchen_staff",
    pattern: /is_kitchen_staff\s+boolean/i
  },
  {
    name: "app_users.kitchen_function",
    pattern: /kitchen_function\s+text/i
  },
  {
    name: "app_users.open_order_days",
    pattern: /open_order_days\s+integer/i
  },
  {
    name: "app_users.hidden_goto_menu",
    pattern: /hidden_goto_menu\s+jsonb/i
  },
  {
    name: "app_users.hidden_backoffice_menu",
    pattern: /hidden_backoffice_menu\s+jsonb/i
  },
  {
    name: "kitchen_shift_types table",
    pattern: /create table if not exists kitchen_shift_types/i
  },
  {
    name: "kitchen_roster_weeks table",
    pattern: /create table if not exists kitchen_roster_weeks/i
  },
  {
    name: "kitchen_roster_shifts table",
    pattern: /create table if not exists kitchen_roster_shifts/i
  },
  {
    name: "kitchen_shift_type_admin_vw view",
    pattern: /create or replace view kitchen_shift_type_admin_vw/i
  },
  {
    name: "kitchen_staff_vw view",
    pattern: /create or replace view kitchen_staff_vw/i
  },
  {
    name: "kitchen_roster_shift_vw view",
    pattern: /create or replace view kitchen_roster_shift_vw/i
  },
  {
    name: "internal_order_lines.auto_min_request_id",
    pattern: /auto_min_request_id\s+uuid/i
  },
  {
    name: "idx_internal_order_lines_batch_status",
    pattern: /create index if not exists idx_internal_order_lines_batch_status/i
  },
  {
    name: "idx_internal_order_batches_status_user",
    pattern: /create index if not exists idx_internal_order_batches_status_user/i
  },
  {
    name: "idx_app_notifications_related_request",
    pattern: /create index if not exists idx_app_notifications_related_request/i
  },
  {
    name: "idx_standing_order_run_lines_driver_sheet_line",
    pattern: /create index if not exists idx_standing_order_run_lines_driver_sheet_line/i
  }
];

const forbiddenChecks = [
  {
    name: "obsolete idx_internal_order_batches_status_requested",
    pattern: /create index if not exists idx_internal_order_batches_status_requested/i
  },
  {
    name: "obsolete idx_internal_order_lines_batch",
    pattern: /create index if not exists idx_internal_order_lines_batch\s/i
  }
];

const missing = checks
  .filter((check) => !check.pattern.test(schemaSql))
  .map((check) => check.name);

const obsolete = forbiddenChecks
  .filter((check) => check.pattern.test(schemaSql))
  .map((check) => check.name);

if (!missing.length && !obsolete.length) {
  console.log("Baseline schema file includes all audited drift markers.");
} else {
  console.table([
    ...missing.map((name) => ({ type: "missing", item: name })),
    ...obsolete.map((name) => ({ type: "obsolete", item: name }))
  ]);
  process.exitCode = 1;
}
