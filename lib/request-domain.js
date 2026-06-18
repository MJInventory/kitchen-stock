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
  async function pgListRequests(limit = 20) {
    const result = await db().query(`
      select
        r.id,
        r.request_number,
        r.inventory_item_id as item_id,
        r.quantity_needed as quantity,
        r.urgency_level as urgency,
        r.status,
        r.requested_by_username as requested_by,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by_username,
        r.ordered,
        r.ordered_at,
        r.ordered_by_username,
        r.to_deliver,
        r.delivery_day,
        r.notes,
        r.partial_receipt,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        i.name as item_name,
        c.name as category,
        sl.name as storage_location,
        ia.name as inventory_area,
        sc.code as shelf_code,
        coalesce(nullif(r.order_unit, ''), u.name) as unit,
        sp.name as supplier_name,
        sp.contact_information as supplier_contact
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      left join categories c on c.id = i.category_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
      left join suppliers sp on sp.id = i.primary_supplier_id
      order by r.request_number desc
      limit $1
    `, [limit]);
    return result.rows.map(pgRequestFromRow);
  }

  async function pgListOpenRequests() {
    const result = await db().query(`
      select
        r.id,
        r.request_number,
        r.inventory_item_id as item_id,
        r.quantity_needed as quantity,
        r.urgency_level as urgency,
        r.status,
        r.requested_by_username as requested_by,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by_username,
        r.ordered,
        r.ordered_at,
        r.ordered_by_username,
        r.to_deliver,
        r.delivery_day,
        r.notes,
        r.partial_receipt,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        i.name as item_name,
        c.name as category,
        sl.name as storage_location,
        ia.name as inventory_area,
        sc.code as shelf_code,
        coalesce(nullif(r.order_unit, ''), u.name) as unit,
        sp.name as supplier_name,
        sp.contact_information as supplier_contact
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      left join categories c on c.id = i.category_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
      left join suppliers sp on sp.id = i.primary_supplier_id
      where r.delivered = false and r.status in ('Pending', 'Approved')
      order by c.name nulls last, i.name, r.requested_at
    `);
    return result.rows.map(pgRequestFromRow);
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
    if (orderUnit && !allowedUnits.has(orderUnit)) throw new Error("Unit must be box, bag, item, or bottle.");
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
        await client.query("commit");
        const requests = await pgListRequests(200);
        return requests.find((entry) => entry.id === recordId) || { id: recordId };
      }
      const orderedQty = Number(request.quantity_needed || 0);
      const receivedQty = Number(
        options.quantityReceived === undefined || options.quantityReceived === null || options.quantityReceived === ""
          ? orderedQty
          : options.quantityReceived
      );
      if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
        throw new Error("Received quantity must be greater than zero.");
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
        set current_quantity = $2, updated_at = now()
        where id = $1
      `, [request.inventory_item_id, newQty]);

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

        const standingLineUpdate = await client.query(`
          update standing_order_run_lines
          set received = true,
              received_at = now(),
              received_by_username = $2,
              status = 'Received'
          where order_request_id = $1
          returning standing_order_run_id
        `, [recordId, userName]);
        const closeRun = getPgCloseStandingOrderRunIfCompleteTx?.();
        for (const row of standingLineUpdate.rows) {
          if (typeof closeRun === "function") {
            await closeRun(client, row.standing_order_run_id, userName);
          }
        }
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
        if (request.standing_order_run_line_id && isValidId(request.standing_order_run_line_id)) {
          await client.query(`
            update standing_order_run_lines
            set quantity = $2,
                received = false,
                received_at = null,
                received_by_username = '',
                status = 'Scheduled'
            where id = $1
          `, [request.standing_order_run_line_id, remainingQty]);
        }
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
          ? `Order fully received. ${receivedQty} ${request.unit || ""} added to stock.`
          : `Order partially received. ${receivedQty} ${request.unit || ""} added, ${remainingQty} ${request.unit || ""} still open.`,
        before,
        after: latest
      });
      return { ...latest, receivedQuantity: receivedQty, remainingQuantity: remainingQty, fullyDelivered: isFullReceipt };
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

  return {
    pgListRequests,
    pgListOpenRequests,
    pgCreateRequest,
    pgCreateRequestsBatch,
    pgCreateStockCount,
    pgDeliverRequest,
    pgDeleteRequest
  };
}
