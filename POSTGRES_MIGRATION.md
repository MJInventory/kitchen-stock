# MJ Stock Magic Postgres Migration

This app is currently Airtable-backed. The Postgres migration is being built in a safe side-by-side path.

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
npm run db:check
npm run db:setup
npm run db:import:airtable
```

## Current migration plan

1. Keep Airtable live as the current source of truth
2. Apply the Postgres schema
3. Run the Airtable import into Postgres
4. Add a backend repository layer that can switch by `DATA_BACKEND`
5. Test the web app on Postgres
6. Cut over Render from `airtable` to `postgres`

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
