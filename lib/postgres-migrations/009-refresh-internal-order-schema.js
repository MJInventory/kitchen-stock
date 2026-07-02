export async function refreshInternalOrderSchema(query) {
  await query(`
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
  await query(`
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
  await query(`
      create index if not exists idx_internal_order_batches_status_user
        on internal_order_batches (status, requested_by_username, created_at desc)
    `);
  await query(`
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
  await query(`
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
  await query(`
      create index if not exists idx_internal_order_lines_batch_status
        on internal_order_lines (internal_order_batch_id, status, created_at)
    `);
}
