import { POSTGRES_MIGRATIONS } from "./postgres-migrations.js";

let postgresSchemaReady = null;

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
      await query("begin");
      await query("select pg_advisory_xact_lock($1)", [48484821]);
      await ensureSchemaMigrationsTable(query);
      for (const migration of POSTGRES_MIGRATIONS) {
        await applyMigrationIfNeeded(query, migration.version, async () => {
          await migration.migrate(query);
        });
      }
      await query("commit");
    } catch (error) {
      try {
        await query("rollback");
      } catch {
        // Ignore rollback errors so the original startup error surfaces.
      }
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    postgresSchemaReady = null;
    throw error;
  });
  return postgresSchemaReady;
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
