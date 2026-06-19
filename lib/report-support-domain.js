export function createReportSupportDomain({
  ensurePostgresSchemaUpgrades,
  db,
  pgRecordAuditEntry,
  todayIso
}) {
  function isoDateValue(value) {
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  }

  function startOfWeek(dateText) {
    const date = new Date(`${dateText}T12:00:00Z`);
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date.toISOString().slice(0, 10);
  }

  function endOfWeek(dateText) {
    const date = new Date(`${startOfWeek(dateText)}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 6);
    return date.toISOString().slice(0, 10);
  }

  function startOfMonth(dateText) {
    const date = new Date(`${dateText}T12:00:00Z`);
    date.setUTCDate(1);
    return date.toISOString().slice(0, 10);
  }

  function endOfMonth(dateText) {
    const date = new Date(`${dateText}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return date.toISOString().slice(0, 10);
  }

  function resolveManagementRange(payload = {}) {
    const mode = String(payload.mode || "day").trim().toLowerCase();
    const anchorDate = isoDateValue(payload.date) || todayIso();
    if (mode === "custom") {
      const from = isoDateValue(payload.from) || anchorDate;
      const to = isoDateValue(payload.to) || from;
      const normalized = from <= to ? { from, to } : { from: to, to: from };
      return {
        mode: "custom",
        date: anchorDate,
        from: normalized.from,
        to: normalized.to,
        label: `${normalized.from} to ${normalized.to}`
      };
    }
    if (mode === "week") {
      const from = startOfWeek(anchorDate);
      const to = endOfWeek(anchorDate);
      return { mode, date: anchorDate, from, to, label: `Week of ${from}` };
    }
    if (mode === "month") {
      const from = startOfMonth(anchorDate);
      const to = endOfMonth(anchorDate);
      return { mode, date: anchorDate, from, to, label: `${anchorDate.slice(0, 7)}` };
    }
    return {
      mode: "day",
      date: anchorDate,
      from: anchorDate,
      to: anchorDate,
      label: anchorDate
    };
  }

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

  async function pgGetManagementReport(payload = {}) {
    await ensurePostgresSchemaUpgrades();
    const range = resolveManagementRange(payload);
    const summaryResult = await db().query(`
      select
        coalesce(sum(quantity_needed), 0) as total_quantity,
        count(*) as total_lines,
        count(distinct inventory_item_id) as distinct_items,
        count(distinct supplier_name) as distinct_suppliers
      from management_order_lines_vw
      where request_date between $1::date and $2::date
    `, [range.from, range.to]);
    const rowResult = await db().query(`
      select
        category_name,
        item_name,
        supplier_name,
        unit_name,
        coalesce(sum(quantity_needed), 0) as total_quantity,
        count(*) as line_count,
        coalesce(string_agg(distinct nullif(requested_by_username, ''), ', ' order by nullif(requested_by_username, '')), '') as requested_by
      from management_order_lines_vw
      where request_date between $1::date and $2::date
      group by category_name, item_name, supplier_name, unit_name
      order by category_name, item_name, supplier_name, unit_name
    `, [range.from, range.to]);
    const summaryRow = summaryResult.rows[0] || {};
    const rows = rowResult.rows.map((row) => ({
      categoryName: row.category_name || "Uncategorized",
      itemName: row.item_name || "",
      supplierName: row.supplier_name || "",
      unit: row.unit_name || "",
      totalQuantity: Number(row.total_quantity || 0),
      lineCount: Number(row.line_count || 0),
      requestedBy: row.requested_by || ""
    }));
    const groups = [];
    for (const row of rows) {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.categoryName !== row.categoryName) {
        groups.push({ categoryName: row.categoryName, rows: [row] });
      } else {
        lastGroup.rows.push(row);
      }
    }
    return {
      ...range,
      summary: {
        totalQuantity: Number(summaryRow.total_quantity || 0),
        totalLines: Number(summaryRow.total_lines || 0),
        distinctItems: Number(summaryRow.distinct_items || 0),
        distinctSuppliers: Number(summaryRow.distinct_suppliers || 0)
      },
      rows,
      groups
    };
  }

  return {
    pgListSupplierDeliveryNotes,
    pgSaveSupplierDeliveryNote,
    pgGetDailyGuestCount,
    pgSaveDailyGuestCount,
    pgGetManagementReport
  };
}
