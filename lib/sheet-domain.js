export function createSheetDomain({
  db,
  cache,
  appTimeZone,
  todayIso,
  isValidId,
  allowedUnits,
  presentUserName,
  auditChanged,
  pgRecordAuditEntry,
  pgResolveDriverName,
  pgGenerateStandingOrdersForDate,
  pgSyncStandingOrderRunsForDate,
  pgListSuppliers,
  pgListSupplierDeliveryNotes,
  pgGetDailyGuestCount,
  pgListStandingOrders,
  pgListAuditEntries,
  pgDriverLineFromRow,
  pgRequestFromRow,
  isStandingOrderRequestRow,
  pgDeliverRequest,
  pgNotificationUsers,
  pgCreateNotificationsForUsers,
  pgCloseStandingOrderRunIfCompleteTx
}) {
  async function pgEnsureDriverSheetLines(selectedDate) {
    const resolvedDriver = await pgResolveDriverName(selectedDate);
    await db().query(`
      insert into driver_sheet_lines (
        sheet_date, order_request_id, supplier_id, driver_username, ordered, received, to_deliver, delivery_day, notes
      )
      select
        $1::date,
        r.id,
        coalesce(sso.id, i.primary_supplier_id),
        $3,
        r.ordered,
        r.delivered,
        r.to_deliver,
        r.delivery_day,
        r.notes
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      where r.delivered = false
        and r.status in ('Pending', 'Approved')
        and (r.requested_at at time zone $2)::date <= $1::date
        and not exists (
          select 1
          from driver_sheet_lines d
          where d.sheet_date = $1::date and d.order_request_id = r.id
        )
    `, [selectedDate, appTimeZone, resolvedDriver || null]);

    await db().query(`
      update driver_sheet_lines d
      set supplier_id = sso.id,
          updated_at = now()
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      where d.order_request_id = r.id
        and d.sheet_date = $1::date
        and r.delivered = false
        and r.status in ('Pending', 'Approved')
        and sso.id is not null
        and d.supplier_id = i.primary_supplier_id
        and i.primary_supplier_id is distinct from sso.id
        and coalesce(d.ordered, false) = false
        and coalesce(d.received, false) = false
    `, [selectedDate]);

    if (resolvedDriver) {
      await db().query(`
        update driver_sheet_lines
        set driver_username = $2, updated_at = now()
        where sheet_date = $1::date
          and coalesce(nullif(trim(driver_username), ''), '') = ''
      `, [selectedDate, resolvedDriver]);
    }
  }

  async function pgDriverSheetRequests(selectedDate) {
    await pgEnsureDriverSheetLines(selectedDate);
    const result = await db().query(`
      select
        d.id as driver_line_id,
        d.sheet_date::text as sheet_date,
        d.driver_username as driver_name,
        d.ordered,
        d.ordered_at,
        d.ordered_by_username as ordered_by,
        d.received as line_received,
        d.received_at,
        d.received_by_username as received_by,
        d.to_deliver,
        d.delivery_day::text as delivery_day,
        coalesce(ds.name, nullif(trim(sorl.supplier_name), ''), sso.name, sp.name) as supplier_name,
        coalesce(ds.contact_information, ss.contact_information, sso.contact_information, sp.contact_information, '') as supplier_contact,
        r.id,
        r.request_number,
        r.item_id,
        r.quantity,
        r.urgency,
        r.status,
        r.requested_by,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by,
        r.notes,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        r.item_name,
        r.category,
        r.storage_location,
        r.inventory_area,
        r.shelf_code,
        r.unit
      from order_request_details_vw r
      left join suppliers sp on sp.id = r.primary_supplier_id
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      left join suppliers ss on lower(ss.name) = lower(sorl.supplier_name)
      left join driver_sheet_lines d on d.order_request_id = r.id and d.sheet_date = $1::date
      left join suppliers ds on ds.id = d.supplier_id
      where r.delivered = false
        and r.status in ('Pending', 'Approved')
        and (r.requested_at at time zone $2)::date <= $1::date
      order by coalesce(ds.name, nullif(trim(sorl.supplier_name), ''), sso.name, sp.name) nulls last, r.category nulls last, r.shelf_code nulls last, r.item_name
    `, [selectedDate, appTimeZone]);
    return result.rows.map((row) => pgRequestFromRow({
      ...row,
      supplier_name: row.supplier_name,
      supplier_contact: row.supplier_contact,
      driver_line_id: row.driver_line_id,
      ordered: row.ordered,
      ordered_at: row.ordered_at,
      ordered_by: row.ordered_by,
      to_deliver: row.to_deliver,
      delivery_day: row.delivery_day,
      driver_name: row.driver_name,
      delivered: row.delivered,
      delivered_at: row.delivered_at,
      delivered_by: row.delivered_by,
      received: row.line_received || row.delivered,
      received_at: row.received_at || row.delivered_at,
      received_by: row.received_by || row.delivered_by
    }));
  }

  async function pgListDriverSheet(date) {
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    await pgGenerateStandingOrdersForDate(selectedDate);
    await pgSyncStandingOrderRunsForDate(selectedDate);
    const [requests, suppliers] = await Promise.all([
      pgDriverSheetRequests(selectedDate),
      pgListSuppliers()
    ]);
    const filteredRequests = requests.filter((request) => !isStandingOrderRequestRow(request));
    const driverName = await pgResolveDriverName(selectedDate);
    return { date: selectedDate, driverName, requests: filteredRequests, suppliers };
  }

  async function pgListReceivingSheet(date) {
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    await pgGenerateStandingOrdersForDate(selectedDate);
    await pgSyncStandingOrderRunsForDate(selectedDate);
    const [requests, suppliers, supplierNotes] = await Promise.all([
      pgDriverSheetRequests(selectedDate),
      pgListSuppliers(),
      pgListSupplierDeliveryNotes(selectedDate)
    ]);
    const receiverName = "";
    return {
      date: selectedDate,
      driverName: receiverName,
      suppliers,
      supplierNotes,
      requests: requests.filter((request) => !request.delivered && request.status !== "Fulfilled")
    };
  }

  async function pgListOrderReport(date) {
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    await pgGenerateStandingOrdersForDate(selectedDate);
    await pgSyncStandingOrderRunsForDate(selectedDate);
    await pgEnsureDriverSheetLines(selectedDate);
    const [guestCount, standingOrders, activity] = await Promise.all([
      pgGetDailyGuestCount(selectedDate),
      pgListStandingOrders(),
      pgListAuditEntries(selectedDate)
    ]);
    const result = await db().query(`
      select
        d.id,
        d.sheet_date::text as sheet_date,
        d.driver_username,
        d.ordered,
        d.ordered_at,
        d.ordered_by_username,
        d.received,
        d.received_at,
        d.received_by_username,
        d.to_deliver,
        d.delivery_day::text as delivery_day,
        coalesce(ds.name, nullif(trim(sorl.supplier_name), ''), sso.name, sp.name) as supplier_name,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        r.id as request_id,
        r.request_number,
        r.quantity,
        r.urgency,
        r.status,
        r.requested_by,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by,
        r.notes,
        r.item_name,
        r.category,
        r.storage_location,
        r.inventory_area,
        r.shelf_code,
        r.unit
      from driver_sheet_lines d
      join order_request_details_vw r on r.id = d.order_request_id
      left join suppliers sp on sp.id = r.primary_supplier_id
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      left join suppliers ds on ds.id = d.supplier_id
      where d.sheet_date = $1::date
      order by coalesce(ds.name, nullif(trim(sorl.supplier_name), ''), sso.name, sp.name) nulls last, r.category nulls last, r.item_name
    `, [selectedDate]);
    const rows = result.rows.map((row) => ({
      ...pgDriverLineFromRow(row),
      requestId: row.request_number,
      requestedBy: row.requested_by || "",
      requestedAt: row.requested_at || "",
      urgency: row.urgency || "",
      status: row.received || row.delivered ? "Delivered" : row.ordered ? "Picked / Ordered" : "Waiting",
      delivered: Boolean(row.received || row.delivered),
      waiting: !(row.received || row.delivered)
    }));
    const reportRows = rows.filter((row) => !isStandingOrderRequestRow(row));
    return {
      date: selectedDate,
      summary: {
        guests: guestCount?.guests ?? null,
        totalLines: reportRows.length,
        orderedLines: reportRows.filter((row) => row.ordered).length,
        deliveredLines: reportRows.filter((row) => row.delivered).length,
        waitingLines: reportRows.filter((row) => row.waiting).length,
        toDeliverLines: reportRows.filter((row) => row.toDeliver).length
      },
      guestCount,
      rows: reportRows,
      standingOrders,
      activity
    };
  }

  async function pgAssignDriverToSheet(date, driverName, user) {
    if (!user.permissions?.canAdminUsers) throw new Error("Only admins can assign a driver.");
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayIso();
    const cleaned = String(driverName || "").trim();
    if (!cleaned) throw new Error("Driver name is required.");
    await db().query(`
      insert into driver_sheet_assignments (sheet_date, driver_username, assigned_by_username)
      values ($1::date, $2, $3)
      on conflict (sheet_date) do update
        set driver_username = excluded.driver_username,
            assigned_by_username = excluded.assigned_by_username,
            updated_at = now()
    `, [selectedDate, cleaned, user.name || ""]);
    await pgEnsureDriverSheetLines(selectedDate);
    const result = await db().query(`
      update driver_sheet_lines
      set driver_username = $2, updated_at = now()
      where sheet_date = $1::date
      returning id
    `, [selectedDate, cleaned]);
    await pgRecordAuditEntry({
      actionType: "change",
      entityType: "driver-assignment",
      entityId: selectedDate,
      entityName: `Driver assignment ${selectedDate}`,
      actorUsername: user.name || "",
      reasonCode: "driver-assign",
      note: `${presentUserName(cleaned)} assigned to ${selectedDate}.`,
      after: { date: selectedDate, driverName: cleaned, updated: result.rowCount }
    });
    return { date: selectedDate, driverName: cleaned, updated: result.rowCount };
  }

  async function pgUpdateDriverLine(recordId, payload, userName) {
    if (!isValidId(recordId)) throw new Error("Invalid driver line record.");
    const currentResult = await db().query(`
      select d.id, d.sheet_date::text as sheet_date, d.order_request_id, r.inventory_item_id,
             r.standing_order_run_line_id, sp.id as current_supplier_id, d.to_deliver
      from driver_sheet_lines d
      join order_requests r on r.id = d.order_request_id
      left join suppliers sp on sp.id = d.supplier_id
      where d.id = $1
    `, [recordId]);
    const current = currentResult.rows[0];
    if (!current) throw new Error("Driver line was not found.");
    const beforeSheet = await pgListDriverSheet(current.sheet_date || todayIso());
    const before = beforeSheet.requests.find((request) => request.driverLineId === recordId) || null;
    const fields = [];
    const values = [recordId];
    const requestFields = [];
    const requestValues = [current.order_request_id];
    if (Object.prototype.hasOwnProperty.call(payload, "ordered")) {
      values.push(Boolean(payload.ordered), Boolean(payload.ordered) ? new Date().toISOString() : null, Boolean(payload.ordered) ? userName : "");
      fields.push(`ordered = $${values.length - 2}`, `ordered_at = $${values.length - 1}`, `ordered_by_username = $${values.length}`);
      requestValues.push(Boolean(payload.ordered), Boolean(payload.ordered) ? new Date().toISOString() : null, Boolean(payload.ordered) ? userName : "");
      requestFields.push(`ordered = $${requestValues.length - 2}`, `ordered_at = $${requestValues.length - 1}`, `ordered_by_username = $${requestValues.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "toDeliver")) {
      const toDeliver = Boolean(payload.toDeliver);
      const rawDay = String(payload.deliveryDay || "").trim();
      const day = toDeliver && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : null;
      values.push(toDeliver, day);
      fields.push(`to_deliver = $${values.length - 1}`, `delivery_day = $${values.length}`);
      requestValues.push(toDeliver, day);
      requestFields.push(`to_deliver = $${requestValues.length - 1}`, `delivery_day = $${requestValues.length}::date`);
      if (toDeliver && !Object.prototype.hasOwnProperty.call(payload, "ordered")) {
        values.push(true, new Date().toISOString(), userName);
        fields.push(`ordered = $${values.length - 2}`, `ordered_at = $${values.length - 1}`, `ordered_by_username = $${values.length}`);
        requestValues.push(true, new Date().toISOString(), userName);
        requestFields.push(`ordered = $${requestValues.length - 2}`, `ordered_at = $${requestValues.length - 1}`, `ordered_by_username = $${requestValues.length}`);
      }
    }
    if (!Object.prototype.hasOwnProperty.call(payload, "toDeliver") && Object.prototype.hasOwnProperty.call(payload, "deliveryDay")) {
      const rawDay = String(payload.deliveryDay || "").trim();
      const hasValidDay = /^\d{4}-\d{2}-\d{2}$/.test(rawDay);
      const toDeliver = hasValidDay ? true : false;
      values.push(toDeliver, hasValidDay ? rawDay : null);
      fields.push(`to_deliver = $${values.length - 1}`, `delivery_day = $${values.length}`);
      requestValues.push(toDeliver, hasValidDay ? rawDay : null);
      requestFields.push(`to_deliver = $${requestValues.length - 1}`, `delivery_day = $${requestValues.length}::date`);
      if (toDeliver && !current.to_deliver) {
        values.push(true, new Date().toISOString(), userName);
        fields.push(`ordered = $${values.length - 2}`, `ordered_at = $${values.length - 1}`, `ordered_by_username = $${values.length}`);
        requestValues.push(true, new Date().toISOString(), userName);
        requestFields.push(`ordered = $${requestValues.length - 2}`, `ordered_at = $${requestValues.length - 1}`, `ordered_by_username = $${requestValues.length}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "supplierName")) {
      const supplierName = String(payload.supplierName || "").trim();
      const supplierResult = supplierName ? await db().query(`select id, name, contact_information from suppliers where lower(name) = lower($1) limit 1`, [supplierName]) : { rows: [] };
      const supplier = supplierResult.rows[0] || null;
      values.push(supplier?.id || null);
      fields.push(`supplier_id = $${values.length}`);
      if (payload.updatePrimarySupplier) {
        if (!supplier) throw new Error("Choose a known supplier before changing the primary supplier.");
        await db().query(`update inventory_items set primary_supplier_id = $2, updated_at = now() where id = $1`, [current.inventory_item_id, supplier.id]);
        cache.items.expiresAt = 0;
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "unit")) {
      const unit = String(payload.unit || "").trim().toLowerCase();
      if (!allowedUnits.has(unit)) {
        throw new Error("Unit must be box, bag, item, or bottle.");
      }
      requestValues.push(unit);
      requestFields.push(`order_unit = $${requestValues.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "quantity")) {
      const quantity = Number(payload.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }
      values.push(quantity);
      fields.push(`quantity = $${values.length}`);
      requestValues.push(quantity);
      requestFields.push(`quantity_needed = $${requestValues.length}`);
      if (current.standing_order_run_line_id && isValidId(current.standing_order_run_line_id)) {
        await db().query(`
          update standing_order_run_lines
          set quantity = $2,
              updated_at = now()
          where id = $1
        `, [current.standing_order_run_line_id, quantity]);
      }
    }
    if (!fields.length && !requestFields.length) throw new Error("Nothing to update.");
    if (fields.length) {
      await db().query(`
        update driver_sheet_lines
        set ${fields.join(", ")}, updated_at = now()
        where id = $1
      `, values);
    }
    if (requestFields.length) {
      await db().query(`
        update order_requests
        set ${requestFields.join(", ")}, updated_at = now()
        where id = $1
      `, requestValues);
    }
    const sheet = await pgListDriverSheet(current.sheet_date || todayIso());
    const match = sheet.requests.find((request) => request.driverLineId === recordId);
    if (match && auditChanged(before, match)) {
      let reasonCode = "driver-line-change";
      if (Object.prototype.hasOwnProperty.call(payload, "supplierName")) {
        reasonCode = payload.updatePrimarySupplier ? "supplier-primary-change" : "supplier-temp-change";
      } else if (Object.prototype.hasOwnProperty.call(payload, "unit")) {
        reasonCode = "unit-change";
      } else if (Object.prototype.hasOwnProperty.call(payload, "quantity")) {
        reasonCode = "quantity-change";
      } else if (Object.prototype.hasOwnProperty.call(payload, "toDeliver")) {
        reasonCode = "delivery-plan-change";
      } else if (Object.prototype.hasOwnProperty.call(payload, "ordered")) {
        reasonCode = "picked-change";
      }
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "driver-line",
        entityId: recordId,
        entityName: match.itemName || before?.itemName || "Driver line",
        actorUsername: userName,
        reasonCode,
        before,
        after: match
      });
    }
    return match ? {
      id: match.driverLineId,
      ordered: match.ordered,
      toDeliver: match.toDeliver,
      deliveryDay: match.deliveryDay,
      received: match.delivered,
      driverName: match.driverName,
      supplierName: match.supplierName,
      supplierContact: match.supplierContact,
      unit: match.unit || "",
      quantity: match.quantity
    } : { id: recordId };
  }

  async function pgDeliverDriverLine(recordId, requestRecordId, userName, options = {}) {
    if (!isValidId(recordId) || !isValidId(requestRecordId)) throw new Error("Invalid driver line or request record.");
    const request = await pgDeliverRequest(requestRecordId, userName, { quantityReceived: options.quantityReceived });
    if (request.fullyDelivered) {
      await db().query(`
        update driver_sheet_lines
        set received = true, received_at = now(), received_by_username = $2, updated_at = now()
        where id = $1
      `, [recordId, userName]);
    } else {
      await db().query(`
        update driver_sheet_lines
        set received = false, received_at = null, received_by_username = '', updated_at = now()
        where id = $1
      `, [recordId]);
    }
    const lineResult = await db().query(`
      select d.id, d.driver_username, d.ordered, d.to_deliver, d.delivery_day::text as delivery_day,
             d.received, d.received_at, d.received_by_username,
             coalesce(ds.name, nullif(trim(sorl.supplier_name), ''), sso.name, sp.name) as supplier_name,
             coalesce(ds.contact_information, ss.contact_information, sso.contact_information, sp.contact_information, '') as supplier_contact
      from driver_sheet_lines d
      join order_requests r on r.id = d.order_request_id
      join inventory_items i on i.id = r.inventory_item_id
      left join suppliers sp on sp.id = i.primary_supplier_id
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      left join suppliers ss on lower(ss.name) = lower(sorl.supplier_name)
      left join suppliers ds on ds.id = d.supplier_id
      where d.id = $1
    `, [recordId]);
    const row = lineResult.rows[0] || {};
    return {
      request,
      line: {
        id: recordId,
        driverName: row.driver_username || "",
        ordered: Boolean(row.ordered),
        toDeliver: Boolean(row.to_deliver),
        deliveryDay: row.delivery_day || "",
        received: Boolean(row.received),
        receivedAt: row.received_at || "",
        receivedBy: row.received_by_username || "",
        supplierName: row.supplier_name || "Unassigned Supplier",
        supplierContact: row.supplier_contact || ""
      }
    };
  }

  return {
    pgEnsureDriverSheetLines,
    pgDriverSheetRequests,
    pgListDriverSheet,
    pgListReceivingSheet,
    pgListOrderReport,
    pgAssignDriverToSheet,
    pgUpdateDriverLine,
    pgDeliverDriverLine
  };
}
