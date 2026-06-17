export function createReportSupportDomain({
  ensurePostgresSchemaUpgrades,
  db,
  pgRecordAuditEntry,
  todayIso
}) {
  async function pgListSupplierDeliveryNotes(date) {
    await ensurePostgresSchemaUpgrades();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    const result = await db().query(`
      select supplier_name, memo, entered_by_username, updated_at
      from supplier_delivery_notes
      where delivery_date = $1::date
      order by supplier_name
    `, [selectedDate]);
    return result.rows.map((row) => ({
      supplierName: row.supplier_name || "",
      memo: row.memo || "",
      enteredBy: row.entered_by_username || "",
      updatedAt: row.updated_at || ""
    }));
  }

  async function pgSaveSupplierDeliveryNote(payload, userName) {
    await ensurePostgresSchemaUpgrades();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || "").trim()) ? String(payload.date).trim() : todayIso();
    const supplierName = String(payload.supplierName || "").trim();
    const memo = String(payload.memo || "").trim();
    if (!supplierName) throw new Error("Choose the supplier for this memo.");
    const existingNotes = await pgListSupplierDeliveryNotes(selectedDate);
    const before = existingNotes.find((entry) => entry.supplierName.toLowerCase() === supplierName.toLowerCase()) || null;
    if (!memo) {
      await db().query(`
        delete from supplier_delivery_notes
        where delivery_date = $1::date and lower(supplier_name) = lower($2)
      `, [selectedDate, supplierName]);
      if (before) {
        await pgRecordAuditEntry({
          actionType: "delete",
          entityType: "supplier-delivery-note",
          entityId: `${selectedDate}:${supplierName}`,
          entityName: `${supplierName} ${selectedDate}`,
          actorUsername: userName,
          reasonCode: "supplier-note-delete",
          before,
          actionDate: selectedDate
        });
      }
      return { supplierName, memo: "", enteredBy: userName, updatedAt: new Date().toISOString() };
    }
    const result = await db().query(`
      insert into supplier_delivery_notes (delivery_date, supplier_name, memo, entered_by_username)
      values ($1::date, $2, $3, $4)
      on conflict (delivery_date, supplier_name) do update
        set memo = excluded.memo,
            entered_by_username = excluded.entered_by_username,
            updated_at = now()
      returning supplier_name, memo, entered_by_username, updated_at
    `, [selectedDate, supplierName, memo, userName]);
    const saved = {
      supplierName: result.rows[0]?.supplier_name || supplierName,
      memo: result.rows[0]?.memo || memo,
      enteredBy: result.rows[0]?.entered_by_username || userName,
      updatedAt: result.rows[0]?.updated_at || new Date().toISOString()
    };
    await pgRecordAuditEntry({
      actionType: before ? "change" : "add",
      entityType: "supplier-delivery-note",
      entityId: `${selectedDate}:${supplierName}`,
      entityName: `${supplierName} ${selectedDate}`,
      actorUsername: userName,
      reasonCode: before ? "supplier-note-update" : "supplier-note-create",
      before,
      after: saved,
      actionDate: selectedDate
    });
    return saved;
  }

  async function pgGetDailyGuestCount(date) {
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    const result = await db().query(`
      select id, report_date::text as date, guests, notes, entered_by_username as "enteredBy", entered_at as "enteredAt"
      from daily_guest_counts
      where report_date = $1::date
      limit 1
    `, [selectedDate]);
    return result.rows[0] || null;
  }

  async function pgSaveDailyGuestCount(payload, user) {
    if (!user.permissions?.canAdminUsers) throw new Error("Only admins can enter daily guest counts.");
    const selectedDate = String(payload.date || "").trim();
    const guests = Number(payload.guests);
    const notes = String(payload.notes || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) throw new Error("Choose a valid date.");
    if (!Number.isFinite(guests) || guests < 0) throw new Error("Guest count must be zero or greater.");
    const before = await pgGetDailyGuestCount(selectedDate);
    const result = await db().query(`
      insert into daily_guest_counts (report_date, guests, notes, entered_by_username, entered_at)
      values ($1::date, $2, $3, $4, now())
      on conflict (report_date) do update
        set guests = excluded.guests,
            notes = excluded.notes,
            entered_by_username = excluded.entered_by_username,
            entered_at = excluded.entered_at
      returning id, report_date::text as date, guests, notes, entered_by_username as "enteredBy", entered_at as "enteredAt"
    `, [selectedDate, Math.max(0, Math.round(guests)), notes, user.name]);
    const saved = result.rows[0];
    await pgRecordAuditEntry({
      actionType: before ? "change" : "add",
      entityType: "daily-guests",
      entityId: selectedDate,
      entityName: `Guest count ${selectedDate}`,
      actorUsername: user.name || "",
      reasonCode: before ? "guest-count-update" : "guest-count-create",
      before,
      after: saved,
      actionDate: selectedDate
    });
    return saved;
  }

  return {
    pgListSupplierDeliveryNotes,
    pgSaveSupplierDeliveryNote,
    pgGetDailyGuestCount,
    pgSaveDailyGuestCount
  };
}
