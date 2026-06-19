let postgresSchemaReady = null;

export async function ensurePostgresSchemaUpgrades({ hasPostgres, db }) {
  if (!hasPostgres()) return;
  if (postgresSchemaReady) return postgresSchemaReady;
  postgresSchemaReady = (async () => {
    await db().query(`
      alter table app_users
        add column if not exists notify_on_new_orders boolean not null default false,
        add column if not exists notify_on_delivery boolean not null default true,
        add column if not exists notify_area_bar boolean not null default true,
        add column if not exists notify_area_foh boolean not null default true,
        add column if not exists notify_area_kitchen boolean not null default true,
        add column if not exists notify_area_general boolean not null default true,
        add column if not exists is_driver boolean not null default false,
        add column if not exists is_picker boolean not null default false,
        add column if not exists open_order_days integer not null default 7,
        add column if not exists hidden_goto_menu jsonb not null default '[]'::jsonb,
        add column if not exists hidden_backoffice_menu jsonb not null default '[]'::jsonb
    `);
    await db().query(`
      alter table standing_orders
        add column if not exists deleted boolean not null default false
    `);
    await db().query(`
      alter table order_requests
        add column if not exists order_unit text not null default ''
    `);
    await db().query(`
      alter table order_requests
        add column if not exists partial_receipt boolean not null default false
    `);
    await db().query(`
      create table if not exists app_notifications (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references app_users(id) on delete cascade,
        notification_type text not null default 'info',
        title text not null default '',
        body text not null default '',
        related_request_id uuid references order_requests(id) on delete set null,
        related_standing_order_id uuid references standing_orders(id) on delete set null,
        related_standing_order_run_id uuid references standing_order_runs(id) on delete set null,
        is_read boolean not null default false,
        created_at timestamptz not null default now(),
        read_at timestamptz
      )
    `);
    await db().query(`
      create index if not exists idx_app_notifications_user_read_created
        on app_notifications (user_id, is_read, created_at desc)
    `);
    await db().query(`
      create table if not exists push_subscriptions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references app_users(id) on delete cascade,
        endpoint text not null unique,
        p256dh text not null,
        auth text not null,
        user_agent text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await db().query(`
      create index if not exists idx_push_subscriptions_user
        on push_subscriptions (user_id, updated_at desc)
    `);
    await db().query(`
      create table if not exists driver_sheet_assignments (
        sheet_date date primary key,
        driver_username text not null,
        assigned_by_username text not null default '',
        assigned_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await db().query(`
      create table if not exists supplier_delivery_notes (
        id uuid primary key default gen_random_uuid(),
        delivery_date date not null,
        supplier_name text not null,
        memo text not null default '',
        entered_by_username text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (delivery_date, supplier_name)
      )
    `);
    await db().query(`
      create index if not exists idx_supplier_delivery_notes_date_supplier
        on supplier_delivery_notes (delivery_date, supplier_name)
    `);
    await db().query(`
      create table if not exists audit_log_entries (
        id uuid primary key default gen_random_uuid(),
        action_date date not null default current_date,
        action_type text not null check (action_type in ('add', 'change', 'delete')),
        entity_type text not null,
        entity_id text not null default '',
        entity_name text not null default '',
        actor_username text not null default '',
        reason_code text not null default '',
        note text not null default '',
        before_json jsonb,
        after_json jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await db().query(`
      create index if not exists idx_audit_log_entries_date_created
        on audit_log_entries (action_date desc, created_at desc)
    `);
    await db().query(`
      update app_users
      set source = 'postgres',
          updated_at = now()
      where coalesce(source, '') <> 'postgres'
    `);
    await db().query(`
      create table if not exists internal_order_batches (
        id uuid primary key default gen_random_uuid(),
        requested_by_user_id uuid references app_users(id) on delete set null,
        requested_by_username text not null default '',
        requested_at timestamptz not null default now(),
        status text not null default 'open' check (status in ('open', 'ready', 'closed', 'partial')),
        notes text not null default '',
        picker_username text not null default '',
        ready_at timestamptz,
        ready_by_username text not null default '',
        closed_at timestamptz,
        closed_by_username text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await db().query(`
      alter table internal_order_batches
        add column if not exists requested_by_user_id uuid references app_users(id) on delete set null,
        add column if not exists requested_by_username text not null default '',
        add column if not exists requested_at timestamptz not null default now(),
        add column if not exists status text not null default 'open',
        add column if not exists notes text not null default '',
        add column if not exists picker_username text not null default '',
        add column if not exists ready_at timestamptz,
        add column if not exists ready_by_username text not null default '',
        add column if not exists closed_at timestamptz,
        add column if not exists closed_by_username text not null default '',
        add column if not exists created_at timestamptz not null default now(),
        add column if not exists updated_at timestamptz not null default now()
    `);
    await db().query(`
      create index if not exists idx_internal_order_batches_status_user
        on internal_order_batches (status, requested_by_username, created_at desc)
    `);
    await db().query(`
      create table if not exists internal_order_lines (
        id uuid primary key default gen_random_uuid(),
        internal_order_batch_id uuid not null references internal_order_batches(id) on delete cascade,
        inventory_item_id uuid not null references inventory_items(id) on delete restrict,
        requested_item_quantity numeric not null default 0,
        picked_item_quantity numeric not null default 0,
        shortage_item_quantity numeric not null default 0,
        status text not null default 'requested' check (status in ('requested', 'partial', 'ready', 'closed', 'cancelled')),
        shortage_request_id uuid references order_requests(id) on delete set null,
        auto_min_request_id uuid references order_requests(id) on delete set null,
        notes text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await db().query(`
      alter table internal_order_lines
        add column if not exists internal_order_batch_id uuid references internal_order_batches(id) on delete cascade,
        add column if not exists inventory_item_id uuid references inventory_items(id) on delete restrict,
        add column if not exists requested_item_quantity numeric not null default 0,
        add column if not exists picked_item_quantity numeric not null default 0,
        add column if not exists shortage_item_quantity numeric not null default 0,
        add column if not exists status text not null default 'requested',
        add column if not exists shortage_request_id uuid references order_requests(id) on delete set null,
        add column if not exists auto_min_request_id uuid references order_requests(id) on delete set null,
        add column if not exists notes text not null default '',
        add column if not exists created_at timestamptz not null default now(),
        add column if not exists updated_at timestamptz not null default now()
    `);
    await db().query(`
      create index if not exists idx_internal_order_lines_batch_status
        on internal_order_lines (internal_order_batch_id, status, created_at)
    `);
    await db().query(`
      drop view if exists management_order_lines_vw
    `);
    await db().query(`
      create or replace view management_order_lines_vw as
      select
        r.id as request_id,
        r.request_number,
        r.inventory_item_id,
        coalesce(i.name, '') as item_name,
        coalesce(c.name, 'Uncategorized') as category_name,
        coalesce(s.name, 'Unassigned Supplier') as supplier_name,
        coalesce(nullif(r.order_unit, ''), u.name, 'item') as unit_name,
        coalesce(a.name, '') as area_name,
        coalesce(sl.name, '') as storage_location_name,
        coalesce(r.requested_by_username, '') as requested_by_username,
        r.requested_at,
        r.requested_at::date as request_date,
        coalesce(r.quantity_needed, 0) as quantity_needed,
        coalesce(r.urgency_level, '') as urgency_level,
        coalesce(r.status, '') as status,
        coalesce(r.ordered, false) as ordered,
        coalesce(r.delivered, false) as delivered,
        coalesce(r.to_deliver, false) as to_deliver,
        r.delivery_day,
        r.delivered_at,
        r.standing_order_run_id,
        r.standing_order_run_line_id
      from order_requests r
      left join inventory_items i on i.id = r.inventory_item_id
      left join categories c on c.id = i.category_id
      left join suppliers s on s.id = i.primary_supplier_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
      left join inventory_areas a on a.id = i.inventory_area_id
      left join storage_locations sl on sl.id = i.storage_location_id
    `);
  })().catch((error) => {
    postgresSchemaReady = null;
    throw error;
  });
  return postgresSchemaReady;
}
