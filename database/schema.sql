create extension if not exists "pgcrypto";

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null check (role in ('god', 'admin', 'power-user', 'staff', 'user')),
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  active boolean not null default true,
  must_change_password boolean not null default false,
  is_driver boolean not null default false,
  is_picker boolean not null default false,
  is_kitchen_staff boolean not null default false,
  kitchen_function text not null default '',
  open_order_days integer not null default 7,
  notify_on_new_orders boolean not null default false,
  notify_on_delivery boolean not null default true,
  notify_area_bar boolean not null default true,
  notify_area_foh boolean not null default true,
  notify_area_kitchen boolean not null default true,
  notify_area_general boolean not null default true,
  hidden_goto_menu jsonb not null default '[]'::jsonb,
  hidden_backoffice_menu jsonb not null default '[]'::jsonb,
  source text not null default 'postgres',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kitchen_shift_types (
  id uuid primary key default gen_random_uuid(),
  shift_code text not null unique,
  label text not null,
  color text not null default '#c7f9d4',
  shift_group text not null default 'kitchen' check (shift_group in ('kitchen', 'foh', 'bar', 'other')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
from kitchen_shift_types;

create table if not exists kitchen_roster_weeks (
  week_start date primary key,
  created_by_username text not null default '',
  locked boolean not null default false,
  locked_by_username text not null default '',
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
);

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
where active = true and is_kitchen_staff = true;

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
left join kitchen_shift_types t on t.id = s.shift_type_id;

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_information text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists units_of_measure (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shelf_codes (
  id uuid primary key default gen_random_uuid(),
  storage_location_id uuid not null references storage_locations(id) on delete cascade,
  code text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_location_id, code)
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references categories(id) on delete set null,
  storage_location_id uuid references storage_locations(id) on delete set null,
  shelf_code_id uuid references shelf_codes(id) on delete set null,
  inventory_area_id uuid references inventory_areas(id) on delete set null,
  primary_supplier_id uuid references suppliers(id) on delete set null,
  unit_of_measure_id uuid references units_of_measure(id) on delete set null,
  current_quantity numeric(12,2) not null default 0,
  minimum_threshold numeric(12,2) not null default 0,
  unit_price numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_items_name on inventory_items (name);
create index if not exists idx_inventory_items_category on inventory_items (category_id);
create index if not exists idx_inventory_items_supplier on inventory_items (primary_supplier_id);
create index if not exists idx_inventory_items_area on inventory_items (inventory_area_id);
create index if not exists idx_inventory_items_location on inventory_items (storage_location_id);
create index if not exists idx_inventory_items_unit on inventory_items (unit_of_measure_id);
create index if not exists idx_inventory_items_shelf on inventory_items (shelf_code_id);

create table if not exists order_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  quantity_needed numeric(12,2) not null,
  order_unit text not null default '',
  urgency_level text not null default 'Medium',
  status text not null default 'Approved',
  requested_by_username text not null,
  requested_at timestamptz not null default now(),
  ordered boolean not null default false,
  ordered_at timestamptz,
  ordered_by_username text,
  delivered boolean not null default false,
  delivered_at timestamptz,
  delivered_by_username text,
  to_deliver boolean not null default false,
  delivery_day date,
  notes text not null default '',
  partial_receipt boolean not null default false,
  standing_order_run_id uuid,
  standing_order_run_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_requests_open on order_requests (status, delivered, requested_at);
create index if not exists idx_order_requests_item on order_requests (inventory_item_id);

create table if not exists driver_sheet_lines (
  id uuid primary key default gen_random_uuid(),
  sheet_date date not null,
  order_request_id uuid not null references order_requests(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  driver_username text,
  ordered boolean not null default false,
  ordered_at timestamptz,
  ordered_by_username text,
  received boolean not null default false,
  received_at timestamptz,
  received_by_username text,
  to_deliver boolean not null default false,
  delivery_day date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_date, order_request_id)
);

create index if not exists idx_driver_sheet_lines_supplier on driver_sheet_lines (supplier_id);
create index if not exists idx_driver_sheet_lines_order_request on driver_sheet_lines (order_request_id);

create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  counted_quantity numeric(12,2) not null,
  previous_quantity numeric(12,2) not null default 0,
  counted_by_username text not null,
  counted_at timestamptz not null default now(),
  notes text not null default ''
);

create index if not exists idx_stock_counts_item on stock_counts (inventory_item_id);

create table if not exists standing_orders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  expected_arrival_date date,
  schedule text not null default 'Weekly',
  other_schedule text not null default '',
  recurring boolean not null default true,
  active boolean not null default true,
  deleted boolean not null default false,
  last_generated_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_standing_orders_supplier on standing_orders (supplier_id);

create table if not exists standing_order_items (
  id uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  quantity numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (standing_order_id, inventory_item_id)
);

create index if not exists idx_standing_order_items_inventory_item on standing_order_items (inventory_item_id);

create table if not exists standing_order_runs (
  id uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  expected_delivery_date date not null,
  status text not null default 'Open',
  generated_at timestamptz not null default now(),
  generated_by_username text not null,
  closed_at timestamptz,
  closed_by_username text,
  notes text not null default ''
);

create unique index if not exists idx_standing_order_runs_once_per_day
  on standing_order_runs (standing_order_id, expected_delivery_date);

create table if not exists standing_order_run_lines (
  id uuid primary key default gen_random_uuid(),
  standing_order_run_id uuid not null references standing_order_runs(id) on delete cascade,
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  order_request_id uuid references order_requests(id) on delete set null,
  driver_sheet_line_id uuid references driver_sheet_lines(id) on delete set null,
  quantity numeric(12,2) not null,
  unit text not null default '',
  supplier_name text not null default '',
  received boolean not null default false,
  received_at timestamptz,
  received_by_username text,
  status text not null default 'Scheduled',
  notes text not null default ''
);

create index if not exists idx_standing_order_run_lines_run on standing_order_run_lines (standing_order_run_id);
create index if not exists idx_standing_order_run_lines_standing_order on standing_order_run_lines (standing_order_id);
create index if not exists idx_standing_order_run_lines_item on standing_order_run_lines (inventory_item_id);
create index if not exists idx_standing_order_run_lines_request on standing_order_run_lines (order_request_id);
create index if not exists idx_standing_order_run_lines_driver_sheet_line on standing_order_run_lines (driver_sheet_line_id);

create table if not exists daily_guest_counts (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  guests integer not null check (guests >= 0),
  notes text not null default '',
  entered_by_username text not null,
  entered_at timestamptz not null default now()
);

create table if not exists invoice_captures (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  invoice_number text not null default '',
  invoice_total numeric(12,2),
  captured_by_username text not null,
  captured_at timestamptz not null default now(),
  image_name text not null default '',
  image_url text not null default '',
  ocr_text text not null default '',
  sent_to_accounting boolean not null default false,
  sent_to_accounting_at timestamptz,
  notes text not null default ''
);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_capture_id uuid not null references invoice_captures(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  invoice_number text not null default '',
  item_name text not null default '',
  raw_description text not null default '',
  quantity numeric(12,2),
  unit text not null default '',
  unit_price numeric(12,2),
  total_price numeric(12,2),
  matched boolean not null default false,
  notes text not null default ''
);

create table if not exists invoice_ocr_rules (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  supplier_name text not null default '',
  rule_type text not null default 'Line Item',
  ocr_match_text text not null default '',
  target_field text not null default '',
  inventory_item_id uuid references inventory_items(id) on delete set null,
  inventory_item_name text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_by_username text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
);

create index if not exists idx_app_notifications_user_read_created
  on app_notifications (user_id, is_read, created_at desc);
create index if not exists idx_app_notifications_related_request
  on app_notifications (related_request_id);
create index if not exists idx_app_notifications_related_standing_order
  on app_notifications (related_standing_order_id);
create index if not exists idx_app_notifications_related_standing_order_run
  on app_notifications (related_standing_order_run_id);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on push_subscriptions (user_id, updated_at desc);

create table if not exists driver_sheet_assignments (
  sheet_date date primary key,
  driver_username text not null,
  assigned_by_username text not null default '',
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists supplier_delivery_notes (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  supplier_name text not null,
  memo text not null default '',
  entered_by_username text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_date, supplier_name)
);

create table if not exists internal_order_batches (
  id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid references app_users(id) on delete set null,
  requested_by_username text not null default '',
  status text not null default 'open' check (status in ('open', 'ready', 'closed', 'partial')),
  notes text not null default '',
  picker_username text not null default '',
  ready_at timestamptz,
  ready_by_username text not null default '',
  closed_at timestamptz,
  closed_by_username text not null default '',
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
);

create index if not exists idx_internal_order_batches_requested_by_user
  on internal_order_batches (requested_by_user_id);
create index if not exists idx_internal_order_batches_status_user
  on internal_order_batches (status, requested_by_username, created_at desc);

create index if not exists idx_internal_order_lines_batch_status
  on internal_order_lines (internal_order_batch_id, status, created_at);
create index if not exists idx_internal_order_lines_inventory_item
  on internal_order_lines (inventory_item_id);
create index if not exists idx_internal_order_lines_shortage_request
  on internal_order_lines (shortage_request_id);
create index if not exists idx_internal_order_lines_auto_min_request
  on internal_order_lines (auto_min_request_id);

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
);

create index if not exists idx_audit_log_entries_date_created
  on audit_log_entries (action_date desc, created_at desc);

-- BEGIN REPORTING_VIEWS
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
  sp.contact_information as supplier_contact,
  i.unit_price
from order_requests r
join inventory_items i on i.id = r.inventory_item_id
left join categories c on c.id = i.category_id
left join storage_locations sl on sl.id = i.storage_location_id
left join inventory_areas ia on ia.id = i.inventory_area_id
left join shelf_codes sc on sc.id = i.shelf_code_id
left join units_of_measure u on u.id = i.unit_of_measure_id
left join suppliers sp on sp.id = i.primary_supplier_id;

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
left join units_of_measure u on u.id = i.unit_of_measure_id;

create or replace view order_request_supply_vw as
select
  r.id,
  r.request_number,
  r.item_id,
  r.inventory_item_id,
  r.quantity,
  r.quantity_needed,
  r.urgency,
  r.urgency_level,
  r.status,
  r.requested_by,
  r.requested_by_username,
  r.requested_at,
  r.delivered,
  r.delivered_at,
  r.delivered_by,
  r.delivered_by_username,
  r.ordered,
  r.ordered_at,
  r.ordered_by,
  r.ordered_by_username,
  r.to_deliver,
  r.delivery_day,
  r.request_day,
  r.is_today_request,
  r.is_standing_order,
  r.scheduled_delivery_future,
  r.request_age_days,
  r.origin_type,
  r.notes,
  r.partial_receipt,
  r.standing_order_run_id,
  r.standing_order_run_line_id,
  r.order_unit,
  r.item_name,
  r.category,
  r.storage_location,
  r.inventory_area,
  r.shelf_code,
  r.unit,
  r.primary_supplier_id,
  r.supplier_name,
  r.supplier_contact,
  coalesce(sor.expected_delivery_date::text, so.expected_arrival_date::text, '') as expected_date,
  sorl.supplier_name as standing_line_supplier_name,
  coalesce(ss.id, sso.id, r.primary_supplier_id) as resolved_supplier_id,
  coalesce(nullif(trim(sorl.supplier_name), ''), sso.name, r.supplier_name) as resolved_supplier_name,
  coalesce(ss.contact_information, sso.contact_information, r.supplier_contact, '') as resolved_supplier_contact,
  r.unit_price
from order_request_details_vw r
left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
left join suppliers sso on sso.id = so.supplier_id
left join suppliers ss on lower(ss.name) = lower(sorl.supplier_name);

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
  r.expected_date,
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
  r.unit,
  r.unit_price
from order_request_supply_vw r
left join driver_sheet_lines d on d.order_request_id = r.id
left join suppliers ds on ds.id = d.supplier_id;

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
  )::integer as to_deliver_lines,
  coalesce(sum(quantity * unit_price) filter (
    where coalesce(is_standing_order, false) = false
      and (coalesce(received, false) = true or coalesce(delivered, false) = true)
      and unit_price is not null
  ), 0)::numeric(12,2) as delivered_value
