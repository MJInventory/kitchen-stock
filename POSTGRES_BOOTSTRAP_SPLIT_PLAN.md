# Postgres Bootstrap Split Plan

This split is effectively complete.

## Current state

- `001_runtime_schema_bootstrap` is now only a historical placeholder.
- structural schema work was moved into tracked migrations:
  - `007_refresh_kitchen_roster_schema`
  - `008_refresh_supporting_domain_schema`
  - `009_refresh_internal_order_schema`
  - `010_refresh_app_user_schema`
- the only remaining extracted helper under `lib/postgres-migrations/runtime-bootstrap/` is:
  - `ensure-reporting-views.js`

## Why one helper remains

`006_refresh_reporting_views` is already an explicit tracked migration, so it is no longer hidden startup schema behavior.

That helper still exists only because the reporting/view rebuild block is:

- large
- dependency-ordered
- more error-prone to refactor casually than the smaller table/column migrations

## Recommended stance

Leave `006_refresh_reporting_views` as-is unless there is a concrete reason to split it further.

That is a reasonable steady state because:

1. the runtime bootstrap risk is already removed
2. the migration is explicit and versioned
3. the remaining helper is an implementation detail, not an untracked schema side effect

## Future option

If we ever want to keep simplifying:

1. split `006` into smaller view-focused migrations
2. inline the reporting helper afterward
3. remove the `runtime-bootstrap/` folder entirely

This is optional cleanup now, not an urgent production-risk item.
