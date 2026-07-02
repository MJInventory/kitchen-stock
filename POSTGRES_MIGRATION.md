# MJ Stock Magic Postgres Migration

This app now has a tracked Postgres migration runner. The goal is to stop doing broad schema/view rebuilds blindly at app startup and move toward explicit, versioned migrations.

## Environment

Add these Render environment variables to the web service:

- `DATABASE_URL`
- `DATA_BACKEND=airtable` while we migrate

Later, after import and testing:

- `DATA_BACKEND=postgres`

## Setup

From the project root:

```bash
npm install
npm run db:migrate
npm run db:migrate:status
npm run db:index:audit
npm run db:index:expected
npm run db:fk:audit
npm run db:baseline:audit
npm run db:check
npm run db:setup
npm run db:import:airtable
```

## Production safety first

Before any schema or migration deploy to Render:

1. Take a manual production backup
2. Keep the dump local only
3. Have the restore command ready before deploy

Backup helper:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts/backup-production-postgres.ps1" -DatabaseUrl "postgresql://..."
```

Restore helper:

```powershell
powershell -ExecutionPolicy Bypass -File "scripts/restore-production-postgres.ps1" -DatabaseUrl "postgresql://..." -BackupFile "C:\path\to\dump.dump" -WhatIfOnly
```

## Current migration plan

1. Keep Airtable live as the current source of truth
2. Apply tracked Postgres migrations
3. Run the Airtable import into Postgres
4. Add a backend repository layer that can switch by `DATA_BACKEND`
5. Test the web app on Postgres
6. Cut over Render from `airtable` to `postgres`

## Current migration runner shape

- `lib/postgres-schema.js`
  Runs the migration framework only
- `lib/postgres-migrations.js`
  Migration registry
- `lib/postgres-migrations/`
  Individual migration modules
- `scripts/run-postgres-migrations.mjs`
  Manual migration command
- `scripts/show-postgres-migrations.mjs`
  Shows which tracked migrations are already applied
- `scripts/audit-postgres-indexes.mjs`
  Shows exact duplicate public indexes before we remove any more
- `scripts/audit-postgres-expected-indexes.mjs`
  Shows whether the key audited non-FK production indexes are present
- `scripts/audit-postgres-fk-indexes.mjs`
  Shows public foreign keys that do not have a supporting index prefix
- `scripts/audit-postgres-baseline-drift.mjs`
  Shows which current schema features are still missing from `database/schema.sql`
- `scripts/setup-postgres.mjs`
  Applies `database/schema.sql` and then the tracked migrations so a fresh database lands on the current schema state

## Current tracked migrations

- `001_runtime_schema_bootstrap`
  Historical placeholder only
- `002_drop_redundant_indexes`
  Removes duplicate indexes that were duplicating unique constraints
- `003_backfill_supporting_indexes`
  Adds the first batch of concurrent support indexes
- `004_backfill_secondary_indexes`
  Adds the second batch of concurrent support indexes
- `005_backfill_final_foreign_key_indexes`
  Finishes foreign-key index coverage
- `006_refresh_reporting_views`
  Tracks reporting/workflow view rebuilds
- `007_refresh_kitchen_roster_schema`
  Tracks kitchen roster schema and views
- `008_refresh_supporting_domain_schema`
  Tracks supporting domain schema updates
- `009_refresh_internal_order_schema`
  Tracks internal order schema updates
- `010_refresh_app_user_schema`
  Tracks app user schema updates

## Baseline note

`database/schema.sql` is a baseline bootstrap, not the full final schema by itself.

Use `npm run db:setup` instead of applying `schema.sql` alone, because the setup script now applies the baseline file and then runs the tracked migrations immediately.

## Next cleanup targets

1. Keep `006_refresh_reporting_views` as the only remaining extracted helper unless we have a concrete reason to split it
2. Keep seed/reference data separate from structural schema changes
3. Audit non-FK reporting/performance indexes as query patterns evolve
4. Continue aligning `database/schema.sql` with the live migrated schema when drift is found

## Import status

The first import script covers:

- suppliers
- categories
- storage locations
- inventory areas
- units of measure
- shelf codes
- app users
- inventory items
- order requests
- driver sheet lines
- stock counts
- standing orders
- standing order items
- standing order runs
- standing order run lines
- daily guest counts
- internal order batches
- internal order lines
- app notifications
- push subscriptions

It is designed as an upsert-based import, so we can rerun it during migration work.

## First schema scope

The schema already includes:

- app users
- kitchen shift types
- kitchen roster weeks
- kitchen roster shifts
- suppliers
- categories
- storage locations
- shelf codes
- inventory areas
- units of measure
- inventory items
- order requests
- driver sheet lines
- stock counts
- standing orders
- standing order items
- standing order runs
- standing order run lines
- daily guest counts
- invoice captures
- invoice lines
- invoice OCR rules
- app notifications
- push subscriptions
- driver sheet assignments
- supplier delivery notes
- internal order batches
- internal order lines
- audit log entries

## Notes

- Passwords are intended to be stored hashed in Postgres.
- MS Access is intentionally out of scope for the first migration wave.
