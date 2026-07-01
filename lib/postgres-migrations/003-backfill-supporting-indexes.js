const INDEX_STATEMENTS = [
  "create index concurrently if not exists idx_inventory_items_category on inventory_items (category_id)",
  "create index concurrently if not exists idx_inventory_items_supplier on inventory_items (primary_supplier_id)",
  "create index concurrently if not exists idx_inventory_items_area on inventory_items (inventory_area_id)",
  "create index concurrently if not exists idx_inventory_items_location on inventory_items (storage_location_id)",
  "create index concurrently if not exists idx_inventory_items_unit on inventory_items (unit_of_measure_id)",
  "create index concurrently if not exists idx_inventory_items_shelf on inventory_items (shelf_code_id)",
  "create index concurrently if not exists idx_order_requests_item on order_requests (inventory_item_id)",
  "create index concurrently if not exists idx_stock_counts_item on stock_counts (inventory_item_id)",
  "create index concurrently if not exists idx_standing_orders_supplier on standing_orders (supplier_id)",
  "create unique index concurrently if not exists idx_standing_order_runs_once_per_day on standing_order_runs (standing_order_id, expected_delivery_date)",
  "create index concurrently if not exists idx_standing_order_run_lines_run on standing_order_run_lines (standing_order_run_id)",
  "create index concurrently if not exists idx_standing_order_run_lines_request on standing_order_run_lines (order_request_id)",
  "create index concurrently if not exists idx_standing_order_run_lines_item on standing_order_run_lines (inventory_item_id)",
  "create index concurrently if not exists idx_driver_sheet_lines_supplier on driver_sheet_lines (supplier_id)",
  "create index concurrently if not exists idx_shelf_codes_storage_location on shelf_codes (storage_location_id)"
];

export async function backfillSupportingIndexes(query) {
  for (const statement of INDEX_STATEMENTS) {
    await query(statement);
  }
}
