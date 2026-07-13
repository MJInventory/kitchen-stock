export async function addDesktopIdleTimeoutSetting(query) {
  await query(`
    alter table app_users
      add column if not exists desktop_idle_timeout_enabled boolean not null default true
  `);

  await query(`
    update app_users
    set desktop_idle_timeout_enabled = true
    where desktop_idle_timeout_enabled is null
  `);
}
