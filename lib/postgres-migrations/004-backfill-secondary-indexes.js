const INDEX_STATEMENTS = [
  "create index concurrently if not exists idx_driver_sheet_lines_order_request on driver_sheet_lines (order_request_id)",
  "create index concurrently if not exists idx_internal_order_batches_requested_by_user on internal_order_batches (requested_by_user_id)",
  "create index concurrently if not exists idx_internal_order_lines_inventory_item on internal_order_lines (inventory_item_id)",
  "create index concurrently if not exists idx_internal_order_lines_shortage_request on internal_order_lines (shortage_request_id)",
  "create index concurrently if not exists idx_internal_order_lines_auto_min_request on internal_order_lines (auto_min_request_id)",
  "create index concurrently if not exists idx_invoice_captures_supplier on invoice_captures (supplier_id)",
  "create index concurrently if not exists idx_invoice_lines_capture on invoice_lines (invoice_capture_id)",
  "create index concurrently if not exists idx_invoice_lines_inventory_item on invoice_lines (inventory_item_id)",
  "create index concurrently if not exists idx_invoice_lines_supplier on invoice_lines (supplier_id)",
  "create index concurrently if not exists idx_invoice_ocr_rules_supplier on invoice_ocr_rules (supplier_id)",
  "create index concurrently if not exists idx_invoice_ocr_rules_inventory_item on invoice_ocr_rules (inventory_item_id)",
  "create index concurrently if not exists idx_kitchen_roster_shifts_user on kitchen_roster_shifts (user_id)",
  "create index concurrently if not exists idx_kitchen_roster_shifts_shift_type on kitchen_roster_shifts (shift_type_id)",
  "create index concurrently if not exists idx_standing_order_items_inventory_item on standing_order_items (inventory_item_id)",
  "create index concurrently if not exists idx_standing_order_run_lines_standing_order on standing_order_run_lines (standing_order_id)"
];

export async function backfillSecondaryIndexes(query) {
  for (const statement of INDEX_STATEMENTS) {
    await query(statement);
  }
}
