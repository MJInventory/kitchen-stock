export async function runLegacySchemaBootstrap(query) {
  await query(`
      alter table app_users
        add column if not exists notify_on_new_orders boolean not null default false,
        add column if not exists notify_on_delivery boolean not null default true,
        add column if not exists notify_area_bar boolean not null default true,
        add column if not exists notify_area_foh boolean not null default true,
        add column if not exists notify_area_kitchen boolean not null default true,
        add column if not exists notify_area_general boolean not null default true,
        add column if not exists is_driver boolean not null default false,
        add column if not exists is_picker boolean not null default false,
        add column if not exists is_kitchen_staff boolean not null default false,
        add column if not exists kitchen_function text not null default '',
        add column if not exists open_order_days integer not null default 7,
        add column if not exists hidden_goto_menu jsonb not null default '[]'::jsonb,
        add column if not exists hidden_backoffice_menu jsonb not null default '[]'::jsonb
    `);
  await query(`
      alter table app_users
        drop constraint if exists app_users_role_check,
        add constraint app_users_role_check
          check (role in ('god', 'admin', 'power-user', 'staff', 'user'))
    `);
  await query(`
      create table if not exists kitchen_shift_types (
        id uuid primary key default gen_random_uuid(),
        shift_code text not null unique,
        label text not null,
        color text not null default '#c7f9d4',
        shift_group text not null default 'kitchen',
        sort_order integer not null default 0,
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
  await query(`
      alter table kitchen_shift_types
        add column if not exists shift_group text not null default 'kitchen'
    `);
  await query(`
      update kitchen_shift_types
      set shift_group = coalesce(nullif(lower(trim(shift_group)), ''), 'kitchen')
    `);
  await query(`
      alter table kitchen_shift_types
        drop constraint if exists kitchen_shift_types_shift_group_check,
        add constraint kitchen_shift_types_shift_group_check
          check (shift_group in ('kitchen', 'foh', 'bar', 'other'))
    `);
  await query(`
      insert into kitchen_shift_types (shift_code, label, color, shift_group, sort_order, active)
      values
        ('10_18', '10:00 - 18:00', '#fff1b8', 'kitchen', 10, true),
        ('14_23', '14:00 - 23:00', '#c7f3f8', 'kitchen', 20, true),
        ('14_22', '14:00 - 22:00', '#c7f9d4', 'kitchen', 30, true),
        ('16_23', '16:00 - 23:00', '#d9ecff', 'kitchen', 40, true),
        ('15_23', '15:00 - 23:00', '#ffd9df', 'kitchen', 50, true),
        ('10_17', '10:00 - 17:00', '#e5ffc7', 'kitchen', 60, true),
        ('NON', 'NON', '#ffe8c7', 'kitchen', 70, true),
        ('VACATION', 'VACATION', '#fff1b8', 'kitchen', 80, true),
        ('OFF', 'OFF', '#20242c', 'kitchen', 90, true)
      on conflict (shift_code) do update
      set label = excluded.label,
          color = excluded.color,
          shift_group = excluded.shift_group,
          sort_order = excluded.sort_order,
          active = excluded.active,
          updated_at = now()
    `);
  await query(`
      create or replace view kitchen_shift_type_admin_vw as
      select
        id,
        shift_code as code,
        label,
        color,
        shift_group,
        sort_order,
        active,
        created_at,
        updated_at
      from kitchen_shift_types
    `);
  await query(`
      create table if not exists kitchen_roster_weeks (
        week_start date primary key,
        created_by_username text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
  await query(`
      alter table kitchen_roster_weeks
        add column if not exists locked boolean not null default false,
        add column if not exists locked_by_username text not null default '',
        add column if not exists locked_at timestamptz
    `);
  await query(`
      create table if not exists kitchen_roster_shifts (
        id uuid primary key default gen_random_uuid(),
        week_start date not null references kitchen_roster_weeks(week_start) on delete cascade,
        user_id uuid not null references app_users(id) on delete cascade,
        shift_date date not null,
        shift_type_id uuid references kitchen_shift_types(id) on delete set null,
        notes text not null default '',
        updated_by_username text not null default '',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (week_start, user_id, shift_date)
      )
    `);
  await query(`
      create or replace view kitchen_staff_vw as
      select
        id as user_id,
        username,
        display_name,
        coalesce(nullif(kitchen_function, ''), 'Other') as kitchen_function,
        role,
        active,
        case coalesce(nullif(kitchen_function, ''), 'Other')
          when 'Chef' then 10
          when 'Sous-Chef' then 20
          when 'Line Cook' then 30
          when 'Kitchen Helper' then 40
          when 'Pickup Waiter' then 50
          when 'Dishwasher' then 99
          else 90
        end as function_sort
      from app_users
      where active = true and is_kitchen_staff = true
    `);
  await query(`
      create or replace view kitchen_roster_shift_vw as
      select
        s.id,
        s.week_start,
        s.shift_date,
        s.user_id,
        staff.username,
        staff.display_name,
        staff.kitchen_function,
        staff.function_sort,
        t.id as shift_type_id,
        coalesce(t.shift_code, 'OFF') as shift_code,
        coalesce(t.label, 'OFF') as shift_label,
        coalesce(t.color, '#20242c') as shift_color,
        s.notes,
        s.updated_by_username,
        s.updated_at,
        coalesce(t.shift_group, 'kitchen') as shift_group
      from kitchen_roster_shifts s
      join kitchen_staff_vw staff on staff.user_id = s.user_id
      left join kitchen_shift_types t on t.id = s.shift_type_id
    `);
  await query(`
      alter table standing_orders
        add column if not exists deleted boolean not null default false
    `);
  await query(`
      alter table order_requests
        add column if not exists order_unit text not null default ''
    `);
  await query(`
      alter table order_requests
        add column if not exists partial_receipt boolean not null default false
    `);
  await query(`
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
  await query(`
      create index if not exists idx_app_notifications_user_read_created
        on app_notifications (user_id, is_read, created_at desc)
    `);
  await query(`
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
  await query(`
      create index if not exists idx_push_subscriptions_user
        on push_subscriptions (user_id, updated_at desc)
    `);
  await query(`
      create table if not exists driver_sheet_assignments (
        sheet_date date primary key,
        driver_username text not null,
        assigned_by_username text not null default '',
        assigned_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
  await query(`
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
  await query(`
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
  await query(`
      create index if not exists idx_audit_log_entries_date_created
        on audit_log_entries (action_date desc, created_at desc)
    `);
  await query(`
      update app_users
      set source = 'postgres',
          updated_at = now()
      where coalesce(source, '') <> 'postgres'
    `);
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
  await query(`drop view if exists order_report_summary_vw`);
  await query(`drop view if exists audit_daily_summary_vw`);
  await query(`drop view if exists driver_sheet_request_vw`);
  await query(`drop view if exists management_order_item_totals_vw`);
  await query(`drop view if exists management_order_summary_vw`);
  await query(`drop view if exists management_order_lines_vw`);
  await query(`drop view if exists standing_order_due_vw`);
  await query(`drop view if exists inventory_below_minimum_vw`);
  await query(`drop view if exists order_request_attention_vw`);
  await query(`drop view if exists order_request_supply_vw`);
  await query(`drop view if exists standing_order_overview_vw`);
  await query(`drop view if exists order_request_details_vw`);
  await query(`drop view if exists internal_order_details_vw`);
  await query(`
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
  await query(`
      create or replace view internal_order_details_vw as
      select
        b.id as batch_id,
        b.requested_by_username,
        coalesce(b.requested_at, b.created_at) as requested_at,
        b.status as batch_status,
        b.notes as batch_notes,
        b.picker_username,
        b.ready_at,
        b.ready_by_username,
        b.closed_at,
        b.closed_by_username,
        l.id,
        l.internal_order_batch_id,
        l.inventory_item_id,
        l.requested_item_quantity,
        l.picked_item_quantity,
        l.shortage_item_quantity,
        l.shortage_request_id,
        l.auto_min_request_id,
        l.status,
        l.notes,
        i.name as item_name,
        i.current_quantity,
        i.minimum_threshold,
        c.name as category,
        ia.name as inventory_area,
        sl.name as storage_location,
        sc.code as shelf_code,
        u.name as unit
      from internal_order_batches b
      join internal_order_lines l on l.internal_order_batch_id = b.id
      join inventory_items i on i.id = l.inventory_item_id
      left join categories c on c.id = i.category_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
    `);
  await query(`
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
  await query(`
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
  await query(`
      create or replace view order_report_summary_vw as
      select
        sheet_date,
        count(*) filter (where coalesce(is_standing_order, false) = false)::integer as total_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and coalesce(ordered, false) = true
        )::integer as ordered_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and (coalesce(received, false) = true or coalesce(delivered, false) = true)
        )::integer as delivered_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and coalesce(received, false) = false
            and coalesce(delivered, false) = false
        )::integer as waiting_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and coalesce(to_deliver, false) = true
        )::integer as to_deliver_lines
      from driver_sheet_request_vw
      where sheet_date is not null
      group by sheet_date
    `);
  await query(`
      create or replace view audit_daily_summary_vw as
      select
        action_date::text as action_date,
        count(*) filter (where action_type = 'add')::integer as adds,
        count(*) filter (where action_type = 'change')::integer as changes,
        count(*) filter (where action_type = 'delete')::integer as deletes,
        count(distinct nullif(trim(actor_username), ''))::integer as users
      from audit_log_entries
      group by action_date
    `);
  await query(`
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
  await query(`
      create or replace view standing_order_overview_vw as
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
          when so.schedule = 'One Time' and coalesce(expected_run.closed_for_expected, false) = true then false
          when so.expected_arrival_date is not null and so.expected_arrival_date >= current_date then true
          else coalesce(so.active, false)
        end as display_active,
        case
          when coalesce(so.deleted, false) = true then 'Inactive'
          when so.schedule = 'One Time' and coalesce(expected_run.closed_for_expected, false) = true then 'Completed'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date < current_date
            and coalesce(expected_run.closed_for_expected, false) = false then 'Due'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date <= current_date
            and (
              coalesce(so.active, false) = true
              or coalesce(expected_run.open_for_expected, false) = true
              or coalesce(expected_run.open_lines_for_expected, false) = true
            ) then 'Due'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date > current_date then 'Scheduled'
          when so.schedule = 'One Time' and coalesce(any_closed_run.has_any_closed_run, false) = true then 'Completed'
          else 'Inactive'
        end as status_label
      from standing_orders so
      left join suppliers sp on sp.id = so.supplier_id
      left join lateral (
        select
          bool_or(sor.status = 'Closed') as closed_for_expected,
          bool_or(sor.status <> 'Closed') as open_for_expected,
          bool_or(coalesce(sorl.received, false) = false) filter (where sorl.id is not null) as open_lines_for_expected
        from standing_order_runs sor
        left join standing_order_run_lines sorl on sorl.standing_order_run_id = sor.id
        where sor.standing_order_id = so.id
          and so.expected_arrival_date is not null
          and sor.expected_delivery_date = so.expected_arrival_date
      ) expected_run on true
      left join lateral (
        select bool_or(sor.status = 'Closed') as has_any_closed_run
        from standing_order_runs sor
        where sor.standing_order_id = so.id
      ) any_closed_run on true
    `);
  await query(`
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
  await query(`
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
  await query(`
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
  await query(`
      create or replace view management_order_summary_vw as
      select
        request_date::text as request_date,
        coalesce(sum(quantity_needed), 0) as total_quantity,
        count(*)::integer as total_lines,
        count(distinct inventory_item_id)::integer as distinct_items,
        count(distinct supplier_name)::integer as distinct_suppliers
      from management_order_lines_vw
      group by request_date
    `);
  await query(`
      create or replace view management_order_item_totals_vw as
      select
        request_date::text as request_date,
        category_name,
        item_name,
        supplier_name,
        unit_name,
        coalesce(sum(quantity_needed), 0) as total_quantity,
        round(avg(
          case
            when delivered_at is not null and requested_at is not null
            then extract(epoch from (delivered_at - requested_at)) / 86400.0
            else null
          end
        )::numeric, 1) as avg_lead_time_days
      from management_order_lines_vw
      group by request_date, category_name, item_name, supplier_name, unit_name
    `);
}