from driver_sheet_request_vw
where sheet_date is not null
group by sheet_date;

create or replace view audit_daily_summary_vw as
select
  action_date::text as action_date,
  count(*) filter (where action_type = 'add')::integer as adds,
  count(*) filter (where action_type = 'change')::integer as changes,
  count(*) filter (where action_type = 'delete')::integer as deletes,
  count(distinct nullif(trim(actor_username), ''))::integer as users
from audit_log_entries
group by action_date;

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
  and coalesce(r.status, '') in ('Pending', 'Approved');

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
) any_closed_run on true;

create or replace view inventory_below_minimum_vw as
select
  i.id,
  i.name,
  coalesce(i.current_quantity, 0) as current_quantity,
  coalesce(i.minimum_threshold, 0) as minimum_threshold
from inventory_items i
where coalesce(i.active, true) = true
  and coalesce(i.current_quantity, 0) < coalesce(i.minimum_threshold, 0);

create or replace view standing_order_due_vw as
select
  id,
  supplier_name,
  expected_date,
  schedule
from standing_order_overview_vw
where display_active = true
  and nullif(expected_date, '') is not null
  and expected_date::date <= current_date;

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
left join storage_locations sl on sl.id = i.storage_location_id;

create or replace view management_order_summary_vw as
select
  request_date::text as request_date,
  coalesce(sum(quantity_needed), 0) as total_quantity,
  count(*)::integer as total_lines,
  count(distinct inventory_item_id)::integer as distinct_items,
  count(distinct supplier_name)::integer as distinct_suppliers
from management_order_lines_vw
group by request_date;

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
group by request_date, category_name, item_name, supplier_name, unit_name;
-- END REPORTING_VIEWS
