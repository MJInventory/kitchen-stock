import { refreshReportingViews } from "./006-refresh-reporting-views.js";

export async function addSupplierSpecificItemPrices(query) {
  await query(`
    create table if not exists inventory_item_supplier_prices (
      inventory_item_id uuid not null references inventory_items(id) on delete cascade,
      supplier_id uuid not null references suppliers(id) on delete cascade,
      unit_price numeric(12,2) not null default 0,
      updated_by_username text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (inventory_item_id, supplier_id),
      check (unit_price >= 0)
    )
  `);

  await query(`
    insert into inventory_item_supplier_prices (inventory_item_id, supplier_id, unit_price)
    select id, primary_supplier_id, coalesce(unit_price, 0)
    from inventory_items
    where primary_supplier_id is not null
    on conflict (inventory_item_id, supplier_id) do nothing
  `);

  await query(`
    create index if not exists idx_inventory_item_supplier_prices_supplier
      on inventory_item_supplier_prices (supplier_id)
  `);

  await query(`
    alter table order_requests
      add column if not exists unit_price numeric(12,2)
  `);

  await query(`
    alter table order_requests
      drop constraint if exists order_requests_unit_price_nonnegative
  `);
  await query(`
    alter table order_requests
      add constraint order_requests_unit_price_nonnegative
      check (unit_price is null or unit_price >= 0)
  `);

  await refreshReportingViews(query);

  await query(`
    update order_requests request
    set unit_price = supply.unit_price
    from order_request_supply_vw supply
    where supply.id = request.id
      and request.unit_price is null
      and (coalesce(request.ordered, false) = true or coalesce(request.delivered, false) = true)
  `);
}
