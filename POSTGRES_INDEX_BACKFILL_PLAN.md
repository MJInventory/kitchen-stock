# Postgres Index Backfill Plan

This file captures the next likely schema cleanup after the migration framework work.

## Why this exists

This plan originally existed because production had drift between:

- `database/schema.sql`
- the tracked migration path
- the old historical bootstrap behavior

That mismatch meant production could be structurally correct but still miss performance-supporting indexes.

## Historical drift pattern

Examples that were already present in `database/schema.sql` but had not been backfilled yet:

- `idx_inventory_items_name`
- `idx_inventory_items_category`
- `idx_inventory_items_supplier`
- `idx_order_requests_open`
- `idx_order_requests_item`
- `idx_standing_order_runs_once_per_day`

Examples that were already present through the tracked/migrated schema path:

- `idx_app_notifications_user_read_created`
- `idx_push_subscriptions_user`
- `idx_audit_log_entries_date_created`
- `idx_internal_order_lines_batch_status`

Status on July 1, 2026:

- completed as `003_backfill_supporting_indexes`
- continued with `004_backfill_secondary_indexes`
- completed remaining foreign-key gaps with `005_backfill_final_foreign_key_indexes`

Current result:

- all public foreign keys now have an index prefix in production
- the original first/second batch recommendations below are now retained mainly as historical notes

Historical first batch:

1. `inventory_items(category_id)`
2. `inventory_items(primary_supplier_id)`
3. `inventory_items(inventory_area_id)`
4. `inventory_items(storage_location_id)`
5. `inventory_items(unit_of_measure_id)`
6. `inventory_items(shelf_code_id)`
7. `order_requests(inventory_item_id)`
8. `stock_counts(inventory_item_id)`
9. `standing_orders(supplier_id)`
10. `standing_order_runs(standing_order_id, expected_delivery_date)`
11. `standing_order_run_lines(standing_order_run_id)`
12. `standing_order_run_lines(order_request_id)`
13. `standing_order_run_lines(inventory_item_id)`
14. `driver_sheet_lines(supplier_id)`
15. `shelf_codes(storage_location_id)`

## Historical second batch

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

## Current note

The current migration runner now supports both transactional and non-transactional migrations:

- `lib/postgres-schema.js`

That is fine for normal DDL, and it now also allows low-lock production index creation for selected migrations:

1. use `transaction: false`
2. run `create index concurrently` inside the migration

Do not blindly add future indexes in one startup-time migration without checking lock behavior first.
