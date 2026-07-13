export async function addScreenAccessControls(query) {
  await query(`
    alter table app_users
      add column if not exists blocked_goto_menu jsonb not null default '[]'::jsonb,
      add column if not exists blocked_backoffice_menu jsonb not null default '[]'::jsonb
  `);
}
