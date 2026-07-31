export function createReportSupportDomain({
  assertPostgresSchemaReady,
  db,
  pgRecordAuditEntry,
  todayIso,
  isValidId
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
        label: normalized.from === normalized.to
          ? normalized.from
          : `${normalized.from} to ${normalized.to}`
      };
    }
    if (mode === "week") {
      const from = startOfWeek(anchorDate);
      const to = endOfWeek(anchorDate);
      return { mode, date: anchorDate, from, to, label: `${from} to ${to}` };
    }
    if (mode === "month") {
      const from = startOfMonth(anchorDate);
      const to = endOfMonth(anchorDate);
      return { mode, date: anchorDate, from, to, label: `${from} to ${to}` };
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
    assertPostgresSchemaReady();
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
    assertPostgresSchemaReady();
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
    assertPostgresSchemaReady();
    const range = resolveManagementRange(payload);
    const summaryResult = await db().query(`
      select
        coalesce(sum(day_summary.total_quantity), 0) as total_quantity,
        coalesce(sum(day_summary.total_value), 0) as total_value,
        coalesce(sum(day_summary.total_lines), 0) as total_lines,
        (
          select count(distinct inventory_item_id)::integer
          from management_order_lines_vw
          where request_date between $1::date and $2::date
        ) as distinct_items,
        (
          select count(distinct supplier_name)::integer
          from management_order_lines_vw
          where request_date between $1::date and $2::date
        ) as distinct_suppliers
      from management_order_summary_vw day_summary
      where day_summary.request_date between $1::date::text and $2::date::text
    `, [range.from, range.to]);
    const rowResult = await db().query(`
      select
        category_name,
        item_name,
        supplier_name,
        unit_name,
        coalesce(sum(total_quantity), 0) as total_quantity,
        round(avg(average_unit_price), 2) as average_unit_price,
        coalesce(sum(total_value), 0) as total_value,
        round(avg(avg_lead_time_days)::numeric, 1) as avg_lead_time_days
      from management_order_item_totals_vw
      where request_date between $1::date::text and $2::date::text
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
      averageUnitPrice: Number(row.average_unit_price || 0),
      totalValue: Number(row.total_value || 0),
      avgLeadTimeDays: row.avg_lead_time_days == null ? null : Number(row.avg_lead_time_days)
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
        totalValue: Number(summaryRow.total_value || 0),
        totalLines: Number(summaryRow.total_lines || 0),
        distinctItems: Number(summaryRow.distinct_items || 0),
        distinctSuppliers: Number(summaryRow.distinct_suppliers || 0)
      },
      rows,
      groups
    };
  }

  async function pgSearchManagementItems(searchText = "") {
    assertPostgresSchemaReady();
    const query = String(searchText || "").trim();
    if (query.length < 2) return [];
    const result = await db().query(`
      select id, name
      from inventory_items
      where coalesce(active, true) = true
        and name ilike '%' || $1 || '%'
      order by
        case when lower(name) = lower($1) then 0 else 1 end,
        name
      limit 20
    `, [query]);
    return result.rows.map((row) => ({ id: row.id, name: row.name || "" }));
  }

  async function pgGetManagementItemHistory(itemId) {
    assertPostgresSchemaReady();
    if (!isValidId(itemId)) throw new Error("Choose a valid inventory item.");
    const itemResult = await db().query(`
      select id, name
      from inventory_items
      where id = $1
        and coalesce(active, true) = true
      limit 1
    `, [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new Error("Inventory item not found.");

    const historyResult = await db().query(`
      select
        request_id,
        request_number,
        requested_at,
        requested_by_username,
        supplier_name,
        quantity_needed,
        unit_name,
        unit_price,
        total_value,
        status,
        ordered,
        delivered,
        standing_order_run_id,
        standing_order_run_line_id
      from management_order_lines_vw
      where inventory_item_id = $1
      order by requested_at desc, request_number desc
    `, [itemId]);

    const aggregateFor = async (grain) => {
      const result = await db().query(`
        select
          date_trunc($2, requested_at)::date::text as period_start,
          count(*)::integer as order_count,
          coalesce(sum(quantity_needed), 0) as total_quantity,
          round(avg(quantity_needed)::numeric, 2) as average_order_quantity,
          round(
            coalesce(sum(total_value) / nullif(sum(quantity_needed), 0), 0)::numeric,
            2
          ) as average_unit_price,
          coalesce(sum(total_value), 0)::numeric(14,2) as total_value
        from management_order_lines_vw
        where inventory_item_id = $1
        group by date_trunc($2, requested_at)::date
        order by date_trunc($2, requested_at)::date desc
      `, [itemId, grain]);
      return result.rows.map((row) => ({
        periodStart: row.period_start || "",
        orderCount: Number(row.order_count || 0),
        totalQuantity: Number(row.total_quantity || 0),
        averageOrderQuantity: Number(row.average_order_quantity || 0),
        averageUnitPrice: Number(row.average_unit_price || 0),
        totalValue: Number(row.total_value || 0)
      }));
    };

    const [day, week, month] = await Promise.all([
      aggregateFor("day"),
      aggregateFor("week"),
      aggregateFor("month")
    ]);
    const history = historyResult.rows.map((row) => ({
      requestId: row.request_id || "",
      requestNumber: row.request_number ?? "",
      requestedAt: row.requested_at || "",
      requestedBy: row.requested_by_username || "",
      supplierName: row.supplier_name || "Unassigned Supplier",
      quantity: Number(row.quantity_needed || 0),
      unit: row.unit_name || "item",
      unitPrice: Number(row.unit_price || 0),
      totalValue: Number(row.total_value || 0),
      status: row.delivered ? "Delivered" : row.ordered ? "Ordered" : row.status || "Open",
      standingOrder: Boolean(row.standing_order_run_id || row.standing_order_run_line_id)
    }));
    const totalQuantity = history.reduce((sum, row) => sum + row.quantity, 0);
    const totalValue = history.reduce((sum, row) => sum + row.totalValue, 0);
    return {
      item: { id: item.id, name: item.name || "" },
      summary: {
        orderCount: history.length,
        totalQuantity,
        averageOrderQuantity: history.length ? totalQuantity / history.length : 0,
        averageUnitPrice: totalQuantity ? totalValue / totalQuantity : 0,
        totalValue
      },
      averages: { day, week, month },
      history
    };
  }

  return {
    pgListSupplierDeliveryNotes,
    pgSaveSupplierDeliveryNote,
    pgGetDailyGuestCount,
    pgSaveDailyGuestCount,
    pgGetManagementReport,
    pgSearchManagementItems,
    pgGetManagementItemHistory
  };
}
