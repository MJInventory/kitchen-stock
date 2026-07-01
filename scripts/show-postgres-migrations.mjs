import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";
import { listPostgresMigrations } from "../lib/postgres-schema.js";

function db() {
  return getPool();
}

function hasPostgres() {
  return postgresEnabled();
}

try {
  if (!hasPostgres()) {
    console.log("Postgres is not enabled. No migration status available.");
    process.exit(0);
  }

  const migrations = await listPostgresMigrations({ hasPostgres, db });
  console.table(migrations.map((migration) => ({
    version: migration.version,
    applied: migration.applied ? "yes" : "no",
    applied_at: migration.appliedAt || "",
    description: migration.description
  })));
} finally {
  await closePool();
}
