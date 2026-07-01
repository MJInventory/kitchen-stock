import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";

function db() {
  return getPool();
}

function hasPostgres() {
  return postgresEnabled();
}

const expectedIndexes = [
  { indexName: "idx_inventory_items_name", reason: "catalog item search and ordering" },
  { indexName: "idx_order_requests_open", reason: "open order filtering" },
  { indexName: "idx_app_notifications_user_read_created", reason: "notification inbox listing" },
  { indexName: "idx_push_subscriptions_user", reason: "push subscription lookup" },
  { indexName: "idx_audit_log_entries_date_created", reason: "audit trail listing" },
  { indexName: "idx_internal_order_batches_status_user", reason: "internal order batch listing" },
  { indexName: "idx_internal_order_lines_batch_status", reason: "internal order line loading" }
];

try {
  if (!hasPostgres()) {
    console.log("Postgres is not enabled. No expected-index audit available.");
    process.exit(0);
  }

  const names = expectedIndexes.map((entry) => entry.indexName);
  const result = await db().query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname = any($1::text[])
  `, [names]);

  const found = new Set(result.rows.map((row) => row.indexname));
  const missing = expectedIndexes
    .filter((entry) => !found.has(entry.indexName))
    .map((entry) => ({
      missing_index: entry.indexName,
      reason: entry.reason
    }));

  if (!missing.length) {
    console.log("All audited non-FK expected indexes are present.");
  } else {
    console.table(missing);
    process.exitCode = 1;
  }
} finally {
  await closePool();
}
