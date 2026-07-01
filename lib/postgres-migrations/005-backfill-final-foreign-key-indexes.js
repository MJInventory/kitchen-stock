const INDEX_STATEMENTS = [
  "create index concurrently if not exists idx_app_notifications_related_request on app_notifications (related_request_id)",
  "create index concurrently if not exists idx_app_notifications_related_standing_order on app_notifications (related_standing_order_id)",
  "create index concurrently if not exists idx_app_notifications_related_standing_order_run on app_notifications (related_standing_order_run_id)",
  "create index concurrently if not exists idx_standing_order_run_lines_driver_sheet_line on standing_order_run_lines (driver_sheet_line_id)"
];

export async function backfillFinalForeignKeyIndexes(query) {
  for (const statement of INDEX_STATEMENTS) {
    await query(statement);
  }
}
