import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";
import { ensurePostgresSchemaUpgrades } from "../lib/postgres-schema.js";

function db() {
  return getPool();
}

function hasPostgres() {
  return postgresEnabled();
}

try {
  if (!hasPostgres()) {
    console.log("Postgres is not enabled. Nothing to migrate.");
    process.exit(0);
  }
  await ensurePostgresSchemaUpgrades({ hasPostgres, db });
  console.log("Postgres migrations applied successfully.");
} finally {
  await closePool();
}
