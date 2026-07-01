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

## Current tracked migrations

- `001_runtime_schema_bootstrap`
  Wraps the legacy schema bootstrap in a one-time tracked migration
- `002_drop_redundant_indexes`
  Removes duplicate indexes that were duplicating unique constraints

## Next cleanup targets

1. Split the legacy bootstrap into smaller versioned migrations
2. Move reporting/view rebuilds out of the giant bootstrap
3. Keep seed/reference data separate from structural schema changes
4. Remove more startup-only DDL from normal app boot over time

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
- daily guest counts

It is designed as an upsert-based import, so we can rerun it during migration work.

## First schema scope

The schema already includes:

- app users
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

## Notes

- Passwords are intended to be stored hashed in Postgres.
- MS Access is intentionally out of scope for the first migration wave.
