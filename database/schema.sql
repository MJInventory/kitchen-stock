create extension if not exists "pgcrypto";

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null check (role in ('god', 'admin', 'power-user', 'user')),
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  active boolean not null default true,
  must_change_password boolean not null default false,
  source text not null default 'postgres',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null unique,
  contact_information text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage_locations (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_areas (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists units_of_measure (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shelf_codes (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
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
  external_id text unique,
  name text not null,
  category_id uuid references categories(id) on delete set null,
  storage_location_id uuid references storage_locations(id) on delete set null,
  shelf_code_id uuid references shelf_codes(id) on delete set null,
  inventory_area_id uuid references inventory_areas(id) on delete set null,
  primary_supplier_id uuid references suppliers(id) on delete set null,
  unit_of_measure_id uuid references units_of_measure(id) on delete set null,
  current_quantity numeric(12,2) not null default 0,
  minimum_threshold numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_items_name on inventory_items (name);
create index if not exists idx_inventory_items_category on inventory_items (category_id);
create index if not exists idx_inventory_items_supplier on inventory_items (primary_supplier_id);

create table if not exists order_requests (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  request_number bigint generated always as identity,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  quantity_needed numeric(12,2) not null,
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
  standing_order_run_id uuid,
  standing_order_run_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_requests_open on order_requests (status, delivered, requested_at);
create index if not exists idx_order_requests_item on order_requests (inventory_item_id);

create table if not exists driver_sheet_lines (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
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

create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  counted_quantity numeric(12,2) not null,
  previous_quantity numeric(12,2) not null default 0,
  counted_by_username text not null,
  counted_at timestamptz not null default now(),
  notes text not null default ''
);

create table if not exists standing_orders (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  expected_arrival_date date,
  schedule text not null default 'Weekly',
  other_schedule text not null default '',
  recurring boolean not null default true,
  active boolean not null default true,
  last_generated_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists standing_order_items (
  id uuid primary key default gen_random_uuid(),
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  quantity numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (standing_order_id, inventory_item_id)
);

create table if not exists standing_order_runs (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  standing_order_id uuid not null references standing_orders(id) on delete cascade,
  expected_delivery_date date not null,
  status text not null default 'Open',
  generated_at timestamptz not null default now(),
  generated_by_username text not null,
  closed_at timestamptz,
  closed_by_username text,
  notes text not null default ''
);

create table if not exists standing_order_run_lines (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
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

create table if not exists daily_guest_counts (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  report_date date not null unique,
  guests integer not null check (guests >= 0),
  notes text not null default '',
  entered_by_username text not null,
  entered_at timestamptz not null default now()
);

create table if not exists invoice_captures (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  supplier_id uuid references suppliers(id) on delete set null,
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
  external_id text unique,
  invoice_capture_id uuid not null references invoice_captures(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  raw_description text not null default '',
  quantity numeric(12,2),
  unit text not null default '',
  unit_price numeric(12,2),
  total_price numeric(12,2),
  matched boolean not null default false,
  notes text not null default ''
);
