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
