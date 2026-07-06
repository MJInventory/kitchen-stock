export function createStandingOrderDomain({
  db,
  cache,
  todayIso,
  isValidId,
  assertPostgresSchemaReady,
  pgStandingOrderFromRow,
  pgFindOrCreateSupplierByName,
  pgCreateRequest,
  pgCreateNotificationsForUsers,
  pgNotificationUsers,
  pgRecordAuditEntry
}) {
  function standingOrderSyncLockId(selectedDate) {
    const numericDate = Number(String(selectedDate || "").replace(/[^0-9]/g, "")) || 0;
    return 92000000 + numericDate;
  }

  async function withStandingOrderSyncLock(selectedDate, work) {
    const client = await db().connect();
    const lockId = standingOrderSyncLockId(selectedDate);
    try {
      await client.query(`select pg_advisory_lock($1)`, [lockId]);
      return await work();
    } finally {
      try {
        await client.query(`select pg_advisory_unlock($1)`, [lockId]);
      } catch {
        // Session release also clears the advisory lock if needed.
      }
      client.release();
    }
  }

  function addDays(dateText, days) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function nextStandingOrderDate(order, generatedDate) {
    if (order.schedule === "Daily") return addDays(generatedDate, 1);
    if (order.schedule === "Weekly") return addDays(generatedDate, 7);
    if (order.schedule === "Other") {
      const detail = String(order.otherSchedule || "").trim().toLowerCase();
      const numericDays = Number(detail.replace(/[^0-9]/g, ""));
      if (Number.isFinite(numericDays) && numericDays > 0) return addDays(generatedDate, numericDays);
      if (detail.includes("biweek")) return addDays(generatedDate, 14);
      if (detail.includes("fortnight")) return addDays(generatedDate, 14);
      if (detail.includes("month")) return addDays(generatedDate, 30);
      if (detail.includes("day")) return addDays(generatedDate, 1);
      if (detail.includes("week")) return addDays(generatedDate, 7);
    }
    return "";
  }

  function isStandingOrderDue(order, selectedDate) {
    if (!order.active || !order.expectedDate) return false;
    if (order.lastGeneratedDate === selectedDate) return false;
    return order.expectedDate <= selectedDate;
  }

  async function pgRepairStandingOrderStates() {
    assertPostgresSchemaReady();
    await db().query(`
      update standing_orders so
      set active = true,
          updated_at = now()
      where coalesce(so.deleted, false) = false
        and so.expected_arrival_date is not null
        and so.expected_arrival_date >= current_date
        and (
          so.schedule <> 'One Time'
          or not exists (
            select 1
            from standing_order_runs sor
            where sor.standing_order_id = so.id
              and sor.expected_delivery_date = so.expected_arrival_date
              and sor.status = 'Closed'
          )
        )
    `);
    await db().query(`
      update standing_orders so
      set active = false,
          updated_at = now()
      where coalesce(so.deleted, false) = false
        and so.schedule = 'One Time'
        and exists (
          select 1
          from standing_order_runs sor
          where sor.standing_order_id = so.id
            and sor.expected_delivery_date = so.expected_arrival_date
            and sor.status = 'Closed'
        )
    `);
    await db().query(`
      update order_requests r
      set requested_by_username = sor.generated_by_username,
          updated_at = now()
      from standing_order_runs sor
      where r.standing_order_run_id = sor.id
        and sor.generated_by_username is not null
        and sor.generated_by_username <> ''
        and lower(coalesce(r.requested_by_username, '')) like 'standing order - %'
    `);
  }

  async function pgListStandingOrders(options = {}) {
    const activeOnly = Boolean(options.activeOnly);
    await pgRepairStandingOrderStates();
    const result = await db().query(`
      select
        so.id,
        so.name,
        so.expected_date,
        so.schedule,
        so.other_schedule,
        so.active,
        so.display_active,
        so.status_label,
        so.last_generated_date,
        so.notes,
        so.supplier_name,
        coalesce(
          json_agg(
            json_build_object(
              'itemId', i.id,
              'itemName', i.name,
              'quantity', soi.quantity
            )
            order by i.name
          ) filter (where soi.id is not null),
          '[]'::json
        ) as items
      from standing_order_overview_vw so
      left join standing_order_items soi on soi.standing_order_id = so.id
      left join inventory_items i on i.id = soi.inventory_item_id
      where coalesce(so.deleted, false) = false
        and (
          $1::boolean = false
          or (
            coalesce(so.display_active, so.active, false) = true
            and lower(coalesce(so.status_label, '')) not in ('completed', 'inactive')
          )
        )
      group by
        so.id,
        so.name,
        so.expected_date,
        so.schedule,
        so.other_schedule,
        so.active,
        so.display_active,
        so.status_label,
        so.last_generated_date,
        so.notes,
        so.supplier_name
      order by so.expected_date asc nulls last, so.supplier_name asc nulls last, so.name asc
    `, [activeOnly]);
    return result.rows.map(pgStandingOrderFromRow);
  }

  async function pgListDueStandingOrders(selectedDate) {
    const result = await db().query(`
      select
        so.id,
        so.name,
        so.expected_date,
        so.schedule,
        so.other_schedule,
        so.active,
        so.display_active,
        so.status_label,
        so.last_generated_date,
        so.notes,
        so.supplier_name,
        coalesce(
          json_agg(
            json_build_object(
              'itemId', i.id,
              'itemName', i.name,
              'quantity', soi.quantity
            )
            order by i.name
          ) filter (where soi.id is not null),
          '[]'::json
        ) as items
      from standing_order_overview_vw so
      left join standing_order_items soi on soi.standing_order_id = so.id
      left join inventory_items i on i.id = soi.inventory_item_id
      where coalesce(so.deleted, false) = false
        and coalesce(so.display_active, so.active, false) = true
        and nullif(so.expected_date, '') is not null
        and so.expected_date::date <= $1::date
        and coalesce(so.last_generated_date::text, '') <> $1::text
      group by
        so.id,
        so.name,
        so.expected_date,
        so.schedule,
        so.other_schedule,
        so.active,
        so.display_active,
        so.status_label,
        so.last_generated_date,
        so.notes,
        so.supplier_name
      order by so.expected_date asc nulls last, so.supplier_name asc nulls last, so.name asc
    `, [selectedDate]);
    return result.rows.map(pgStandingOrderFromRow);
  }

  async function pgListStandingOrderRuns(limit = 50) {
    const result = await db().query(`
      select
        sor.id,
        so.id as standing_order_id,
        so.name as standing_order_name,
        sp.name as supplier_name,
        sor.expected_delivery_date::text as expected_date,
        so.schedule,
        sor.status,
        sor.generated_at,
        sor.generated_by_username,
        sor.closed_at,
        sor.closed_by_username,
        sor.notes,
        coalesce(
          json_agg(
            json_build_object(
              'id', sorl.id,
              'itemId', i.id,
              'orderRequestId', coalesce(sorl.order_request_id, req.id),
              'itemName', i.name,
              'quantity', sorl.quantity,
              'unit', sorl.unit,
              'supplierName', sorl.supplier_name,
              'shelfCode', sc.code,
              'inventoryArea', ia.name,
              'storageLocation', sl.name,
              'received', sorl.received,
              'receivedAt', sorl.received_at,
              'receivedBy', sorl.received_by_username,
              'status', sorl.status,
              'notes', sorl.notes
            )
            order by i.name
          ) filter (where sorl.id is not null),
          '[]'::json
        ) as lines
      from standing_order_runs sor
      join standing_orders so on so.id = sor.standing_order_id
      left join suppliers sp on sp.id = so.supplier_id
      left join standing_order_run_lines sorl on sorl.standing_order_run_id = sor.id
      left join inventory_items i on i.id = sorl.inventory_item_id
      left join lateral (
        select r.id
        from order_requests r
        where r.id = sorl.order_request_id
           or r.standing_order_run_line_id = sorl.id
        order by case when r.id = sorl.order_request_id then 0 else 1 end, r.requested_at desc nulls last
        limit 1
      ) req on true
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      group by sor.id, so.id, so.name, sp.name, so.schedule
      order by sor.expected_delivery_date desc, sor.generated_at desc
      limit $1
    `, [Math.min(Math.max(Number(limit) || 50, 1), 200)]);

    return result.rows.map((row) => {
      const lines = Array.isArray(row.lines) ? row.lines : [];
      return {
        id: row.id,
        standingOrderId: row.standing_order_id || "",
        standingOrderName: row.standing_order_name || "",
        name: `${row.standing_order_name || row.supplier_name || "Standing Order"} - ${row.expected_date || ""}`,
        supplierName: row.supplier_name || "",
        expectedDate: row.expected_date || "",
        schedule: row.schedule || "",
        status: row.status || "",
        generatedAt: row.generated_at || "",
        generatedBy: row.generated_by_username || "",
        closedAt: row.closed_at || "",
        closedBy: row.closed_by_username || "",
        notes: row.notes || "",
        lines,
        totalLines: lines.length,
        receivedLines: lines.filter((line) => line.received).length,
        openLines: lines.filter((line) => !line.received).length
      };
    });
  }

  async function pgStandingOrderFields(payload) {
    const rawItems = Array.isArray(payload.items) && payload.items.length
      ? payload.items
      : [{
        itemId: payload.itemId,
        itemName: payload.itemName,
        quantity: payload.quantityNeeded || payload.quantity
      }];
    const supplierName = String(payload.supplierName || "").trim();
    const standingName = String(payload.name || payload.standingOrderName || "").trim();
    const expectedDate = String(payload.expectedDate || "").trim();
    const schedule = ["Daily", "Weekly", "One Time", "Other"].includes(payload.schedule) ? payload.schedule : "Weekly";
    const otherSchedule = String(payload.otherSchedule || payload.recurrence || "").trim();
    const active = payload.active !== false;
    const recurring = schedule !== "One Time";

    if (!supplierName) throw new Error("Choose one supplier for this standing order.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw new Error("Choose the expected arrival date.");

    const items = rawItems.map((item) => ({
      itemId: String(item.itemId || "").trim(),
      itemName: String(item.itemName || "").trim(),
      quantity: Number(item.quantityNeeded || item.quantity || 0)
    }));
    if (!items.length) throw new Error("Add at least one inventory item.");
    for (const item of items) {
      if (!isValidId(item.itemId)) throw new Error("Choose valid inventory items.");
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Each standing-order item needs a quantity greater than zero.");
    }

    const supplier = await pgFindOrCreateSupplierByName(supplierName);
    const name = standingName || `${supplierName} - ${schedule} - ${expectedDate}`;
    return {
      name,
      supplierId: supplier?.id || null,
      supplierName,
      expectedDate,
      schedule,
      otherSchedule,
      recurring,
      active,
      notes: String(payload.notes || ""),
      items
    };
  }

  async function pgSaveStandingOrderDefinition(payload, user, recordId = "") {
    if (!user.permissions?.canAddInventoryItems) throw new Error("Only admins and power users can save standing orders.");
    const data = await pgStandingOrderFields(payload);
    const client = await db().connect();
    let createdNew = false;
    const beforeOrders = recordId ? await pgListStandingOrders() : [];
    const before = recordId ? beforeOrders.find((entry) => entry.id === recordId) || null : null;
    try {
      await client.query("begin");

      let orderId = recordId;
      if (recordId) {
        if (!isValidId(recordId)) throw new Error("Invalid standing order.");
        await client.query(`
          update standing_orders
          set name = $2,
              supplier_id = $3,
              expected_arrival_date = $4::date,
              schedule = $5,
              other_schedule = $6,
              recurring = $7,
              active = $8,
              notes = $9,
              deleted = false,
              updated_at = now()
          where id = $1
        `, [recordId, data.name, data.supplierId, data.expectedDate, data.schedule, data.otherSchedule, data.recurring, data.active, data.notes]);
        await client.query(`delete from standing_order_items where standing_order_id = $1`, [recordId]);
      } else {
        createdNew = true;
        const created = await client.query(`
          insert into standing_orders (
            name, supplier_id, expected_arrival_date, schedule, other_schedule, recurring, active, notes
          )
          values ($1, $2, $3::date, $4, $5, $6, $7, $8)
          returning id
        `, [data.name, data.supplierId, data.expectedDate, data.schedule, data.otherSchedule, data.recurring, data.active, data.notes]);
        orderId = created.rows[0].id;
      }

      for (const item of data.items) {
        await client.query(`
          insert into standing_order_items (standing_order_id, inventory_item_id, quantity)
          values ($1, $2, $3)
        `, [orderId, item.itemId, item.quantity]);
      }

      if (!createdNew) {
        const openRuns = await client.query(`
          select sor.id, sor.expected_delivery_date::text as expected_date
          from standing_order_runs sor
          where sor.standing_order_id = $1
            and sor.status = 'Open'
          order by sor.expected_delivery_date
        `, [orderId]);

        for (const run of openRuns.rows) {
          await pgRebuildStandingOrderRunTx(
            client,
            run.id,
            orderId,
            String(run.expected_date || data.expectedDate || "").trim(),
            data,
            user.name || "System"
          );
        }
      }

      await client.query("commit");
      cache.requests.expiresAt = 0;
      const savedOrder = (await pgListStandingOrders()).find((entry) => entry.id === orderId) || { id: orderId, ...data };
      if (data.active !== false && /^\d{4}-\d{2}-\d{2}$/.test(data.expectedDate || "") && data.expectedDate <= todayIso()) {
        await pgGenerateStandingOrdersForDate(data.expectedDate, user.name || "System");
      }
      await pgSyncStandingOrderRunsForOrder(orderId, user.name || "System");
      await pgRecordAuditEntry({
        actionType: createdNew ? "add" : "change",
        entityType: "standing-order",
        entityId: orderId,
        entityName: savedOrder.name || data.name,
        actorUsername: user.name || "",
        reasonCode: createdNew ? "standing-order-create" : "standing-order-update",
        before,
        after: savedOrder
      });
      const notifyUsers = await pgNotificationUsers("new-order", user.name);
      if (notifyUsers.length) {
        await pgCreateNotificationsForUsers(notifyUsers, {
          type: "standing-order",
          title: `${createdNew ? "New" : "Updated"} standing order`,
          body: `${savedOrder.supplierName || data.supplierName} - ${savedOrder.expectedDate || data.expectedDate} - ${(savedOrder.items || data.items || []).length} item(s).`,
          relatedStandingOrderId: orderId,
          url: `/standing-orders.html?orderId=${encodeURIComponent(orderId)}`
        });
      }
      return savedOrder;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgUpdateStandingOrderRecord(recordId, payload, user) {
    return pgSaveStandingOrderDefinition(
      payload,
      user || { permissions: { canAddInventoryItems: true }, name: "System" },
      recordId
    );
  }

  async function pgRebuildStandingOrderRunTx(client, runId, orderId, effectiveDate, data, userName) {
    const currentLinesResult = await client.query(`
      select sorl.id,
             sorl.inventory_item_id,
             sorl.order_request_id,
             sorl.quantity,
             sorl.unit,
             sorl.supplier_name,
             sorl.received,
             sorl.status,
             r.id as resolved_request_id,
             coalesce(r.ordered, false) as ordered,
             coalesce(r.partial_receipt, false) as partial_receipt
      from standing_order_run_lines sorl
      left join order_requests r on r.id = sorl.order_request_id
      where sorl.standing_order_run_id = $1
    `, [runId]);
    const currentLines = currentLinesResult.rows;
    const orderItemMap = new Map((data.items || []).map((item) => [item.itemId, item]));

    for (const line of currentLines) {
      const keepLine = orderItemMap.has(line.inventory_item_id) || Boolean(line.received);
      if (keepLine) continue;
      if (line.order_request_id) {
        await client.query(`delete from order_requests where id = $1`, [line.order_request_id]);
      }
      await client.query(`delete from standing_order_run_lines where id = $1`, [line.id]);
    }

    for (const item of data.items) {
      const existingLines = currentLines.filter((line) => line.inventory_item_id === item.itemId);
      const editableLine = existingLines.find((line) => !line.received && !line.partial_receipt);
      const itemNote = [
        `Standing order: ${data.schedule}.`,
        data.name ? `Standing order name: ${data.name}.` : "",
        data.supplierName ? `Standing supplier: ${data.supplierName}.` : "",
        runId ? `Standing run id: ${runId}.` : "",
        data.otherSchedule ? `Schedule detail: ${data.otherSchedule}.` : "",
        `Expected arrival: ${effectiveDate}.`,
        data.notes
      ].filter(Boolean).join("\n");

      if (editableLine?.resolved_request_id) {
        await client.query(`
          update order_requests
          set quantity_needed = $2,
              notes = $3,
              updated_at = now()
          where id = $1
        `, [editableLine.resolved_request_id, item.quantity, itemNote]);
        await client.query(`
          update standing_order_run_lines
          set quantity = $2,
              supplier_name = $3,
              notes = $4,
              order_request_id = $5,
              status = 'Scheduled'
          where id = $1
        `, [editableLine.id, item.quantity, data.supplierName || "", itemNote, editableLine.resolved_request_id]);
        continue;
      }

      if (existingLines.some((line) => line.received || line.partial_receipt)) {
        continue;
      }

      const requestInsert = await client.query(`
        insert into order_requests (
          inventory_item_id, quantity_needed, urgency_level, status, requested_by_username, requested_at,
          delivered, ordered, to_deliver, delivery_day, notes, standing_order_run_id, order_unit, updated_at
        )
        select
          $1, $2, 'Low', 'Approved', $3, now(),
          false, false, false, null, $4, $5, coalesce(u.name, ''), now()
        from inventory_items i
        left join units_of_measure u on u.id = i.unit_of_measure_id
        where i.id = $1
        returning id
      `, [item.itemId, item.quantity, userName || "System", itemNote, runId]);
      const requestId = requestInsert.rows[0]?.id || "";

      const lineInsert = await client.query(`
        insert into standing_order_run_lines (
          standing_order_run_id, standing_order_id, inventory_item_id, order_request_id,
          quantity, unit, supplier_name, received, status, notes
        )
        select $1, $2, $3, $4, $5, coalesce(u.name, ''), $6, false, 'Scheduled', $7
        from inventory_items i
        left join units_of_measure u on u.id = i.unit_of_measure_id
        where i.id = $3
        returning id
      `, [runId, orderId, item.itemId, requestId, item.quantity, data.supplierName || "", itemNote]);

      if (requestId && lineInsert.rows[0]?.id) {
        await client.query(`
          update order_requests
          set standing_order_run_line_id = $2,
              updated_at = now()
          where id = $1
        `, [requestId, lineInsert.rows[0].id]);
      }
    }

    return true;
  }

  async function pgSyncStandingOrderRunsForDate(selectedDate, userName = "System") {
    const runs = await db().query(`
      select sor.id,
             sor.standing_order_id,
             sor.expected_delivery_date::text as expected_date
      from standing_order_runs sor
      join standing_orders so on so.id = sor.standing_order_id
      where sor.expected_delivery_date = $1::date
        and sor.status = 'Open'
        and coalesce(so.deleted, false) = false
      order by sor.generated_at
    `, [selectedDate]);
    if (!runs.rows.length) return 0;

    const orders = await pgListStandingOrders();
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const client = await db().connect();
    let synced = 0;
    try {
      await client.query("begin");
      for (const run of runs.rows) {
        const order = orderMap.get(run.standing_order_id);
        if (!order) continue;
        const runLines = await client.query(`
          select sorl.inventory_item_id,
                 sorl.quantity,
                 sorl.supplier_name,
                 coalesce(r.partial_receipt, false) as partial_receipt
          from standing_order_run_lines sorl
          left join order_requests r on r.id = sorl.order_request_id
          where sorl.standing_order_run_id = $1
          order by sorl.inventory_item_id
        `, [run.id]);
        if (runLines.rows.some((line) => line.partial_receipt)) {
          continue;
        }
        const orderItemsById = new Map((order.items || []).map((item) => [item.itemId, item]));
        const currentSignature = JSON.stringify(runLines.rows.map((line) => ({
          itemId: line.inventory_item_id,
          quantity: line.partial_receipt
            ? Number(orderItemsById.get(line.inventory_item_id)?.quantity || line.quantity || 0)
            : Number(line.quantity || 0),
          supplierName: String(line.supplier_name || "")
        })));
        const orderSignature = JSON.stringify(
          [...(order.items || [])]
            .map((item) => ({
              itemId: item.itemId,
              quantity: Number(item.quantity || 0),
              supplierName: String(order.supplierName || "")
            }))
            .sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)))
        );
        if (currentSignature === orderSignature) continue;
        const rebuilt = await pgRebuildStandingOrderRunTx(
          client,
          run.id,
          run.standing_order_id,
          run.expected_date || selectedDate,
          order,
          userName
        );
        if (rebuilt) synced += 1;
      }
      await client.query("commit");
      if (synced) cache.requests.expiresAt = 0;
      return synced;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgSyncStandingOrderRunsForOrder(orderId, userName = "System") {
    if (!isValidId(orderId)) return 0;
    const result = await db().query(`
      select expected_delivery_date::text as expected_date
      from standing_order_runs
      where standing_order_id = $1
        and status = 'Open'
      group by expected_delivery_date
      order by expected_delivery_date
    `, [orderId]);
    let synced = 0;
    for (const row of result.rows) {
      if (!row.expected_date) continue;
      synced += await pgSyncStandingOrderRunsForDate(row.expected_date, userName);
    }
    return synced;
  }

  async function pgDeleteStandingOrder(recordId, user) {
    if (!user.permissions?.canAdminUsers) throw new Error("Only admins can delete standing orders.");
    if (!isValidId(recordId)) throw new Error("Invalid standing order.");
    const beforeOrders = await pgListStandingOrders();
    const before = beforeOrders.find((entry) => entry.id === recordId) || null;
    await db().query(`
      update standing_orders
      set deleted = true,
          active = false,
          updated_at = now()
      where id = $1
    `, [recordId]);
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "standing-order",
        entityId: recordId,
        entityName: before.name || before.supplierName || "",
        actorUsername: user.name || "",
        reasonCode: "standing-order-delete",
        before
      });
    }
    return { id: recordId, deleted: true };
  }

  async function pgGenerateStandingOrdersForDate(selectedDate, userName = "System") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate || "")) throw new Error("Choose a valid date.");
    const orders = await pgListDueStandingOrders(selectedDate);
    const generated = [];

    for (const order of orders) {
      const runResult = await db().query(`
        insert into standing_order_runs (
          standing_order_id, expected_delivery_date, status, generated_at, generated_by_username, notes
        )
        values ($1, $2::date, 'Open', now(), $3, $4)
        on conflict do nothing
        returning id
      `, [order.id, selectedDate, userName, order.notes || ""]);

      let runId = runResult.rows[0]?.id || "";
      if (!runId) {
        const existingRun = await db().query(`
          select id
          from standing_order_runs
          where standing_order_id = $1 and expected_delivery_date = $2::date
          limit 1
        `, [order.id, selectedDate]);
        runId = existingRun.rows[0]?.id || "";
      }

      const existingLines = runId
        ? await db().query(`
          select count(*)::int as total
          from standing_order_run_lines
          where standing_order_run_id = $1
        `, [runId])
        : { rows: [{ total: 0 }] };
      if (Number(existingLines.rows[0]?.total || 0) > 0) {
        const nextDate = nextStandingOrderDate(order, selectedDate);
        await db().query(`
          update standing_orders
          set last_generated_date = $2::date,
              expected_arrival_date = $3::date,
              active = $4,
              updated_at = now()
          where id = $1
        `, [order.id, selectedDate, nextDate || selectedDate, order.active]);
        continue;
      }

      for (const line of order.items || []) {
        const itemNote = [
          `Standing order: ${order.schedule}.`,
          order.name ? `Standing order name: ${order.name}.` : "",
          order.supplierName ? `Standing supplier: ${order.supplierName}.` : "",
          runId ? `Standing run id: ${runId}.` : "",
          order.otherSchedule ? `Schedule detail: ${order.otherSchedule}.` : "",
          `Expected arrival: ${selectedDate}.`,
          order.notes
        ].filter(Boolean).join("\n");

        const request = await pgCreateRequest({
          itemId: line.itemId,
          quantityNeeded: line.quantity,
          urgencyLevel: "Low",
          notes: itemNote
        }, userName || "System");

        const lineInsert = await db().query(`
          insert into standing_order_run_lines (
            standing_order_run_id, standing_order_id, inventory_item_id, order_request_id,
            quantity, unit, supplier_name, received, status, notes
          )
          select $1, $2, $3, $4, $5, coalesce(u.name, ''), $6, false, 'Scheduled', $7
          from inventory_items i
          left join units_of_measure u on u.id = i.unit_of_measure_id
          where i.id = $3
          returning id
        `, [runId, order.id, line.itemId, request.id, line.quantity, order.supplierName || "", itemNote]);

        if (lineInsert.rows[0]?.id) {
          await db().query(`
            update order_requests
            set standing_order_run_id = $2, standing_order_run_line_id = $3, updated_at = now()
            where id = $1
          `, [request.id, runId, lineInsert.rows[0].id]);
        }
        generated.push(request);
      }

      const nextDate = nextStandingOrderDate(order, selectedDate);
      await db().query(`
        update standing_orders
        set last_generated_date = $2::date,
            expected_arrival_date = $3::date,
            active = $4,
            updated_at = now()
        where id = $1
      `, [order.id, selectedDate, nextDate || selectedDate, order.active]);
    }

    cache.requests.expiresAt = 0;
    return generated;
  }

  async function pgEnsureStandingOrdersForDate(selectedDate, userName = "System") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate || "")) throw new Error("Choose a valid date.");
    return withStandingOrderSyncLock(selectedDate, async () => {
      const generated = await pgGenerateStandingOrdersForDate(selectedDate, userName);
      const synced = await pgSyncStandingOrderRunsForDate(selectedDate, userName);
      return { date: selectedDate, generated, synced };
    });
  }

  async function pgCloseStandingOrderRunIfCompleteTx(client, runId, userName) {
    if (!isValidId(runId)) return;
    const pending = await client.query(`
      select count(*)::int as open_count
      from standing_order_run_lines
      where standing_order_run_id = $1
        and coalesce(received, false) = false
    `, [runId]);
    if (Number(pending.rows[0]?.open_count || 0) > 0) return;

    await client.query(`
      update standing_order_runs
      set status = 'Closed',
          closed_at = now(),
          closed_by_username = $2
      where id = $1
    `, [runId, userName]);

    const runResult = await client.query(`
      select
        sor.expected_delivery_date::text as expected_date,
        so.id as standing_order_id,
        so.expected_arrival_date::text as current_expected_date,
        so.schedule,
        so.other_schedule,
        so.recurring,
        so.active
      from standing_order_runs sor
      join standing_orders so on so.id = sor.standing_order_id
      where sor.id = $1
      limit 1
    `, [runId]);
    const run = runResult.rows[0];
    if (!run?.standing_order_id) return;

    const currentOrder = {
      id: run.standing_order_id,
      expectedDate: run.current_expected_date || run.expected_date || "",
      schedule: run.schedule || "Weekly",
      otherSchedule: run.other_schedule || "",
      recurring: run.recurring !== false,
      active: run.active !== false
    };
    const nextDate = currentOrder.recurring
      ? nextStandingOrderDate(currentOrder, run.expected_date || currentOrder.expectedDate || todayIso())
      : "";

    await client.query(`
      update standing_orders
      set active = $2,
          last_generated_date = coalesce($3::date, last_generated_date),
          expected_arrival_date = case
            when $4::date is not null then $4::date
            else expected_arrival_date
          end,
          updated_at = now()
      where id = $1
    `, [
      run.standing_order_id,
      currentOrder.recurring ? currentOrder.active : false,
      run.expected_date || null,
      nextDate || null
    ]);
  }

  return {
    pgRepairStandingOrderStates,
    pgListStandingOrders,
    pgListStandingOrderRuns,
    pgStandingOrderFields,
    pgSaveStandingOrderDefinition,
    pgUpdateStandingOrderRecord,
    pgRebuildStandingOrderRunTx,
    pgSyncStandingOrderRunsForDate,
    pgSyncStandingOrderRunsForOrder,
    pgDeleteStandingOrder,
    pgGenerateStandingOrdersForDate,
    pgEnsureStandingOrdersForDate,
    pgCloseStandingOrderRunIfCompleteTx,
    nextStandingOrderDate,
    isStandingOrderDue
  };
}
