export function createInternalOrderDomain({
  assertPostgresSchemaReady,
  db,
  cache,
  isValidId,
  normalizeRole,
  presentUserName,
  todayIso,
  getAppUsers,
  pgCreateNotificationsForUsers,
  pgRecordAuditEntry,
  pgEnsureDriverSheetLines
}) {
  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function internalOrderStockUnitsFromItems(quantityItems) {
    const numeric = Number(quantityItems || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric / 12;
  }

  function normalizePositiveQuantity(value, decimals = 2) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    const factor = 10 ** decimals;
    return Math.round(numeric * factor) / factor;
  }

  function pgInternalOrderLineFromRow(row) {
    return {
      id: row.id,
      batchId: row.internal_order_batch_id || "",
      itemId: row.inventory_item_id || "",
      itemName: row.item_name || "",
      category: row.category || "",
      inventoryArea: row.inventory_area || "",
      storageLocation: row.storage_location || "",
      shelfCode: row.shelf_code || "",
      unit: row.unit || "",
      currentStock: Number(row.current_quantity || 0),
      currentStockItems: Math.floor((Number(row.current_quantity || 0) || 0) * 12),
      minimumThreshold: Number(row.minimum_threshold || 0) || 0,
      requestedItemQuantity: Number(row.requested_item_quantity || 0) || 0,
      pickedItemQuantity: Number(row.picked_item_quantity || 0) || 0,
      shortageItemQuantity: Number(row.shortage_item_quantity || 0) || 0,
      shortageRequestId: row.shortage_request_id || "",
      autoMinRequestId: row.auto_min_request_id || "",
      status: row.status || "requested",
      notes: row.notes || ""
    };
  }

  function mapInternalOrderBatch(rows = []) {
    if (!rows.length) return null;
    const first = rows[0];
    return {
      id: first.batch_id,
      requestedBy: first.requested_by_username || "",
      requestedAt: first.requested_at || "",
      status: first.batch_status || "open",
      notes: first.batch_notes || "",
      pickerUsername: first.picker_username || "",
      readyAt: first.ready_at || "",
      readyBy: first.ready_by_username || "",
      closedAt: first.closed_at || "",
      closedBy: first.closed_by_username || "",
      lines: rows.filter((row) => row.id).map(pgInternalOrderLineFromRow)
        .sort((left, right) => String(left.itemName || "").localeCompare(String(right.itemName || ""), undefined, { sensitivity: "base", numeric: true }))
    };
  }

  async function pgListInternalOrders(user) {
    assertPostgresSchemaReady();
    const role = normalizeRole(user?.role);
    const values = [];
    let whereSql = `where b.batch_status in ('open', 'ready', 'partial')`;
    if (role === "staff") {
      values.push(String(user?.name || "").trim());
      whereSql += ` and lower(b.requested_by_username) = lower($${values.length})`;
    }
    const result = await db().query(`
      select *
      from internal_order_details_vw b
      ${whereSql}
      order by b.requested_at desc nulls last, lower(b.requested_by_username), b.category nulls last, b.item_name
    `, values);
    const grouped = new Map();
    for (const row of result.rows) {
      const key = row.batch_id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return [...grouped.values()].map(mapInternalOrderBatch);
  }

  async function pgCreateInternalOrder(payload, userName) {
    assertPostgresSchemaReady();
    const requestedBy = String(userName || payload.requestedBy || "").trim();
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
    const lines = rawLines
      .map((line) => ({
        itemId: String(line?.itemId || "").trim(),
        quantityItems: Number(line?.quantityItems || 0)
      }))
      .filter((line) => isValidId(line.itemId) && Number.isFinite(line.quantityItems) && line.quantityItems > 0);
    if (!requestedBy) throw new Error("User name is required.");
    if (!lines.length) throw new Error("Add at least one internal item.");

    const client = await db().connect();
    try {
      await client.query("begin");
      const userResult = await client.query(`select id from app_users where lower(username) = lower($1) or lower(display_name) = lower($1) limit 1`, [requestedBy]);
      const userId = userResult.rows[0]?.id || null;
      const batchResult = await client.query(`
        insert into internal_order_batches (
          requested_by_user_id, requested_by_username, status, notes
        )
        values ($1, $2, 'open', $3)
        returning id
      `, [userId, requestedBy, String(payload.notes || "").trim()]);
      const batchId = batchResult.rows[0]?.id || "";
      for (const line of lines) {
        await client.query(`
          insert into internal_order_lines (
            internal_order_batch_id, inventory_item_id, requested_item_quantity, status
          )
          values ($1, $2, $3, 'requested')
        `, [batchId, line.itemId, line.quantityItems]);
      }
      await client.query("commit");
      const orders = await pgListInternalOrders({ name: requestedBy, role: "staff" });
      const saved = orders.find((entry) => entry.id === batchId) || null;
      const notifyUsers = await getAppUsers();
      const pickerUsers = notifyUsers
        .filter((entry) => entry.active !== false && Boolean(entry.isPicker))
        .map((entry) => entry.name)
        .filter(Boolean);
      if (pickerUsers.length) {
        const lineNames = saved?.lines?.slice(0, 4).map((line) => line.itemName).filter(Boolean) || [];
        const remainder = (saved?.lines?.length || 0) > lineNames.length ? ` and ${(saved.lines.length - lineNames.length)} more` : "";
        await pgCreateNotificationsForUsers(pickerUsers, {
          type: "internal-order",
          title: `Internal order by ${presentUserName(requestedBy)}`,
          body: `${saved?.lines?.length || lines.length} item(s): ${lineNames.join(", ")}${remainder}.`,
          url: "/picker-sheet.html"
        });
      }
      await pgRecordAuditEntry({
        actionType: "add",
        entityType: "internal-order",
        entityId: batchId,
        entityName: `Internal order ${requestedBy}`,
        actorUsername: requestedBy,
        reasonCode: "internal-order-create",
        after: saved
      });
      return saved;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgRefreshInternalOrderBatchStatusTx(client, batchId, userName = "") {
    const result = await client.query(`
      select
        count(*)::int as total,
        count(*) filter (where status = 'ready')::int as ready_count,
        count(*) filter (where status = 'partial')::int as partial_count,
        count(*) filter (where status = 'requested')::int as requested_count
      from internal_order_lines
      where internal_order_batch_id = $1
    `, [batchId]);
    const row = result.rows[0] || {};
    const total = Number(row.total || 0);
    const readyCount = Number(row.ready_count || 0);
    const partialCount = Number(row.partial_count || 0);
    const requestedCount = Number(row.requested_count || 0);
    let status = "open";
    if (total === 0) status = "closed";
    else if (readyCount === total) status = "ready";
    else if (partialCount > 0 || (readyCount > 0 && requestedCount > 0)) status = "partial";
    else status = "open";
    await client.query(`
      update internal_order_batches
      set status = $2,
          ready_at = case when $2 = 'ready' then now() else ready_at end,
          ready_by_username = case when $2 = 'ready' then $3 else ready_by_username end,
          updated_at = now()
      where id = $1
    `, [batchId, status, String(userName || "").trim()]);
    return status;
  }

  async function pgUpsertAutoMinimumRequestTx(client, line, batch, batchId) {
    const currentQuantity = Number(line.current_quantity || 0);
    const minimumThreshold = Number(line.minimum_threshold || 0);
    const quantityNeeded = normalizePositiveQuantity(minimumThreshold - currentQuantity, 2);
    const autoNote = `Automatic minimum restock after internal pick for ${batch.requested_by_username}. Batch ${batchId}.`;
    const requestedBy = "Auto Minimum";
    const linkedRequestId = line.auto_min_request_id || null;

    if (quantityNeeded <= 0) {
      const existingAuto = await client.query(`
        select id
        from order_requests
        where inventory_item_id = $1
          and delivered = false
          and lower(requested_by_username) = lower($2)
          and status in ('Pending', 'Approved')
        order by case when id = $3 then 0 else 1 end,
                 updated_at desc nulls last,
                 requested_at desc nulls last
        limit 1
      `, [line.inventory_item_id, requestedBy, linkedRequestId]);
      const removableId = existingAuto.rows[0]?.id || linkedRequestId;
      if (removableId) {
        await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [removableId]);
        await client.query(`delete from order_requests where id = $1`, [removableId]);
      }
      return null;
    }

    const requestUnit = String(line.unit || "").trim() || "item";
    const existingAuto = await client.query(`
      select id
      from order_requests
      where inventory_item_id = $1
        and delivered = false
        and lower(requested_by_username) = lower($2)
        and status in ('Pending', 'Approved')
      order by case when id = $3 then 0 else 1 end,
               updated_at desc nulls last,
               requested_at desc nulls last
      limit 1
    `, [line.inventory_item_id, requestedBy, linkedRequestId]);
    const requestId = existingAuto.rows[0]?.id || null;

    if (requestId) {
      await client.query(`
        update order_requests
        set quantity_needed = $2,
            order_unit = $3,
            urgency_level = 'High',
            status = 'Approved',
            delivered = false,
            delivered_at = null,
            delivered_by_username = '',
            notes = $4,
            updated_at = now()
        where id = $1
      `, [requestId, quantityNeeded, requestUnit, autoNote]);
      return requestId;
    }

    const inserted = await client.query(`
      insert into order_requests (
        inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
      )
      values ($1, $2, $3, 'High', 'Approved', $4, now(), $5)
      returning id
    `, [line.inventory_item_id, quantityNeeded, requestUnit, requestedBy, autoNote]);
    return inserted.rows[0]?.id || null;
  }

  async function pgUpdateInternalOrderPicking(batchId, payload, userName) {
    assertPostgresSchemaReady();
    if (!isValidId(batchId)) throw new Error("Invalid internal order.");
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
    if (!rawLines.length) throw new Error("No picking lines were provided.");
    const client = await db().connect();
    try {
      await client.query("begin");
      const batchResult = await client.query(`
        select id, requested_by_username, status
        from internal_order_batches
        where id = $1
        for update
      `, [batchId]);
      const batch = batchResult.rows[0];
      if (!batch) throw new Error("Internal order was not found.");

      for (const rawLine of rawLines) {
        const lineId = String(rawLine?.lineId || "").trim();
        if (!isValidId(lineId)) continue;
        const pickedItemQuantity = Math.max(0, Number(rawLine?.pickedItemQuantity || 0));
        if (!Number.isFinite(pickedItemQuantity)) continue;
        const lineResult = await client.query(`
          select
            l.id,
            l.internal_order_batch_id,
            l.inventory_item_id,
            l.requested_item_quantity,
            l.picked_item_quantity,
            l.shortage_request_id,
            l.auto_min_request_id,
            i.current_quantity,
            i.minimum_threshold,
            i.name as item_name,
            ia.name as inventory_area,
            u.name as unit
          from internal_order_lines l
          join inventory_items i on i.id = l.inventory_item_id
          left join inventory_areas ia on ia.id = i.inventory_area_id
          left join units_of_measure u on u.id = i.unit_of_measure_id
          where l.id = $1 and l.internal_order_batch_id = $2
          for update of l, i
        `, [lineId, batchId]);
        const line = lineResult.rows[0];
        if (!line) continue;
        const requestedItemQuantity = Number(line.requested_item_quantity || 0);
        const previousPickedItemQuantity = Number(line.picked_item_quantity || 0);

        if (rawLine?.removeRequested) {
          const restoreUnits = internalOrderStockUnitsFromItems(previousPickedItemQuantity);
          const currentQuantityAfterRestore = Number(line.current_quantity || 0) + restoreUnits;
          if (restoreUnits > 0) {
            await client.query(`
              update inventory_items
              set current_quantity = current_quantity + $2,
                  updated_at = now()
              where id = $1
            `, [line.inventory_item_id, restoreUnits]);
          }
          if (line.shortage_request_id) {
            await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [line.shortage_request_id]);
            await client.query(`delete from order_requests where id = $1`, [line.shortage_request_id]);
          }
          await pgUpsertAutoMinimumRequestTx(client, {
            ...line,
            current_quantity: currentQuantityAfterRestore
          }, batch, batchId);
          await client.query(`delete from internal_order_lines where id = $1`, [lineId]);
          continue;
        }

        const safePicked = Math.min(requestedItemQuantity, pickedItemQuantity);
        const shortageItemQuantity = Math.max(0, requestedItemQuantity - safePicked);
        const pickedStatus = shortageItemQuantity > 0 ? "partial" : "ready";
        const stockDeltaItems = safePicked - previousPickedItemQuantity;
        const currentQuantityAfterPick = Number(line.current_quantity || 0) - internalOrderStockUnitsFromItems(stockDeltaItems);

        if (stockDeltaItems !== 0) {
          await client.query(`
            update inventory_items
            set current_quantity = greatest(0, current_quantity - $2),
                updated_at = now()
            where id = $1
          `, [line.inventory_item_id, internalOrderStockUnitsFromItems(stockDeltaItems)]);
        }

        let shortageRequestId = line.shortage_request_id || null;
        let autoMinRequestId = line.auto_min_request_id || null;
        if (shortageItemQuantity > 0) {
          const existingShortageResult = await client.query(`
            select id
            from order_requests
            where id = $1
          `, [shortageRequestId || null]);
          if (existingShortageResult.rows[0]?.id) {
            await client.query(`
              update order_requests
              set quantity_needed = $2,
                  order_unit = 'item',
                  status = 'Approved',
                  delivered = false,
                  updated_at = now(),
                  notes = $3
              where id = $1
            `, [
              shortageRequestId,
              shortageItemQuantity,
              `Internal order shortage for ${batch.requested_by_username}. Batch ${batchId}.`
            ]);
          } else {
            const shortageInsert = await client.query(`
              insert into order_requests (
                inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
              )
              values ($1, $2, 'item', 'High', 'Approved', $3, now(), $4)
              returning id
            `, [
              line.inventory_item_id,
              shortageItemQuantity,
              batch.requested_by_username,
              `Internal order shortage for ${batch.requested_by_username}. Batch ${batchId}.`
            ]);
            shortageRequestId = shortageInsert.rows[0]?.id || null;
          }
        } else if (shortageRequestId) {
          await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [shortageRequestId]);
          await client.query(`delete from order_requests where id = $1`, [shortageRequestId]);
          shortageRequestId = null;
        }

        autoMinRequestId = await pgUpsertAutoMinimumRequestTx(client, {
          ...line,
          auto_min_request_id: autoMinRequestId,
          current_quantity: currentQuantityAfterPick
        }, batch, batchId);

        await client.query(`
          update internal_order_lines
          set picked_item_quantity = $2,
              shortage_item_quantity = $3,
              shortage_request_id = $4,
              auto_min_request_id = $5,
              status = $6,
              notes = $7,
              updated_at = now()
          where id = $1
        `, [
          lineId,
          safePicked,
          shortageItemQuantity,
          shortageRequestId,
          autoMinRequestId,
          pickedStatus,
          String(rawLine?.notes || "").trim()
        ]);
      }

      const status = await pgRefreshInternalOrderBatchStatusTx(client, batchId, userName);
      await client.query(`
        update internal_order_batches
        set picker_username = $2,
            updated_at = now()
        where id = $1
      `, [batchId, String(userName || "").trim()]);

      await client.query("commit");
      cache.items.expiresAt = 0;
      cache.requests.expiresAt = 0;
      await pgEnsureDriverSheetLines(todayIso());

      const batches = await pgListInternalOrders({ name: userName, role: "power-user" });
      const saved = batches.find((entry) => entry.id === batchId) || null;
      if (saved?.status === "ready") {
        await pgCreateNotificationsForUsers([batch.requested_by_username], {
          type: "internal-ready",
          title: "Internal order ready",
          body: "Your internal order is ready in the pickup area.",
          url: "/internal-orders.html"
        });
      }
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "internal-order",
        entityId: batchId,
        entityName: `Internal order ${batch.requested_by_username}`,
        actorUsername: userName,
        reasonCode: "internal-order-pick",
        after: saved || { id: batchId, status }
      });
      return saved || { id: batchId, status };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgUpdateInternalOrderRequest(batchId, payload, user) {
    assertPostgresSchemaReady();
    if (!isValidId(batchId)) throw new Error("Invalid internal order.");
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
    if (!rawLines.length) throw new Error("No internal-order changes were provided.");
    const actorName = String(user?.name || "").trim();
    const actorRole = normalizeRole(user?.role);
    const client = await db().connect();
    try {
      await client.query("begin");
      const batchResult = await client.query(`
        select id, requested_by_username, status
        from internal_order_batches
        where id = $1
        for update
      `, [batchId]);
      const batch = batchResult.rows[0];
      if (!batch) throw new Error("Internal order was not found.");
      const ownsBatch = normalize(batch.requested_by_username) === normalize(actorName);
      const canManageOthers = actorRole === "power-user" || actorRole === "admin" || actorRole === "god";
      if (!ownsBatch && !canManageOthers) {
        throw new Error("You can only change your own internal orders.");
      }

      for (const rawLine of rawLines) {
        const lineId = String(rawLine?.lineId || "").trim();
        if (!isValidId(lineId)) continue;
        const requestedItemQuantity = Math.max(0, Math.round(Number(rawLine?.quantityItems || 0)));
        if (!Number.isFinite(requestedItemQuantity) && !rawLine?.removeRequested) continue;
        const lineResult = await client.query(`
          select
            l.id,
            l.internal_order_batch_id,
            l.inventory_item_id,
            l.requested_item_quantity,
            l.picked_item_quantity,
            l.shortage_request_id,
            l.auto_min_request_id,
            i.current_quantity,
            i.minimum_threshold,
            i.name as item_name,
            u.name as unit
          from internal_order_lines l
          join inventory_items i on i.id = l.inventory_item_id
          left join units_of_measure u on u.id = i.unit_of_measure_id
          where l.id = $1 and l.internal_order_batch_id = $2
          for update of l, i
        `, [lineId, batchId]);
        const line = lineResult.rows[0];
        if (!line) continue;

        const previousPickedItemQuantity = Number(line.picked_item_quantity || 0);

        if (rawLine?.removeRequested || requestedItemQuantity <= 0) {
          const restoreUnits = internalOrderStockUnitsFromItems(previousPickedItemQuantity);
          const currentQuantityAfterRestore = Number(line.current_quantity || 0) + restoreUnits;
          if (restoreUnits > 0) {
            await client.query(`
              update inventory_items
              set current_quantity = current_quantity + $2,
                  updated_at = now()
              where id = $1
            `, [line.inventory_item_id, restoreUnits]);
          }
          if (line.shortage_request_id) {
            await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [line.shortage_request_id]);
            await client.query(`delete from order_requests where id = $1`, [line.shortage_request_id]);
          }
          if (line.auto_min_request_id) {
            await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [line.auto_min_request_id]);
            await client.query(`delete from order_requests where id = $1`, [line.auto_min_request_id]);
          }
          await pgUpsertAutoMinimumRequestTx(client, {
            ...line,
            auto_min_request_id: null,
            current_quantity: currentQuantityAfterRestore
          }, batch, batchId);
          await client.query(`delete from internal_order_lines where id = $1`, [lineId]);
          continue;
        }

        const safePicked = Math.min(previousPickedItemQuantity, requestedItemQuantity);
        const restoreItems = Math.max(0, previousPickedItemQuantity - safePicked);
        const restoreUnits = internalOrderStockUnitsFromItems(restoreItems);
        const currentQuantityAfterEdit = Number(line.current_quantity || 0) + restoreUnits;
        if (restoreUnits > 0) {
          await client.query(`
            update inventory_items
            set current_quantity = current_quantity + $2,
                updated_at = now()
            where id = $1
          `, [line.inventory_item_id, restoreUnits]);
        }

        const shortageItemQuantity = Math.max(0, requestedItemQuantity - safePicked);
        let shortageRequestId = line.shortage_request_id || null;
        let autoMinRequestId = line.auto_min_request_id || null;

        if (shortageItemQuantity > 0) {
          const shortageNote = `Internal order shortage updated for ${batch.requested_by_username}. Batch ${batchId}.`;
          const existingShortageResult = await client.query(`
            select id
            from order_requests
            where id = $1
          `, [shortageRequestId || null]);
          if (existingShortageResult.rows[0]?.id) {
            await client.query(`
              update order_requests
              set quantity_needed = $2,
                  order_unit = 'item',
                  status = 'Approved',
                  delivered = false,
                  updated_at = now(),
                  notes = $3
              where id = $1
            `, [shortageRequestId, shortageItemQuantity, shortageNote]);
          } else {
            const shortageInsert = await client.query(`
              insert into order_requests (
                inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
              )
              values ($1, $2, 'item', 'High', 'Approved', $3, now(), $4)
              returning id
            `, [
              line.inventory_item_id,
              shortageItemQuantity,
              batch.requested_by_username,
              shortageNote
            ]);
            shortageRequestId = shortageInsert.rows[0]?.id || null;
          }
        } else if (shortageRequestId) {
          await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [shortageRequestId]);
          await client.query(`delete from order_requests where id = $1`, [shortageRequestId]);
          shortageRequestId = null;
        }

        autoMinRequestId = await pgUpsertAutoMinimumRequestTx(client, {
          ...line,
          auto_min_request_id: autoMinRequestId,
          current_quantity: currentQuantityAfterEdit
        }, batch, batchId);

        let nextStatus = "requested";
        if (safePicked > 0 && shortageItemQuantity > 0) nextStatus = "partial";
        else if (safePicked > 0 && shortageItemQuantity === 0) nextStatus = "ready";

        await client.query(`
          update internal_order_lines
          set requested_item_quantity = $2,
              picked_item_quantity = $3,
              shortage_item_quantity = $4,
              shortage_request_id = $5,
              auto_min_request_id = $6,
              status = $7,
              updated_at = now()
          where id = $1
        `, [
          lineId,
          requestedItemQuantity,
          safePicked,
          shortageItemQuantity,
          shortageRequestId,
          autoMinRequestId,
          nextStatus
        ]);
      }

      await pgRefreshInternalOrderBatchStatusTx(client, batchId, actorName);
      await client.query("commit");
      cache.items.expiresAt = 0;
      cache.requests.expiresAt = 0;
      const batches = await pgListInternalOrders({ name: ownsBatch ? batch.requested_by_username : actorName, role: ownsBatch ? "staff" : actorRole });
      const saved = batches.find((entry) => entry.id === batchId) || null;
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "internal-order",
        entityId: batchId,
        entityName: `Internal order ${batch.requested_by_username}`,
        actorUsername: actorName || batch.requested_by_username,
        reasonCode: "internal-order-update",
        after: saved
      });
      return saved;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pgListInternalOrders,
    pgCreateInternalOrder,
    pgRefreshInternalOrderBatchStatusTx,
    pgUpsertAutoMinimumRequestTx,
    pgUpdateInternalOrderPicking,
    pgUpdateInternalOrderRequest
  };
}
