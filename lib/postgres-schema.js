import { POSTGRES_MIGRATIONS } from "./postgres-migrations.js";

let postgresSchemaReady = null;
let postgresSchemaInitialized = false;
const POSTGRES_MIGRATION_LOCK_ID = 48484821;

async function ensureSchemaMigrationsTable(query) {
  await query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function applyMigrationIfNeeded(query, version, migrate) {
  const existing = await query(`select version from schema_migrations where version = $1`, [version]);
  if (existing.rowCount) return false;
  await migrate();
  await query(`insert into schema_migrations (version) values ($1)`, [version]);
  return true;
}

async function runTransactionalMigration(query, migration) {
  await query("begin");
  try {
    await applyMigrationIfNeeded(query, migration.version, async () => {
      await migration.migrate(query);
    });
    await query("commit");
  } catch (error) {
    try {
      await query("rollback");
    } catch {
      // Ignore rollback errors so the original migration error surfaces.
    }
    throw error;
  }
}

async function runNonTransactionalMigration(query, migration) {
  await applyMigrationIfNeeded(query, migration.version, async () => {
    await migration.migrate(query);
  });
}

async function readAppliedMigrations(query) {
  const tableCheck = await query(`
    select to_regclass('public.schema_migrations') as table_name
  `);
  if (!tableCheck.rows[0]?.table_name) return new Map();
  const applied = await query(`
    select version, applied_at
    from schema_migrations
  `);
  return new Map(
    applied.rows.map((row) => [row.version, row.applied_at])
  );
}

export async function ensurePostgresSchemaUpgrades({ hasPostgres, db }) {
  if (!hasPostgres()) return;
  if (postgresSchemaReady) return postgresSchemaReady;
  postgresSchemaReady = (async () => {
    const client = await db().connect();
    const query = (text, params = []) => client.query(text, params);
    try {
      await query("select pg_advisory_lock($1)", [POSTGRES_MIGRATION_LOCK_ID]);
      await ensureSchemaMigrationsTable(query);
      for (const migration of POSTGRES_MIGRATIONS) {
        if (migration.transaction === false) {
          await runNonTransactionalMigration(query, migration);
        } else {
          await runTransactionalMigration(query, migration);
        }
      }
    } finally {
      try {
        await query("select pg_advisory_unlock($1)", [POSTGRES_MIGRATION_LOCK_ID]);
      } catch {
        // Ignore unlock errors because the session release also clears the lock.
      }
      client.release();
    }
    postgresSchemaInitialized = true;
  })().catch((error) => {
    postgresSchemaReady = null;
    postgresSchemaInitialized = false;
    throw error;
  });
  return postgresSchemaReady;
}

export function assertPostgresSchemaReady({ hasPostgres }) {
  if (!hasPostgres()) return;
  if (postgresSchemaInitialized) return;
  throw new Error("PostgreSQL schema is not initialized yet. Start the server through the normal bootstrap path before serving requests.");
}

export async function listPostgresMigrations({ hasPostgres, db }) {
  if (!hasPostgres()) return [];
  const client = await db().connect();
  const query = (text, params = []) => client.query(text, params);
  try {
    const appliedMigrations = await readAppliedMigrations(query);
    return POSTGRES_MIGRATIONS.map((migration) => {
      const appliedAt = appliedMigrations.get(migration.version) || null;
      return {
        version: migration.version,
        description: migration.description || "",
        applied: Boolean(appliedAt),
        appliedAt
      };
    });
  } finally {
    client.release();
  }
}
