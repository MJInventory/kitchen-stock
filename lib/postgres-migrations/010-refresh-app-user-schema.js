export async function refreshAppUserSchema(query) {
  await query(`
      alter table app_users
        add column if not exists notify_on_new_orders boolean not null default false,
        add column if not exists notify_on_delivery boolean not null default true,
        add column if not exists notify_area_bar boolean not null default true,
        add column if not exists notify_area_foh boolean not null default true,
        add column if not exists notify_area_kitchen boolean not null default true,
        add column if not exists notify_area_general boolean not null default true,
        add column if not exists desktop_idle_timeout_enabled boolean not null default true,
        add column if not exists blocked_goto_menu jsonb not null default '[]'::jsonb,
        add column if not exists blocked_backoffice_menu jsonb not null default '[]'::jsonb,
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
      update app_users
      set source = 'postgres',
          updated_at = now()
      where coalesce(source, '') <> 'postgres'
    `);
}
