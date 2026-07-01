# Postgres Index Backfill Plan

This file captures the next likely schema cleanup after the migration framework work.

## Why this exists

Production currently shows:

- no exact duplicate public indexes
- several foreign keys without a supporting index prefix

The main reason is that `database/schema.sql` contains indexes that were never backfilled by the legacy runtime bootstrap in:

- `lib/postgres-migrations/001-runtime-schema-bootstrap.js`

That means production can be structurally correct but still missing performance-supporting indexes.

## Confirmed schema drift pattern

Examples already present in `database/schema.sql` but not created by the runtime bootstrap path:

- `idx_inventory_items_name`
- `idx_inventory_items_category`
- `idx_inventory_items_supplier`
- `idx_order_requests_open`
- `idx_order_requests_item`
- `idx_standing_order_runs_once_per_day`

Examples created by the runtime bootstrap:

- `idx_app_notifications_user_read_created`
- `idx_push_subscriptions_user`
- `idx_audit_log_entries_date_created`
- `idx_internal_order_lines_batch_status`

## Recommended first backfill migration

Create a narrow migration that adds only the most useful missing indexes first.

Recommended first batch:

1. `inventory_items(category_id)`
2. `inventory_items(primary_supplier_id)`
3. `inventory_items(inventory_area_id)`
4. `inventory_items(storage_location_id)`
5. `inventory_items(unit_of_measure_id)`
6. `inventory_items(shelf_code_id)`
7. `order_requests(inventory_item_id)`
8. `stock_counts(inventory_item_id)`
9. `standing_orders(supplier_id)`
10. `standing_order_runs(standing_order_id, expected_delivery_date)` if not already present
11. `standing_order_run_lines(standing_order_run_id)`
12. `standing_order_run_lines(order_request_id)`
13. `standing_order_run_lines(inventory_item_id)`
14. `driver_sheet_lines(supplier_id)`
15. `shelf_codes(storage_location_id)`

## Recommended second batch

Only after observing production behavior:

1. `invoice_captures(supplier_id)`
2. `invoice_lines(invoice_capture_id)`
3. `invoice_lines(inventory_item_id)`
4. `invoice_lines(supplier_id)`
5. `invoice_ocr_rules(supplier_id)`
6. `invoice_ocr_rules(inventory_item_id)`
7. `internal_order_lines(inventory_item_id)`
8. `internal_order_lines(shortage_request_id)`
9. `internal_order_lines(auto_min_request_id)`
10. `internal_order_batches(requested_by_user_id)`
11. `app_notifications(related_request_id)`
12. `app_notifications(related_standing_order_id)`
13. `app_notifications(related_standing_order_run_id)`

## Important implementation note

The current migration runner applies migrations inside a transaction:

- `lib/postgres-schema.js`

That is fine for normal DDL, but if we want low-lock production index creation we may prefer:

1. a manual maintenance step with `create index concurrently`
2. or a separate migration path that supports non-transactional concurrent index creation

Do not blindly add every missing index in one runtime startup migration without checking lock behavior first.
