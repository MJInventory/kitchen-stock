export async function refreshKitchenRosterSchema(query) {
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
}
