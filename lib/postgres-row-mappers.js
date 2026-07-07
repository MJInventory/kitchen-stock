import {
  standingRunIdFromNotes,
  standingRunLineIdFromNotes
} from "./standing-order-helpers.js";

export function createPostgresRowMappers() {
  function pgNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function pgItemFromRow(row) {
    return {
      id: row.id,
      name: row.name || "",
      category: row.category || "",
      categoryId: row.category_id || "",
      storageLocation: row.storage_location || "",
      storageLocationId: row.storage_location_id || "",
      inventoryArea: row.inventory_area || "",
      inventoryAreaId: row.inventory_area_id || "",
      inventorySubgroup: row.category || "",
      inventorySubgroupId: row.category_id || "",
      shelfCode: row.shelf_code || "",
      shelfCodeId: row.shelf_code_id || "",
      supplierId: row.supplier_id || "",
      supplierName: row.resolved_supplier_name || row.supplier_name || "Unassigned Supplier",
      supplierContact: row.resolved_supplier_contact || row.supplier_contact || "",
      quantity: pgNumber(row.quantity),
      unit: row.unit || "",
      minimum: pgNumber(row.minimum),
      unitPrice: pgNumber(row.unit_price)
    };
  }

  function pgRequestFromRow(row) {
    const notes = row.notes || "";
    const standingRunId = row.standing_order_run_id || standingRunIdFromNotes(notes);
    const standingRunLineId = row.standing_order_run_line_id || standingRunLineIdFromNotes(notes);
    const requestedBy = row.requested_by || row.requested_by_username || "";
    const partialReceipt = Boolean(row.partial_receipt);
    let originType = "user";
    if (partialReceipt) originType = "partial";
    else if (standingRunLineId) originType = "standing";
    else if (String(requestedBy || "").trim().toLowerCase() === "auto minimum" || String(notes).toLowerCase().includes("automatic minimum")) originType = "automatic";
    return {
      id: row.id,
      requestId: row.request_number ?? row.request_id ?? null,
      itemId: row.item_id || row.inventory_item_id || "",
      quantity: pgNumber(row.quantity),
      urgency: row.urgency || row.urgency_level || "",
      category: row.category || "",
      storageLocation: row.storage_location || "",
      inventoryArea: row.inventory_area || "",
      inventorySubgroup: row.category || "",
      shelfCode: row.shelf_code || "",
      requestedBy,
      status: row.status || "",
      received: Boolean(row.received ?? row.delivered),
      receivedAt: row.received_at || row.delivered_at || "",
      receivedBy: row.received_by || row.delivered_by || row.delivered_by_username || "",
      requestedAt: row.requested_at || "",
      notes,
      itemName: row.item_name || "",
      unit: row.unit || "",
      unitPrice: pgNumber(row.unit_price),
      supplierName: row.supplier_name || "Unassigned Supplier",
      supplierContact: row.supplier_contact || "",
      driverLineId: row.driver_line_id || "",
      ordered: Boolean(row.ordered),
      orderedAt: row.ordered_at || "",
      orderedBy: row.ordered_by || row.ordered_by_username || "",
      toDeliver: Boolean(row.to_deliver),
      deliveryDay: row.delivery_day || "",
      driverName: row.driver_name || row.driver_username || "",
      delivered: Boolean(row.delivered),
      deliveredAt: row.delivered_at || row.received_at || "",
      deliveredBy: row.delivered_by || row.received_by || "",
      standingRunId: standingRunId || "",
      standingRunLineId: standingRunLineId || "",
      expectedDate: row.expected_date || "",
      isStanding: Boolean(row.is_standing_order),
      isTodayRequest: Boolean(row.is_today_request),
      partialReceipt,
      originType: row.origin_type || originType,
      requestDay: row.request_day || "",
      requestAgeDays: pgNumber(row.request_age_days),
      scheduledDeliveryFuture: Boolean(row.scheduled_delivery_future)
    };
  }

  function pgDriverLineFromRow(row) {
    const notes = row.notes || "";
    const standingRunId = row.standing_order_run_id || standingRunIdFromNotes(notes);
    const standingRunLineId = row.standing_order_run_line_id || standingRunLineIdFromNotes(notes);
    return {
      id: row.id,
      requestRecordId: row.order_request_id || "",
      requestId: row.request_number ?? null,
      itemRecordId: row.inventory_item_id || "",
      itemName: row.item_name || "",
      quantity: pgNumber(row.quantity),
      unit: row.unit || "",
      unitPrice: pgNumber(row.unit_price),
      category: row.category || "",
      inventoryArea: row.inventory_area || "",
      storageLocation: row.storage_location || "",
      shelfCode: row.shelf_code || "",
      supplierName: row.supplier_name || "Unassigned Supplier",
      supplierContact: row.supplier_contact || "",
      ordered: Boolean(row.ordered),
      orderedAt: row.ordered_at || "",
      orderedBy: row.ordered_by_username || "",
      received: Boolean(row.received),
      receivedAt: row.received_at || "",
      receivedBy: row.received_by_username || "",
      toDeliver: Boolean(row.to_deliver),
      deliveryDay: row.delivery_day || "",
      driverName: row.driver_username || "",
      notes,
      standingRunId: standingRunId || "",
      standingRunLineId: standingRunLineId || ""
    };
  }

  function pgStandingOrderFromRow(row) {
    return {
      id: row.id,
      name: row.name || "",
      itemId: row.items?.[0]?.itemId || "",
      itemName: row.items?.[0]?.itemName || "",
      items: Array.isArray(row.items) ? row.items : [],
      supplierName: row.supplier_name || "",
      quantity: row.items?.[0]?.quantity ?? null,
      expectedDate: row.expected_date || "",
      schedule: row.schedule || "Weekly",
      otherSchedule: row.other_schedule || "",
      active: (row.display_active ?? row.active) !== false,
      rawActive: row.active !== false,
      statusLabel: row.status_label || "",
      lastGeneratedDate: row.last_generated_date || "",
      notes: row.notes || ""
    };
  }

  return {
    pgNumber,
    pgItemFromRow,
    pgRequestFromRow,
    pgDriverLineFromRow,
    pgStandingOrderFromRow
  };
}
