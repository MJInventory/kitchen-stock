# Postgres Bootstrap Split Plan

This file maps the current legacy bootstrap migration in:

- `lib/postgres-migrations/001-runtime-schema-bootstrap.js`

The goal is to split that file into smaller tracked migrations without changing production behavior during the split.

## Current size

- `001-runtime-schema-bootstrap.js`: reduced by moving large logical sections into helper modules
- `lib/postgres-migrations/runtime-bootstrap/ensure-kitchen-roster-bootstrap.js`
- `lib/postgres-migrations/runtime-bootstrap/ensure-reporting-views.js`

## Current logical sections

### 1. App user capability changes

Includes:

- `app_users` notification columns
- `app_users` picker/driver/kitchen flags
- `app_users.hidden_*_menu`
- `app_users_role_check`
- `app_users.source = 'postgres'` backfill

Suggested future migration:

- `003_app_user_capabilities`

### 2. Kitchen roster core tables

Includes:

- `kitchen_shift_types`
- `kitchen_roster_weeks`
- `kitchen_roster_shifts`

Suggested future migrations:

- `004_kitchen_roster_tables`
- `005_kitchen_roster_seed_data`

### 3. Kitchen roster views

Includes:

- `kitchen_shift_type_admin_vw`
- `kitchen_staff_vw`
- `kitchen_roster_shift_vw`

Suggested future migration:

- `006_kitchen_roster_views`

### 4. Standing order and order request columns

Includes:

- `standing_orders.deleted`
- `order_requests.order_unit`
- `order_requests.partial_receipt`

Suggested future migration:

- `007_order_request_columns`

### 5. Notifications and push subscriptions

Includes:

- `app_notifications`
- `push_subscriptions`
- related indexes

Suggested future migration:

- `008_notifications`

### 6. Driver and supplier memo support

Includes:

- `driver_sheet_assignments`
- `supplier_delivery_notes`

Suggested future migration:

- `009_driver_and_supplier_notes`

### 7. Audit logging

Includes:

- `audit_log_entries`
- audit index

Suggested future migration:

- `010_audit_log`

### 8. Internal order tables

Includes:

- `internal_order_batches`
- `internal_order_lines`
- related indexes and constraints

Suggested future migration:

- `011_internal_orders`

### 9. Reporting and compatibility views

Includes:

- `order_request_details_vw`
- `internal_order_details_vw`
- `order_request_supply_vw`
- `driver_sheet_request_vw`
- `order_report_summary_vw`
- `audit_daily_summary_vw`
- `order_request_attention_vw`
- `standing_order_overview_vw`
- `inventory_below_minimum_vw`
- `standing_order_due_vw`
- `management_order_lines_vw`
- `management_order_summary_vw`
- `management_order_item_totals_vw`

Suggested future migrations:

- `012_reporting_views_core`
- `013_reporting_views_management`

## Safe execution strategy

1. Leave `001_runtime_schema_bootstrap` in place as the historical migration already applied in production.
2. Copy stable chunks from `001` into new migrations only when the new migration adds something new or replaces a runtime-only rebuild safely.
3. Do not delete `001` until every production environment already has it recorded in `schema_migrations`.
4. Prefer additive migrations over rewrites.
5. For views, use explicit `drop view if exists` only when dependency order is known and tested.

## First recommended follow-up

The least risky next production step is:

1. Keep `001` untouched
2. Add new migrations only for future schema changes
3. Move view rebuilds out of startup over time by creating targeted view migrations
4. Keep extracting logical chunks from `001` into helper modules when that reduces risk without changing behavior
5. Only after several clean releases, consider shrinking or freezing the legacy bootstrap further
