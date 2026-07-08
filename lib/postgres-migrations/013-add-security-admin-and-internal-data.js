export async function addSecurityAdminAndInternalData(query) {
  await query(`
    alter table app_users
      drop constraint if exists app_users_role_check,
      add constraint app_users_role_check
        check (role in ('god', 'admin', 'security-admin', 'power-user', 'staff', 'user'))
  `);

  await query(`
    create table if not exists internal_data_services (
      id uuid primary key default gen_random_uuid(),
      service_name text not null,
      service_url text not null default '',
      username text not null default '',
      password_encrypted text not null default '',
      two_factor_enabled boolean not null default false,
      two_factor_details text not null default '',
      memo text not null default '',
      created_by_username text not null default '',
      updated_by_username text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await query(`
    create index if not exists idx_internal_data_services_name
      on internal_data_services (lower(service_name))
  `);
}
