export async function dropRedundantIndexes(query) {
  await query(`drop index if exists idx_kitchen_roster_shifts_week_staff`);
  await query(`drop index if exists idx_supplier_delivery_notes_date_supplier`);
}
