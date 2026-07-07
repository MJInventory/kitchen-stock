export async function enforceInventoryPriceDefaults(query) {
  await query(`
    update inventory_items
    set unit_price = 0
    where unit_price is null
  `);

  await query(`
    alter table inventory_items
      alter column unit_price set default 0,
      alter column unit_price set not null
  `);
}
