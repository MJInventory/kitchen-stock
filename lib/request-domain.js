export function createRequestDomain({
  db,
  cache,
  allowedUnits,
  isValidId,
  pgRequestFromRow,
  pgNumber,
  pgRecordAuditEntry,
  pgAreasForInventoryItemIds,
  pgNotificationUsers,
  pgCreateNotificationsForUsers,
  presentUserName,
  getPgCloseStandingOrderRunIfCompleteTx
}) {
  async function pgFindRequestById(recordId) {
    const result = await db().query(`
      select *
      from order_request_details_vw
      where id = $1
      limit 1
    `, [recordId]);
    return result.rows[0] ? pgRequestFromRow(result.rows[0]) : null;
  }

  async function pgListRequests(limit = 20) {
    const result = await db().query(`
      select *
      from order_request_details_vw
      order by request_number desc
      limit $1
    `, [limit]);
    return result.rows.map(pgRequestFromRow);
  }

  async function pgListOpenRequests() {
    const result = await db().query(`
      select *
      from order_request_supply_vw
      where delivered = false and status in ('Pending', 'Approved')
      order by category nulls last, item_name, requested_at
    `);
    return result.rows.map(pgRequestFromRow);
  }

  async function pgReconcileDeliveredLinksTx(client, recordId, userName, standingOrderRunLineId = null) {
    await client.query(`
      update driver_sheet_lines
      set received = true,
          received_at = coalesce(received_at, now()),
          received_by_username = case
            when coalesce(received_by_username, '') = '' then $2
            else received_by_username
          end,
          updated_at = now()
      where order_request_id = $1
    `, [recordId, userName]);

    const standingLineUpdate = await client.query(`
      update standing_order_run_lines
      set received = true,
          received_at = coalesce(received_at, now()),
          received_by_username = case
            when coalesce(received_by_username, '') = '' then $2
            else received_by_username
          end,
          status = 'Received'
      where order_request_id = $1
         or ($3::uuid is not null and id = $3::uuid)
      returning standing_order_run_id
    `, [recordId, userName, standingOrderRunLineId || null]);

    const closeRun = getPgCloseStandingOrderRunIfCompleteTx?.();
    for (const row of standingLineUpdate.rows) {
      if (typeof closeRun === "function") {
        await closeRun(client, row.standing_order_run_id, userName);
      }
    }
  }

  async function pgCreateRequest(payload, requestedByOverride = "") {
    const itemId = String(payload.itemId || "").trim();
    const quantity = Number(payload.quantityNeeded || 0);
    const urgency = String(payload.urgencyLevel || "Medium");
    const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
    const notes = String(payload.notes || "");
    const orderUnit = String(payload.unitOverride || payload.unit || "").trim().toLowerCase();
    if (!isValidId(itemId)) throw new Error("Choose an item.");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
    if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");
    if (payload.unit !== undefined || payload.unitOverride !== undefined) {
      if (!orderUnit) throw new Error("Unit is required.");
    }
    const client = await db().connect();
    let requestId = "";
    let updatedExisting = false;
    try {
      await client.query("begin");
      const existingResult = await client.query(`
        select id, request_number
        from order_requests
        where inventory_item_id = $1
          and lower(requested_by_username) = lower($2)
          and delivered = false
          and status in ('Pending', 'Approved')
          and standing_order_run_id is null
        order by requested_at desc, request_number desc
        for update
      `, [itemId, requestedBy]);
      const existingRows = existingResult.rows || [];
      const primary = existingRows[0];

      if (primary) {
        updatedExisting = true;
        await client.query(`
          update order_requests
          set quantity_needed = $2,
              urgency_level = $3,
              notes = $4,
              order_unit = $5,
              status = 'Approved',
              updated_at = now()
          where id = $1
        `, [primary.id, quantity, urgency, notes, orderUnit]);
        if (existingRows.length > 1) {
          const duplicateIds = existingRows.slice(1).map((row) => row.id).filter(Boolean);
          if (duplicateIds.length) {
            await client.query(`delete from driver_sheet_lines where order_request_id = any($1::uuid[])`, [duplicateIds]);
            await client.query(`delete from order_requests where id = any($1::uuid[])`, [duplicateIds]);
          }
        }
        requestId = primary.id;
      } else {
        const insertResult = await client.query(`
          insert into order_requests (
            inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
          )
          values ($1, $2, $3, $4, 'Approved', $5, now(), $6)
          returning id
        `, [itemId, quantity, orderUnit, urgency, requestedBy, notes]);
        requestId = insertResult.rows[0]?.id || "";
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    cache.requests.expiresAt = 0;
    const requests = await pgListRequests(200);
    const saved = requests.find((entry) => entry.id === requestId) || { id: requestId };
    await pgRecordAuditEntry({
      actionType: updatedExisting ? "change" : "add",
      entityType: "order-request",
      entityId: saved.id || requestId,
      entityName: saved.itemName || saved.requestId || itemId,
      actorUsername: requestedBy,
      reasonCode: updatedExisting ? "order-update" : "order-create",
      note: updatedExisting ? "Existing open order updated instead of duplicated." : "New order entered.",
      after: saved
    });
    return saved;
  }

  async function pgCreateRequestsBatch(payload, requestedByOverride = "") {
    const requestedItems = (Array.isArray(payload.requests) ? payload.requests : [])
      .filter((request) => isValidId(String(request?.itemId || "").trim()))
      .filter((request) => Number(request?.quantityNeeded || 0) > 0);
    if (!requestedItems.length) throw new Error("Select at least one item.");
    const created = [];
    for (const request of requestedItems) {
      created.push(await pgCreateRequest(request, requestedByOverride));
    }
    const requester = String(requestedByOverride || requestedItems[0]?.requestedBy || "").trim();
    const notifyAreas = await pgAreasForInventoryItemIds(requestedItems.map((request) => request.itemId));
    const notifyUsers = await pgNotificationUsers("new-order", requester, notifyAreas);
    if (notifyUsers.length && created.length) {
      const itemNames = created.slice(0, 4).map((entry) => entry.itemName || "Item").filter(Boolean);
      const remainder = created.length > itemNames.length ? ` and ${created.length - itemNames.length} more` : "";
      await pgCreateNotificationsForUsers(notifyUsers, {
        type: "new-order",
        title: `New order by ${presentUserName(requester || "User")}`,
        body: `${created.length} item(s) entered: ${itemNames.join(", ")}${remainder}.`,
        url: "/"
      });
    }
    return created;
  }

  async function pgUpdateRequest(recordId, payload, actorUsername = "") {
    if (!isValidId(recordId)) throw new Error("Invalid request record.");
    const quantity = Number(payload?.quantityNeeded ?? payload?.quantity ?? 0);
    const urgency = String(payload?.urgencyLevel || payload?.urgency || "Medium");
    const notes = String(payload?.notes || "");
    const orderUnit = String(payload?.unitOverride || payload?.unit || "").trim().toLowerCase();
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
    if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");
    if (!orderUnit) throw new Error("Unit is required.");
    const client = await db().connect();
    try {
      await client.query("begin");
      const existingResult = await client.query(`
        select r.id,
               r.request_number,
               r.inventory_item_id,
               r.requested_by_username,
               r.quantity_needed,
               r.urgency_level,
               r.order_unit,
               r.delivered,
               r.status,
               r.notes,
               r.standing_order_run_id,
               r.standing_order_run_line_id,
               i.name as item_name
        from order_requests r
        join inventory_items i on i.id = r.inventory_item_id
        where r.id = $1
        for update
      `, [recordId]);
      const request = existingResult.rows[0];
      if (!request) throw new Error("Request not found.");
      if (request.delivered || request.status === "Fulfilled") {
        throw new Error("Delivered orders cannot be edited.");
      }
      if (request.standing_order_run_id || request.standing_order_run_line_id) {
        throw new Error("Standing-order lines must be edited from the standing-order screen.");
      }
      await client.query(`
        update order_requests
        set quantity_needed = $2,
            urgency_level = $3,
            order_unit = $4,
            notes = $5,
            status = 'Approved',
            updated_at = now()
        where id = $1
      `, [recordId, quantity, urgency, orderUnit, notes]);
      await client.query("commit");
      cache.requests.expiresAt = 0;
      const latest = await pgFindRequestById(recordId);
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "order-request",
        entityId: recordId,
        entityName: latest?.itemName || request.item_name || "",
        actorUsername,
        reasonCode: "order-update",
        note: "Open order updated from the ordering screen.",
        before: {
          quantityNeeded: Number(request.quantity_needed || 0),
          urgency: request.urgency_level || "Medium",
          unit: request.order_unit || "",
          notes: request.notes || ""
        },
        after: latest
      });
      return latest || { id: recordId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgCreateStockCount(payload, userName) {
    const itemId = String(payload.itemId || "").trim();
    const countedQuantity = Number(payload.countedQuantity);
    const notes = String(payload.notes || "");
    if (!isValidId(itemId)) throw new Error("Choose an item.");
    if (!Number.isFinite(countedQuantity) || countedQuantity < 0) throw new Error("Counted quantity must be zero or greater.");
    const client = await db().connect();
    try {
      await client.query("begin");
      const itemResult = await client.query(`
        select i.id,
               i.name,
               i.current_quantity,
               (
                 select u.name
                 from units_of_measure u
                 where u.id = i.unit_of_measure_id
               ) as unit
        from inventory_items i
        where i.id = $1
        for update
      `, [itemId]);
      const item = itemResult.rows[0];
      if (!item) throw new Error("Item not found.");
      await client.query(`
        insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
        values ($1, $2, $3, $4, now(), $5)
      `, [itemId, countedQuantity, item.current_quantity || 0, userName, notes]);
      const updated = await client.query(`
        update inventory_items
        set current_quantity = $2, updated_at = now()
        where id = $1
        returning id, name, current_quantity, $3::text as unit
      `, [itemId, countedQuantity, item.unit || "item"]);
      await client.query("commit");
      cache.items.expiresAt = 0;
      const saved = {
        count: { id: "", fields: {} },
        item: {
          id: updated.rows[0].id,
          name: updated.rows[0].name,
          quantity: pgNumber(updated.rows[0].current_quantity),
          unit: updated.rows[0].unit || "item"
        }
      };
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "stock-count",
        entityId: itemId,
        entityName: item.name || "",
        actorUsername: userName,
        reasonCode: "stock-count",
        note: notes || "Manual stock count saved.",
        before: { quantity: pgNumber(item.current_quantity || 0), unit: item.unit || "item" },
        after: { quantity: saved.item.quantity, unit: saved.item.unit }
      });
      return saved;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgDeliverRequest(recordId, userName, options = {}) {
    if (!isValidId(recordId)) throw new Error("Invalid request record.");
    const client = await db().connect();
    try {
      await client.query("begin");
      const requestResult = await client.query(`
        select r.id,
               r.request_number,
               r.inventory_item_id,
               r.quantity_needed,
               r.requested_by_username,
               r.delivered,
               r.status,
               r.notes,
               r.standing_order_run_line_id,
               i.name as item_name,
               i.current_quantity,
               (
                 select u.name
                 from units_of_measure u
                 where u.id = i.unit_of_measure_id
               ) as unit
        from order_requests r
        join inventory_items i on i.id = r.inventory_item_id
        where r.id = $1
        for update of r, i
      `, [recordId]);
      const request = requestResult.rows[0];
      if (!request) throw new Error("Request not found.");
      const before = {
        id: request.id,
        itemName: request.item_name || "",
        quantityNeeded: Number(request.quantity_needed || 0),
        requestedBy: request.requested_by_username || "",
        delivered: Boolean(request.delivered),
        status: request.status || "",
        notes: request.notes || "",
        unit: request.unit || ""
      };
      if (request.delivered || request.status === "Fulfilled") {
        await pgReconcileDeliveredLinksTx(client, recordId, userName, request.standing_order_run_line_id);
        await client.query("commit");
        cache.requests.expiresAt = 0;
        const requests = await pgListRequests(200);
        return requests.find((entry) => entry.id === recordId) || { id: recordId, delivered: true };
      }
      const orderedQty = Number(request.quantity_needed || 0);
      const rawReceivedQty = options.quantityReceived ?? options.receivedQuantity ?? options.receiveQuantity ?? options.quantity;
      const rawUnitPrice = options.unitPrice ?? options.receivedUnitPrice ?? options.price;
      const receivedUnitPrice = rawUnitPrice === undefined || rawUnitPrice === null || rawUnitPrice === "" ? null : Number(rawUnitPrice);
      const receivedQty = Number(rawReceivedQty === undefined || rawReceivedQty === null || rawReceivedQty === "" ? orderedQty : rawReceivedQty);
      if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
        throw new Error("Received quantity must be greater than zero.");
      }
      if (receivedUnitPrice !== null && (!Number.isFinite(receivedUnitPrice) || receivedUnitPrice < 0)) {
        throw new Error("Received price must be zero or greater.");
      }
      if (receivedQty > orderedQty) {
        throw new Error("Received quantity cannot be higher than the ordered quantity.");
      }
      const isFullReceipt = receivedQty >= orderedQty;
      const remainingQty = isFullReceipt ? 0 : Math.max(0, orderedQty - receivedQty);
      const newQty = Number(request.current_quantity || 0) + receivedQty;
      await client.query(`
        insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
        values ($1, $2, $3, $4, now(), $5)
      `, [request.inventory_item_id, newQty, request.current_quantity || 0, userName, `${isFullReceipt ? "Delivered" : "Partially delivered"} from order request ${request.request_number}: added ${receivedQty} ${request.unit || ""}.${remainingQty > 0 ? ` Remaining open: ${remainingQty} ${request.unit || ""}.` : ""}`]);
      await client.query(`
        update inventory_items
        set current_quantity = $2,
            unit_price = coalesce($3, unit_price),
            updated_at = now()
        where id = $1
      `, [request.inventory_item_id, newQty, receivedUnitPrice]);

      if (isFullReceipt) {
        await client.query(`
          update order_requests
          set delivered = true,
              delivered_at = now(),
              delivered_by_username = $2,
              partial_receipt = false,
              status = 'Fulfilled',
              updated_at = now()
          where id = $1
        `, [recordId, userName]);
        await client.query(`
          update driver_sheet_lines
          set received = true,
              received_at = now(),
              received_by_username = $2,
              updated_at = now()
          where order_request_id = $1
        `, [recordId, userName]);

        await pgReconcileDeliveredLinksTx(client, recordId, userName, request.standing_order_run_line_id);
      } else {
        await client.query(`
          update order_requests
          set quantity_needed = $2,
              delivered = false,
              delivered_at = null,
              delivered_by_username = '',
              partial_receipt = true,
              status = 'Approved',
              updated_at = now()
          where id = $1
        `, [recordId, remainingQty]);
        await client.query(`
          update driver_sheet_lines
          set received = false,
              received_at = null,
              received_by_username = '',
              updated_at = now()
          where order_request_id = $1
        `, [recordId]);
        await client.query(`
          update standing_order_run_lines
          set quantity = $2,
              received = false,
              received_at = null,
              received_by_username = '',
              status = 'Scheduled'
          where order_request_id = $1
             or ($3::uuid is not null and id = $3::uuid)
        `, [recordId, remainingQty, request.standing_order_run_line_id || null]);
      }
      await client.query("commit");
      cache.items.expiresAt = 0;
      cache.requests.expiresAt = 0;
      const notifyUser = String(request.requested_by_username || "").trim();
      const isStandingReceipt = Boolean(String(request.standing_order_run_line_id || "").trim())
        || /^standing run id:/im.test(String(request.notes || ""))
        || /^standing run line id:/im.test(String(request.notes || ""));
      if (isFullReceipt && notifyUser && !isStandingReceipt) {
        const deliveryUsers = await pgNotificationUsers("delivery");
        const optedIn = deliveryUsers.find((name) => String(name || "").trim().toLowerCase() === notifyUser.toLowerCase());
        if (optedIn) {
          await pgCreateNotificationsForUsers([notifyUser], {
            type: "delivery",
            title: `${request.item_name || "Item"} delivered`,
            body: `${receivedQty} ${request.unit || ""} received and added to stock by ${presentUserName(userName)}.`,
            relatedRequestId: recordId,
            url: "/"
          });
        }
      }
      const requests = await pgListRequests(200);
      const latest = requests.find((entry) => entry.id === recordId) || { id: recordId, delivered: isFullReceipt };
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "order-request",
        entityId: recordId,
        entityName: request.item_name || "",
        actorUsername: userName,
        reasonCode: isFullReceipt ? "delivery-complete" : "delivery-partial",
        note: isFullReceipt
          ? `Order fully received. ${receivedQty} ${request.unit || ""} added to stock.${receivedUnitPrice === null ? "" : ` Price ${receivedUnitPrice.toFixed(2)} saved.`}`
          : `Order partially received. ${receivedQty} ${request.unit || ""} added, ${remainingQty} ${request.unit || ""} still open.${receivedUnitPrice === null ? "" : ` Price ${receivedUnitPrice.toFixed(2)} saved.`}`,
        before,
        after: latest
      });
      return {
        ...latest,
        receivedQuantity: receivedQty,
        remainingQuantity: remainingQty,
        fullyDelivered: isFullReceipt,
        unitPrice: receivedUnitPrice ?? latest?.unitPrice ?? null
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgDeleteRequest(recordId, actorUsername = "") {
    const requests = await pgListRequests(200);
    const before = requests.find((request) => request.id === recordId) || null;
    const result = await db().query(`delete from order_requests where id = $1 returning id`, [recordId]);
    cache.requests.expiresAt = 0;
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "order-request",
        entityId: recordId,
        entityName: before.itemName || before.requestId || "",
        actorUsername,
        reasonCode: "order-delete",
        before
      });
    }
    return { id: result.rows[0]?.id || recordId, deleted: Boolean(result.rowCount) };
  }

  async function pgFindStandingOrderRunLine(recordId) {
    if (!isValidId(recordId)) throw new Error("Invalid standing-order line.");
    const result = await db().query(`
      select
        sorl.id,
        sorl.standing_order_run_id,
        sorl.inventory_item_id,
        sorl.order_request_id,
        sorl.quantity,
        sorl.received,
        sorl.status,
        sorl.unit,
        i.name as item_name,
        i.current_quantity,
        coalesce(r.id, sorl.order_request_id) as resolved_request_id
      from standing_order_run_lines sorl
      join inventory_items i on i.id = sorl.inventory_item_id
      left join order_requests r
        on r.id = sorl.order_request_id
        or r.standing_order_run_line_id = sorl.id
      where sorl.id = $1
      order by case when r.id = sorl.order_request_id then 0 else 1 end
      limit 1
    `, [recordId]);
    return result.rows[0] || null;
  }

  async function pgDeliverStandingOrderRunLine(recordId, userName, options = {}) {
    const line = await pgFindStandingOrderRunLine(recordId);
    if (!line) throw new Error("Standing-order line not found.");
    if (line.received || line.status === "Received") {
      return { id: recordId, delivered: true, fullyDelivered: true };
    }

    const orderedQty = Number(line.quantity || 0);
    const rawReceivedQty = options.quantityReceived ?? options.receivedQuantity ?? options.receiveQuantity ?? options.quantity;
    const rawUnitPrice = options.unitPrice ?? options.receivedUnitPrice ?? options.price;
    const receivedUnitPrice = rawUnitPrice === undefined || rawUnitPrice === null || rawUnitPrice === "" ? null : Number(rawUnitPrice);
    const receivedQty = Number(rawReceivedQty === undefined || rawReceivedQty === null || rawReceivedQty === "" ? orderedQty : rawReceivedQty);
    if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
      throw new Error("Received quantity must be greater than zero.");
    }
    if (receivedUnitPrice !== null && (!Number.isFinite(receivedUnitPrice) || receivedUnitPrice < 0)) {
      throw new Error("Received price must be zero or greater.");
    }
    if (receivedQty > orderedQty) {
      throw new Error("Received quantity cannot be higher than the ordered quantity.");
    }

    const requestId = String(line.resolved_request_id || "").trim();
    const isFullReceipt = receivedQty >= orderedQty;
    const remainingQty = isFullReceipt ? 0 : Math.max(0, orderedQty - receivedQty);
    const previousQuantity = Number(line.current_quantity || 0);
    const nextQuantity = previousQuantity + receivedQty;
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query(`
        insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
        values ($1, $2, $3, $4, now(), $5)
      `, [
        line.inventory_item_id,
        nextQuantity,
        previousQuantity,
        userName,
        `${isFullReceipt ? "Delivered" : "Partially delivered"} from standing order run line ${recordId}: added ${receivedQty} ${line.unit || ""}.${remainingQty > 0 ? ` Remaining open: ${remainingQty} ${line.unit || ""}.` : ""}`
      ]);
      await client.query(`
        update inventory_items
        set current_quantity = $2,
            unit_price = coalesce($3, unit_price),
            updated_at = now()
        where id = $1
      `, [line.inventory_item_id, nextQuantity, receivedUnitPrice]);

      if (isFullReceipt) {
        await client.query(`
          update standing_order_run_lines
          set received = true,
              received_at = now(),
              received_by_username = $2,
              status = 'Received'
          where id = $1
        `, [recordId, userName]);
        if (requestId) {
          await client.query(`
            update order_requests
            set delivered = true,
                delivered_at = now(),
                delivered_by_username = $2,
                partial_receipt = false,
                status = 'Fulfilled',
                updated_at = now()
            where id = $1
          `, [requestId, userName]);
          await pgReconcileDeliveredLinksTx(client, requestId, userName, recordId);
        } else {
          const closeRun = getPgCloseStandingOrderRunIfCompleteTx?.();
          if (typeof closeRun === "function") {
            await closeRun(client, line.standing_order_run_id, userName);
          }
        }
      } else {
        await client.query(`
          update standing_order_run_lines
          set quantity = $2,
              received = false,
              received_at = null,
              received_by_username = '',
              status = 'Scheduled'
          where id = $1
        `, [recordId, remainingQty]);
        if (requestId) {
          await client.query(`
            update order_requests
            set quantity_needed = $2,
                delivered = false,
                delivered_at = null,
                delivered_by_username = '',
                partial_receipt = true,
                status = 'Approved',
                updated_at = now()
            where id = $1
          `, [requestId, remainingQty]);
          await client.query(`
            update driver_sheet_lines
            set received = false,
                received_at = null,
                received_by_username = '',
                updated_at = now()
            where order_request_id = $1
          `, [requestId]);
        }
      }

      await client.query("commit");
      cache.items.expiresAt = 0;
      cache.requests.expiresAt = 0;
      return {
        id: recordId,
        itemName: line.item_name || "",
        receivedQuantity: receivedQty,
        remainingQuantity: remainingQty,
        fullyDelivered: isFullReceipt,
        unitPrice: receivedUnitPrice
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgUpdateStandingOrderRunLine(recordId, payload, actorUsername = "") {
    const line = await pgFindStandingOrderRunLine(recordId);
    if (!line) throw new Error("Standing-order line not found.");
    if (line.received || line.status === "Received") {
      throw new Error("Received standing-order lines cannot be edited until they are reopened.");
    }
    const quantity = Number(payload?.quantity ?? payload?.openQuantity ?? payload?.receiveQuantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantity must be greater than zero.");
    }
    const requestId = String(line.resolved_request_id || "").trim();
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query(`
        update standing_order_run_lines
        set quantity = $2,
            received = false,
            received_at = null,
            received_by_username = '',
            status = 'Scheduled'
        where id = $1
      `, [recordId, quantity]);
      if (requestId) {
        await client.query(`
          update order_requests
          set quantity_needed = $2,
              delivered = false,
              delivered_at = null,
              delivered_by_username = '',
              partial_receipt = false,
              status = 'Approved',
              updated_at = now()
          where id = $1
        `, [requestId, quantity]);
        await client.query(`
          update driver_sheet_lines
          set received = false,
              received_at = null,
              received_by_username = '',
              updated_at = now()
          where order_request_id = $1
        `, [requestId]);
      }
      await client.query(`
        update standing_order_runs
        set status = 'Open',
            closed_at = null,
            closed_by_username = ''
        where id = $1
      `, [line.standing_order_run_id]);
      await client.query("commit");
      cache.requests.expiresAt = 0;
      return {
        id: recordId,
        quantity,
        itemName: line.item_name || ""
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgUndoDeliveredStandingOrderRunLine(recordId, actorUsername = "") {
    const line = await pgFindStandingOrderRunLine(recordId);
    if (!line) throw new Error("Standing-order line not found.");
    const requestId = String(line.resolved_request_id || "").trim();
    if (requestId && isValidId(requestId)) {
      return pgUndoDeliveredRequest(requestId, actorUsername);
    }
    if (!Boolean(line.received) && String(line.status || "").trim().toLowerCase() !== "received") {
      throw new Error("This standing-order line is not marked as delivered.");
    }
    const quantity = Number(line.quantity || 0);
    const currentQuantity = Number(line.current_quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Nothing to reopen for this standing-order line.");
    }
    if (currentQuantity < quantity) {
      throw new Error("Cannot undo delivery because current stock is already below the delivered quantity.");
    }
    const nextQuantity = currentQuantity - quantity;
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query(`
        insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
        values ($1, $2, $3, $4, now(), $5)
      `, [
        line.inventory_item_id,
        nextQuantity,
        currentQuantity,
        actorUsername,
        `Undo delivery for standing order run line ${recordId}: removed ${quantity} ${line.unit || ""} from stock.`
      ]);
      await client.query(`
        update inventory_items
        set current_quantity = $2, updated_at = now()
        where id = $1
      `, [line.inventory_item_id, nextQuantity]);
      await client.query(`
        update standing_order_run_lines
        set received = false,
            received_at = null,
            received_by_username = '',
            status = 'Scheduled'
        where id = $1
      `, [recordId]);
      await client.query(`
        update standing_order_runs
        set status = 'Open',
            closed_at = null,
            closed_by_username = ''
        where id = $1
      `, [line.standing_order_run_id]);
      await client.query("commit");
      cache.items.expiresAt = 0;
      cache.requests.expiresAt = 0;
      return { id: recordId, reopened: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgDeleteStandingOrderRunLine(recordId, actorUsername = "") {
    const line = await pgFindStandingOrderRunLine(recordId);
    if (!line) throw new Error("Standing-order line not found.");
    const client = await db().connect();
    try {
      await client.query("begin");
      const requestId = String(line.resolved_request_id || "").trim();
      if (requestId) {
        await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [requestId]);
        await client.query(`delete from order_requests where id = $1`, [requestId]);
      }
      const deleted = await client.query(`
        delete from standing_order_run_lines
        where id = $1
        returning id, standing_order_run_id
      `, [recordId]);
      if (!deleted.rowCount) throw new Error("Standing-order line not found.");
      const closeRun = getPgCloseStandingOrderRunIfCompleteTx?.();
      if (typeof closeRun === "function") {
        await closeRun(client, deleted.rows[0].standing_order_run_id, actorUsername);
      }
      await client.query("commit");
      cache.requests.expiresAt = 0;
      return { id: deleted.rows[0].id, deleted: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgUndoDeliveredRequest(recordId, actorUsername = "") {
    if (!isValidId(recordId)) throw new Error("Invalid request record.");
    const client = await db().connect();
    try {
      await client.query("begin");
      const result = await client.query(`
        select
          r.id,
          r.request_number,
          r.inventory_item_id,
          r.quantity_needed,
          r.requested_by_username,
          r.delivered,
          r.delivered_at,
          r.delivered_by_username,
          r.status,
          r.notes,
          r.ordered,
          r.ordered_at,
          r.ordered_by_username,
          r.to_deliver,
          r.delivery_day,
          r.standing_order_run_id,
          r.standing_order_run_line_id,
          i.name as item_name,
          i.current_quantity,
          (
            select u.name
            from units_of_measure u
            where u.id = i.unit_of_measure_id
          ) as unit
        from order_requests r
        join inventory_items i on i.id = r.inventory_item_id
        where r.id = $1
        for update of r, i
      `, [recordId]);
      const request = result.rows[0];
      if (!request) throw new Error("Request not found.");
      if (!request.delivered && request.status !== "Fulfilled") {
        throw new Error("This order line is not marked as delivered.");
      }
      const quantity = Number(request.quantity_needed || 0);
      const currentQuantity = Number(request.current_quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Nothing to reopen for this order.");
      }
      if (currentQuantity < quantity) {
        throw new Error("Cannot undo delivery because current stock is already below the delivered quantity.");
      }
      const before = {
        id: request.id,
        itemName: request.item_name || "",
        quantityNeeded: quantity,
        requestedBy: request.requested_by_username || "",
        delivered: Boolean(request.delivered),
        status: request.status || "",
        notes: request.notes || "",
        unit: request.unit || ""
      };
      const nextQuantity = currentQuantity - quantity;
      await client.query(`
        insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
        values ($1, $2, $3, $4, now(), $5)
      `, [
        request.inventory_item_id,
        nextQuantity,
        currentQuantity,
        actorUsername,
        `Undo delivery for order ${request.request_number}: removed ${quantity} ${request.unit || ""} from stock.`
      ]);
      await client.query(`
        update inventory_items
        set current_quantity = $2, updated_at = now()
        where id = $1
      `, [request.inventory_item_id, nextQuantity]);
      await client.query(`
        update order_requests
        set delivered = false,
            delivered_at = null,
            delivered_by_username = '',
            partial_receipt = false,
            status = 'Approved',
            updated_at = now()
        where id = $1
      `, [recordId]);
      if (request.standing_order_run_line_id && isValidId(request.standing_order_run_line_id)) {
        await client.query(`
          update standing_order_run_lines
          set received = false,
              received_at = null,
              received_by_username = '',
              status = 'Scheduled'
          where id = $1
        `, [request.standing_order_run_line_id]);
      }
      if (request.standing_order_run_id && isValidId(request.standing_order_run_id)) {
        await client.query(`
          update standing_order_runs
          set status = 'Open',
              closed_at = null,
              closed_by_username = ''
          where id = $1
        `, [request.standing_order_run_id]);
      }
      await client.query(`
        update driver_sheet_lines
        set received = false,
            received_at = null,
            received_by_username = '',
            updated_at = now()
        where order_request_id = $1
      `, [recordId]);
      await client.query("commit");
      cache.items.expiresAt = 0;
      cache.requests.expiresAt = 0;
      const latest = await pgFindRequestById(recordId);
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "order-request",
        entityId: recordId,
        entityName: request.item_name || "",
        actorUsername,
        reasonCode: "delivery-undo",
        note: `Delivery was undone. ${quantity} ${request.unit || ""} removed from stock and the order reopened.`,
        before,
        after: latest
      });
      return latest || { id: recordId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function pgRestoreDeletedRequestFromAudit(auditId, actorUsername = "") {
    const auditRecordId = String(auditId || "").trim();
    if (!isValidId(auditRecordId)) {
      throw new Error("Invalid audit entry.");
    }
    const auditResult = await db().query(`
      select id, action_type, entity_type, before_json
      from audit_log_entries
      where id = $1
      limit 1
    `, [auditRecordId]);
    const auditEntry = auditResult.rows[0];
    if (!auditEntry) throw new Error("Audit entry not found.");
    if (auditEntry.action_type !== "delete" || auditEntry.entity_type !== "order-request") {
      throw new Error("This audit entry cannot be restored.");
    }
    const before = auditEntry.before_json || null;
    if (!before?.itemId) {
      throw new Error("This deleted order does not have enough data to restore.");
    }
    if (!isValidId(String(before.itemId || "").trim())) {
      throw new Error("The original inventory item is no longer available.");
    }
    const client = await db().connect();
    try {
      await client.query("begin");
      const quantity = Number(before.quantity || before.quantityNeeded || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("The deleted order has no valid quantity to restore.");
      }
      const urgency = String(before.urgency || "Medium");
      const requestedBy = String(before.requestedBy || actorUsername || "").trim();
      const notes = String(before.notes || "").trim();
      const unit = String(before.unit || "").trim().toLowerCase();
      if (before.unit !== undefined && !unit) {
        throw new Error("The deleted order has an invalid unit.");
      }
      const requestedAt = String(before.requestedAt || "").trim();
      const requestedAtValue = requestedAt ? new Date(requestedAt) : null;
      const useRequestedAt = requestedAtValue && !Number.isNaN(requestedAtValue.getTime());
      const insertResult = await client.query(`
        insert into order_requests (
          inventory_item_id, quantity_needed, order_unit, urgency_level, status,
          requested_by_username, requested_at, notes, ordered, ordered_at,
          ordered_by_username, to_deliver, delivery_day, delivered, partial_receipt
        )
        values (
          $1, $2, $3, $4, 'Approved',
          $5, ${useRequestedAt ? "$6::timestamptz" : "now()"}, $7, false, null,
          '', $8, $9::date, false, false
        )
        returning id
      `, [
        before.itemId,
        quantity,
        unit,
        urgency,
        requestedBy,
        ...(useRequestedAt ? [requestedAt] : []),
        notes,
        Boolean(before.toDeliver),
        /^\d{4}-\d{2}-\d{2}$/.test(String(before.deliveryDay || "").trim()) ? String(before.deliveryDay).trim() : null
      ]);
      await client.query("commit");
      cache.requests.expiresAt = 0;
      const recordId = insertResult.rows[0]?.id || "";
      const restored = await pgFindRequestById(recordId);
      await pgRecordAuditEntry({
        actionType: "add",
        entityType: "order-request",
        entityId: recordId,
        entityName: restored?.itemName || before.itemName || "",
        actorUsername,
        reasonCode: "order-restore",
        note: `Deleted order restored from audit entry ${auditRecordId}.`,
        before: null,
        after: restored
      });
      return restored || { id: recordId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pgListRequests,
    pgListOpenRequests,
    pgCreateRequest,
    pgCreateRequestsBatch,
    pgUpdateRequest,
    pgCreateStockCount,
    pgDeliverRequest,
    pgDeliverStandingOrderRunLine,
    pgUpdateStandingOrderRunLine,
    pgUndoDeliveredStandingOrderRunLine,
    pgDeleteRequest,
    pgDeleteStandingOrderRunLine,
    pgUndoDeliveredRequest,
    pgRestoreDeletedRequestFromAudit
  };
}
