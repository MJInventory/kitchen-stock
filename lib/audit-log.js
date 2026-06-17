export function createAuditLogHelpers({
  ensurePostgresSchemaUpgrades,
  db,
  todayIso
}) {
  function cleanAuditSnapshot(value) {
    if (value == null) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function auditChanged(before, after) {
    return JSON.stringify(cleanAuditSnapshot(before)) !== JSON.stringify(cleanAuditSnapshot(after));
  }

  async function pgRecordAuditEntry({
    actionType,
    entityType,
    entityId = "",
    entityName = "",
    actorUsername = "",
    reasonCode = "",
    note = "",
    before = null,
    after = null,
    actionDate = todayIso()
  }) {
    await ensurePostgresSchemaUpgrades();
    await db().query(`
      insert into audit_log_entries (
        action_date, action_type, entity_type, entity_id, entity_name,
        actor_username, reason_code, note, before_json, after_json
      )
      values ($1::date, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
    `, [
      /^\d{4}-\d{2}-\d{2}$/.test(actionDate || "") ? actionDate : todayIso(),
      actionType,
      entityType,
      String(entityId || ""),
      String(entityName || ""),
      String(actorUsername || ""),
      String(reasonCode || ""),
      String(note || ""),
      JSON.stringify(cleanAuditSnapshot(before)),
      JSON.stringify(cleanAuditSnapshot(after))
    ]);
  }

  async function pgListAuditEntries(date) {
    await ensurePostgresSchemaUpgrades();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    const result = await db().query(`
      select
        id,
        action_date::text as action_date,
        action_type,
        entity_type,
        entity_id,
        entity_name,
        actor_username,
        reason_code,
        note,
        before_json,
        after_json,
        created_at
      from audit_log_entries
      where action_date = $1::date
      order by created_at desc, entity_type, entity_name
    `, [selectedDate]);
    return result.rows.map((row) => ({
      id: row.id,
      date: row.action_date || selectedDate,
      actionType: row.action_type || "",
      entityType: row.entity_type || "",
      entityId: row.entity_id || "",
      entityName: row.entity_name || "",
      actorUsername: row.actor_username || "",
      reasonCode: row.reason_code || "",
      note: row.note || "",
      before: row.before_json || null,
      after: row.after_json || null,
      createdAt: row.created_at || ""
    }));
  }

  return {
    cleanAuditSnapshot,
    auditChanged,
    pgRecordAuditEntry,
    pgListAuditEntries
  };
}
