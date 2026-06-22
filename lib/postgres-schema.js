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
      drop view if exists driver_sheet_request_vw
    `);
    await db().query(`
      drop view if exists management_order_lines_vw
    `);
    await db().query(`
      drop view if exists standing_order_due_vw
    `);
    await db().query(`
      drop view if exists inventory_below_minimum_vw
    `);
    await db().query(`
      drop view if exists order_request_attention_vw
    `);
    await db().query(`
      drop view if exists order_request_supply_vw
    `);
    await db().query(`
      drop view if exists standing_order_overview_vw
    `);
    await db().query(`
      drop view if exists order_request_details_vw
    `);
    await db().query(`
      create or replace view order_request_details_vw as
      select
        r.id,
        r.request_number,
        r.inventory_item_id as item_id,
        r.inventory_item_id,
        r.quantity_needed as quantity,
        r.quantity_needed,
        r.urgency_level as urgency,
        r.urgency_level,
        r.status,
        r.requested_by_username as requested_by,
        r.requested_by_username,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by_username as delivered_by,
        r.delivered_by_username,
        r.ordered,
        r.ordered_at,
        r.ordered_by_username as ordered_by,
        r.ordered_by_username,
        r.to_deliver,
        r.delivery_day,
        (r.requested_at at time zone 'UTC')::date::text as request_day,
        ((r.requested_at at time zone 'UTC')::date = current_date) as is_today_request,
        (r.standing_order_run_id is not null or r.standing_order_run_line_id is not null) as is_standing_order,
        case
          when r.delivery_day is not null and r.delivery_day > current_date then true
          else false
        end as scheduled_delivery_future,
        greatest(0, current_date - ((r.requested_at at time zone 'UTC')::date))::integer as request_age_days,
        case
          when coalesce(r.partial_receipt, false) = true then 'partial'
          when r.standing_order_run_id is not null or r.standing_order_run_line_id is not null then 'standing'
          when lower(coalesce(r.requested_by_username, '')) = 'auto minimum'
            or lower(coalesce(r.notes, '')) like '%automatic minimum%'
            or lower(coalesce(r.notes, '')) like '%internal order shortage%' then 'automatic'
          else 'user'
        end as origin_type,
        r.notes,
        r.partial_receipt,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        r.order_unit,
        i.name as item_name,
        c.name as category,
        sl.name as storage_location,
        ia.name as inventory_area,
        sc.code as shelf_code,
        coalesce(nullif(r.order_unit, ''), u.name, 'item') as unit,
        sp.id as primary_supplier_id,
        sp.name as supplier_name,
        sp.contact_information as supplier_contact
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      left join categories c on c.id = i.category_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
        left join units_of_measure u on u.id = i.unit_of_measure_id
        left join suppliers sp on sp.id = i.primary_supplier_id
    `);
    await db().query(`
      create or replace view order_request_supply_vw as
      select
        r.*,
        sorl.supplier_name as standing_line_supplier_name,
        coalesce(ss.id, sso.id, r.primary_supplier_id) as resolved_supplier_id,
        coalesce(nullif(trim(sorl.supplier_name), ''), sso.name, r.supplier_name) as resolved_supplier_name,
        coalesce(ss.contact_information, sso.contact_information, r.supplier_contact, '') as resolved_supplier_contact
      from order_request_details_vw r
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      left join suppliers ss on lower(ss.name) = lower(sorl.supplier_name)
    `);
    await db().query(`
      create or replace view driver_sheet_request_vw as
      select
        d.id,
        d.order_request_id,
        d.sheet_date::text as sheet_date,
        d.driver_username,
        d.ordered,
        d.ordered_at,
        d.ordered_by_username,
        d.received,
        d.received_at,
        d.received_by_username,
        d.to_deliver,
        d.delivery_day::text as delivery_day,
        coalesce(ds.name, r.resolved_supplier_name) as supplier_name,
        coalesce(ds.contact_information, r.resolved_supplier_contact, '') as supplier_contact,
        r.id as request_id,
        r.request_number,
        r.item_id,
        r.inventory_item_id,
        r.quantity,
        r.urgency,
        r.status,
        r.requested_by,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by,
        r.notes,
        r.partial_receipt,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        r.origin_type,
        r.is_today_request,
        r.is_standing_order,
        r.request_day,
        r.request_age_days,
        r.scheduled_delivery_future,
        r.item_name,
        r.category,
        r.storage_location,
        r.inventory_area,
        r.shelf_code,
        r.unit
      from order_request_supply_vw r
      left join driver_sheet_lines d on d.order_request_id = r.id
      left join suppliers ds on ds.id = d.supplier_id
    `);
    await db().query(`
      create or replace view order_request_attention_vw as
      select
        r.id,
        lower(coalesce(r.requested_by_username, '')) as requested_by_key,
        coalesce(r.requested_by_username, '') as requested_by_username,
        r.requested_at::date as request_date,
        greatest(0, current_date - (r.requested_at::date))::integer as request_age_days,
        coalesce(r.partial_receipt, false) as partial_receipt,
        coalesce(r.delivery_day > current_date, false) as scheduled_delivery_future,
        (r.standing_order_run_id is not null or r.standing_order_run_line_id is not null) as is_standing
      from order_requests r
      where coalesce(r.delivered, false) = false
        and coalesce(r.status, '') in ('Pending', 'Approved')
    `);
    await db().query(`
      create or replace view standing_order_overview_vw as
      with closed_one_time_runs as (
        select distinct
          sor.standing_order_id,
          sor.expected_delivery_date
        from standing_order_runs sor
        join standing_orders so on so.id = sor.standing_order_id
        where sor.status = 'Closed'
          and so.schedule = 'One Time'
      )
      select
        so.id,
        so.name,
        so.supplier_id,
        sp.name as supplier_name,
        so.expected_arrival_date::text as expected_date,
        so.schedule,
        so.other_schedule,
        so.recurring,
        so.active,
        so.last_generated_date::text as last_generated_date,
        so.notes,
        coalesce(so.deleted, false) as deleted,
        case
          when coalesce(so.deleted, false) = true then false
          when so.expected_arrival_date is not null
            and so.expected_arrival_date >= current_date
            and (
              so.schedule <> 'One Time'
              or not exists (
                select 1
                from closed_one_time_runs cor
                where cor.standing_order_id = so.id
                  and cor.expected_delivery_date = so.expected_arrival_date
              )
            ) then true
          else coalesce(so.active, false)
        end as display_active,
        case
          when coalesce(so.deleted, false) = true then 'Inactive'
          when so.schedule = 'One Time'
            and exists (
              select 1
              from closed_one_time_runs cor
              where cor.standing_order_id = so.id
                and cor.expected_delivery_date = so.expected_arrival_date
            ) then 'Completed'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date <= current_date
            and (
              coalesce(so.active, false) = true
              or (
                so.schedule = 'One Time'
                and not exists (
                  select 1
                  from closed_one_time_runs cor
                  where cor.standing_order_id = so.id
                    and cor.expected_delivery_date = so.expected_arrival_date
                )
              )
            ) then 'Due'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date > current_date
            and (
              coalesce(so.active, false) = true
              or (
                so.schedule = 'One Time'
                and not exists (
                  select 1
                  from closed_one_time_runs cor
                  where cor.standing_order_id = so.id
                    and cor.expected_delivery_date = so.expected_arrival_date
                )
              )
            ) then 'Scheduled'
          else 'Inactive'
        end as status_label
      from standing_orders so
      left join suppliers sp on sp.id = so.supplier_id
    `);
    await db().query(`
      create or replace view inventory_below_minimum_vw as
      select
        i.id,
        i.name,
        coalesce(i.current_quantity, 0) as current_quantity,
        coalesce(i.minimum_threshold, 0) as minimum_threshold
      from inventory_items i
      where coalesce(i.active, true) = true
        and coalesce(i.current_quantity, 0) < coalesce(i.minimum_threshold, 0)
    `);
    await db().query(`
      create or replace view standing_order_due_vw as
      select
        id,
        supplier_name,
        expected_date,
        schedule
      from standing_order_overview_vw
      where display_active = true
        and nullif(expected_date, '') is not null
        and expected_date::date <= current_date
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
