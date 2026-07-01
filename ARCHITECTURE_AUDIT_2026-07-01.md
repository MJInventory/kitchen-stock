# Architecture Audit 2026-07-01

This is a prep snapshot before the next production-safe cleanup round.

## Front-end boundary check

Scanned:

- `views/`
- `public/`

Current result:

- EJS templates are being used for server-rendered pages
- Browser-side files are calling `/api/...` endpoints
- No direct `pg`/Postgres helpers were found in `views/` or `public/`
- No `client.query`, `getPool`, or direct SQL access was found in the front-end files

That means the front-end boundary is currently in a reasonable place:

- UI in `views/` and `public/`
- data access in `lib/`

## Current backend future-risk area

Biggest remaining future-risk file:

- `lib/postgres-migrations/001-runtime-schema-bootstrap.js`

Why:

- it is large
- it mixes tables, seed data, constraints, indexes, and views
- it still acts as a legacy one-shot catch-all migration

Related split plan:

- `POSTGRES_BOOTSTRAP_SPLIT_PLAN.md`

## Runtime migration status tooling now available

Added in this prep round:

- `npm run db:migrate:status`

Purpose:

- show which tracked migrations are applied
- keep migration visibility out of app startup logs

## RDBMS cleanup already in motion

Already improved:

- tracked migration table exists
- migration execution is versioned
- duplicate indexes started being removed in tracked migrations
- production audit shows no exact duplicate public indexes remain

Still worth auditing next:

1. Add missing foreign-key support indexes in a small tracked migration
2. Check whether every frequently filtered non-FK column has a deliberate index
3. Separate seed/reference data changes from structural migrations
4. Move view rebuilds into narrower migrations over time

## Production database audit snapshot

Checked on July 1, 2026:

- tracked migrations applied:
  - `001_runtime_schema_bootstrap`
  - `002_drop_redundant_indexes`
  - `003_backfill_supporting_indexes`
- exact duplicate public indexes found:
  - none
- first supporting-index backfill applied:
  - yes

Foreign keys currently missing an index prefix in production include tables such as:

- `app_notifications`
- `internal_order_batches`
- `internal_order_lines`
- `invoice_captures`
- `invoice_lines`
- `invoice_ocr_rules`
- `kitchen_roster_shifts`
- `standing_order_items`
- `standing_order_run_lines`

That does not mean every one of these must be indexed immediately, but it gives us the real candidate list for the next migration instead of guessing.

## Safe next coding steps

1. Freeze `001_runtime_schema_bootstrap` as historical
2. Add only small forward migrations from here
3. Create a second narrow migration only for the remaining high-value FK indexes
4. Start with view-specific migrations before touching core table history
5. Keep health-checking each checkpoint before push
