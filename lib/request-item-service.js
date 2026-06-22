export function createRequestItemService({
  db,
  hasPostgres,
  airtable,
  cache,
  requestsTableId,
  inventoryTableId,
  allowedUnits,
  listAirtableRecords,
  getSchema,
  getItems,
  getSuppliers,
  getLookups,
  normalizeItem,
  findOrCreateLookupRecord,
  resolveShelfCodeRecord,
  saveStandingOrderDefinition,
  generateStandingOrdersForDate,
  pgListOrderReport,
  pgListDriverSheet,
  pgListReceivingSheet,
  pgAssignDriverToSheet,
  assignLegacyDriverToSheet,
  persistLegacyDriverSheetLines,
  listLegacyDriverSheetLines,
  pgCreateRequest,
  pgCreateRequestsBatch,
  pgUpdateItemSettings,
  pgDeleteInventoryItem,
  pgCreateInventoryItem,
  pgCreateStockCount,
  pgDeliverRequest,
  updateLegacyDriverLine,
  pgUpdateDriverLine,
  deliverLegacyDriverLine,
  pgDeliverDriverLine,
  pgDeleteRequest
}) {
  function normalizeCreatedRequest(record) {
    return {
      id: record.id,
      requestId: record.fields["Request ID"],
      itemId: record.fields["Requested Item"]?.[0] || "",
      quantity: record.fields["Quantity Needed"] ?? null,
      urgency: record.fields["Urgency Level"] || "",
      category: record.fields.Category || "",
      storageLocation: record.fields["Storage Location"] || "",
      inventoryArea: record.fields["Inventory Area"] || "",
      inventorySubgroup: record.fields["Inventory Subgroup"] || "",
      shelfCode: record.fields["Shelf Code"] || "",
      requestedBy: record.fields["Requested By"] || "",
      status: record.fields.Status || "",
      received: Boolean(record.fields.Received),
      receivedAt: record.fields["Received Date/Time"] || "",
      receivedBy: record.fields["Received By"] || "",
      notes: record.fields.Notes || "",
      requestedAt: record.fields["Request Date/Time"] || ""
    };
  }

  function normalizeRequest(record) {
    return {
      id: record.id,
      requestId: record.fields["Request ID"],
      itemId: record.fields["Requested Item"]?.[0] || "",
      quantity: record.fields["Quantity Needed"] ?? null,
      urgency: record.fields["Urgency Level"] || "",
      category: record.fields.Category || "",
      storageLocation: record.fields["Storage Location"] || "",
      inventoryArea: record.fields["Inventory Area"] || "",
      inventorySubgroup: record.fields["Inventory Subgroup"] || "",
      shelfCode: record.fields["Shelf Code"] || "",
      requestedBy: record.fields["Requested By"] || "",
      status: record.fields.Status || "",
      received: Boolean(record.fields.Received),
      receivedAt: record.fields["Received Date/Time"] || "",
      receivedBy: record.fields["Received By"] || "",
      notes: record.fields.Notes || "",
      requestedAt: record.fields["Request Date/Time"] || ""
    };
  }

  function normalizeDriverLine(record) {
    return {
      id: record.id,
      sheetDate: record.fields["Sheet Date"] || "",
      requestRecordId: record.fields["Item Request Record ID"] || "",
      requestId: record.fields["Request ID"] || "",
      itemRecordId: record.fields["Inventory Item Record ID"] || "",
      itemName: record.fields["Item Name"] || "",
      supplierName: record.fields["Supplier Name"] || "",
      supplierContact: record.fields["Supplier Contact"] || "",
      quantity: record.fields.Quantity ?? null,
      unit: record.fields.Unit || "",
      category: record.fields.Category || "",
      inventoryArea: record.fields["Inventory Area"] || "",
      storageLocation: record.fields["Storage Location"] || "",
      inventorySubgroup: record.fields["Inventory Subgroup"] || "",
      shelfCode: record.fields["Shelf Code"] || "",
      ordered: Boolean(record.fields.Ordered),
      toDeliver: Boolean(record.fields["2Deliver"]),
      deliveryDay: record.fields["Delivery Day"] || record.fields["Delivery Date"] || "",
      driverName: record.fields.Driver || "",
      orderedAt: record.fields["Ordered Date/Time"] || "",
      orderedBy: record.fields["Ordered By"] || "",
      received: Boolean(record.fields.Received),
      receivedAt: record.fields["Received Date/Time"] || "",
      receivedBy: record.fields["Received By"] || "",
      requestStatus: record.fields["Request Status"] || "",
      standingRunId: record.fields["Standing Order Run ID"] || "",
      standingRunLineId: record.fields["Standing Order Run Line ID"] || "",
      notes: record.fields.Notes || ""
    };
  }

  function orderCategory(value) {
    return String(value?.category || value?.inventoryArea || "").trim();
  }

  function logicalOrderCompare(a, b) {
    const supplier = String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
    if (supplier) return supplier;
    const category = orderCategory(a).localeCompare(orderCategory(b));
    if (category) return category;
    const shelf = String(a.shelfCode || "").localeCompare(String(b.shelfCode || ""), undefined, { numeric: true });
    if (shelf) return shelf;
    return String(a.itemName || a.name || "").localeCompare(String(b.itemName || b.name || ""));
  }

  async function listRequestsByRecordIds(recordIds) {
    const uniqueIds = [...new Set(recordIds.filter((id) => /^rec[a-zA-Z0-9]+$/.test(id || "")))];
    const records = [];

    for (let index = 0; index < uniqueIds.length; index += 20) {
      const chunk = uniqueIds.slice(index, index + 20);
      const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      records.push(...(await listAirtableRecords(requestsTableId, { filterByFormula: formula })));
    }

    return new Map(records.map((record) => [record.id, normalizeRequest(record)]));
  }

  async function listOrderReport(date) {
    return pgListOrderReport(date);
  }

  async function listDriverSheet(date) {
    return pgListDriverSheet(date);
  }

  async function listReceivingSheet(date) {
    return pgListReceivingSheet(date);
  }

  async function assignDriverToSheet(date, driverName, user) {
    if (hasPostgres()) {
      return pgAssignDriverToSheet(date, driverName, user);
    }
    return assignLegacyDriverToSheet(date, driverName, user, listDriverSheet);
  }

  async function persistDriverSheetLines(tableId, sheetDate, requests) {
    return persistLegacyDriverSheetLines(tableId, sheetDate, requests);
  }

  async function listDriverSheetLines(tableId, sheetDate) {
    return listLegacyDriverSheetLines(tableId, sheetDate);
  }

  function createRequestFields(payload, requestedByOverride = "") {
    const itemId = String(payload.itemId || "");
    const quantity = Number(payload.quantityNeeded || 0);
    const urgency = String(payload.urgencyLevel || "Medium");
    const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
    const notes = String(payload.notes || "");

    if (!itemId) throw new Error("Choose an item.");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
    if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");

    return {
      "Requested Item": [itemId],
      "Quantity Needed": quantity,
      "Urgency Level": urgency,
      "Requested By": requestedBy,
      "Request Date/Time": new Date().toISOString(),
      Status: "Approved",
      Notes: notes
    };
  }

  async function createRequest(payload, requestedByOverride = "") {
    if (hasPostgres()) {
      return pgCreateRequest(payload, requestedByOverride);
    }

    const record = await airtable(requestsTableId, {
      method: "POST",
      body: JSON.stringify({ fields: createRequestFields(payload, requestedByOverride) })
    });

    cache.requests.expiresAt = 0;
    return normalizeCreatedRequest(record);
  }

  async function createRequestsBatch(payload, requestedByOverride = "") {
    if (hasPostgres()) {
      return pgCreateRequestsBatch(payload, requestedByOverride);
    }
    const requestedItems = Array.isArray(payload.requests) ? payload.requests : [];
    if (!requestedItems.length) throw new Error("Select at least one item.");
    if (requestedItems.length > 50) throw new Error("Submit 50 items or fewer at a time.");

    const created = [];
    for (const request of requestedItems) {
      created.push(await createRequest(request, requestedByOverride));
    }

    cache.requests.expiresAt = 0;
    return created;
  }

  async function createStandingOrder(payload, user) {
    const standingOrder = await saveStandingOrderDefinition(payload, user);
    const today = new Date().toISOString().slice(0, 10);
    const generated = standingOrder.expectedDate <= today
      ? await generateStandingOrdersForDate(today, user.name)
      : [];
    return { standingOrder, generated };
  }

  async function updateItemSettings(recordId, payload, actorUsername = "") {
    if (hasPostgres()) {
      return pgUpdateItemSettings(recordId, payload, actorUsername);
    }
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid item record.");
    }

    const minimum = Number(payload.minimumThreshold);
    const unit = String(payload.unit || "").trim().toLowerCase();
    const inventoryArea = String(payload.inventoryArea || "").trim();
    const storageLocation = String(payload.storageLocation || "").trim();
    const category = String(payload.category || "").trim();
    const shelfCode = String(payload.shelfCode || "").trim();
    const supplierId = String(payload.supplierId || "").trim();

    if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Minimum stock must be zero or greater.");
    if (!allowedUnits.has(unit)) throw new Error("Unit must be box, bag, item, or bottle.");

    const unitRecordId = await findOrCreateLookupRecord("unitOfMeasurement", unit);
    const categoryRecordId = await findOrCreateLookupRecord("categories", category);
    const areaRecordId = await findOrCreateLookupRecord("inventoryAreas", inventoryArea);
    const storageLocationRecordId = await findOrCreateLookupRecord("storageLocations", storageLocation);
    const shelfRecordId = await resolveShelfCodeRecord(shelfCode, storageLocation);
    const fields = { "Minimum Threshold": minimum };

    if (unitRecordId) fields["Unit Of Measurement Link"] = [unitRecordId];
    fields["Category Link"] = categoryRecordId ? [categoryRecordId] : [];
    fields["Inventory Area Link"] = areaRecordId ? [areaRecordId] : [];
    fields["Storage Location Link"] = storageLocationRecordId ? [storageLocationRecordId] : [];
    fields["Shelf Code Link"] = shelfRecordId ? [shelfRecordId] : [];
    fields["Supplier/Vendor"] = /^rec[a-zA-Z0-9]+$/.test(supplierId) ? [supplierId] : [];

    const record = await airtable(`${inventoryTableId}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });

    cache.items.expiresAt = 0;
    const suppliers = await getSuppliers();
    const lookups = await getLookups();
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return normalizeItem(record, supplierById, lookups);
  }

  async function deleteInventoryItem(recordId, actorUsername = "") {
    if (hasPostgres()) {
      return pgDeleteInventoryItem(recordId, actorUsername);
    }
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid item record.");
    }
    await airtable(`${inventoryTableId}/${recordId}`, { method: "DELETE" });
    cache.items.expiresAt = 0;
    cache.requests.expiresAt = 0;
    return { ok: true, recordId };
  }

  async function updateItemPrimarySupplier(itemRecordId, supplier) {
    if (!/^rec[a-zA-Z0-9]+$/.test(itemRecordId || "")) {
      throw new Error("This driver line is not linked to an inventory item.");
    }
    if (!supplier?.id) {
      throw new Error("Choose a known supplier before changing the primary supplier.");
    }

    await airtable(`${inventoryTableId}/${itemRecordId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          "Supplier/Vendor": [supplier.id],
          "Last Updated Date": new Date().toISOString()
        }
      })
    });

    cache.items.expiresAt = 0;
  }

  async function createInventoryItem(payload, actorUsername = "") {
    if (hasPostgres()) {
      return pgCreateInventoryItem(payload, actorUsername);
    }
    const itemName = String(payload.itemName || "").trim();
    const category = String(payload.category || "").trim();
    const storageLocation = String(payload.storageLocation || "").trim();
    const inventoryArea = String(payload.inventoryArea || "").trim();
    const shelfCode = String(payload.shelfCode || "TBD").trim();
    const supplierId = String(payload.supplierId || "").trim();
    const unit = String(payload.unit || "item").trim().toLowerCase();
    const currentQuantity = Number(payload.currentQuantity || 0);
    const minimum = Number(payload.minimumThreshold || 0);

    if (!itemName) throw new Error("Item name is required.");
    if (!allowedUnits.has(unit)) throw new Error("Unit must be box, bag, item, or bottle.");
    if (!Number.isFinite(currentQuantity) || currentQuantity < 0) throw new Error("Current stock must be zero or greater.");
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Minimum stock must be zero or greater.");

    const categoryId = await findOrCreateLookupRecord("categories", category);
    const storageLocationId = await findOrCreateLookupRecord("storageLocations", storageLocation);
    const inventoryAreaId = await findOrCreateLookupRecord("inventoryAreas", inventoryArea);
    const shelfId = await resolveShelfCodeRecord(shelfCode, storageLocation);
    const unitId = await findOrCreateLookupRecord("unitOfMeasurement", unit);

    const fields = {
      "Item Name": itemName,
      "Current Quantity": currentQuantity,
      "Minimum Threshold": minimum,
      "Last Updated Date": new Date().toISOString()
    };

    if (categoryId) fields["Category Link"] = [categoryId];
    if (storageLocationId) fields["Storage Location Link"] = [storageLocationId];
    if (inventoryAreaId) fields["Inventory Area Link"] = [inventoryAreaId];
    if (shelfId) fields["Shelf Code Link"] = [shelfId];
    if (unitId) fields["Unit Of Measurement Link"] = [unitId];
    if (/^rec[a-zA-Z0-9]+$/.test(supplierId)) fields["Supplier/Vendor"] = [supplierId];

    const record = await airtable(inventoryTableId, {
      method: "POST",
      body: JSON.stringify({ fields })
    });

    cache.items.expiresAt = 0;
    cache.lookups.expiresAt = 0;
    const suppliers = await getSuppliers();
    const lookups = await getLookups();
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return normalizeItem(record, supplierById, lookups);
  }

  async function createStockCount(payload, userName) {
    if (hasPostgres()) {
      return pgCreateStockCount(payload, userName);
    }
    const schema = await getSchema();
    const tableId = schema.tables.stockCounts;
    if (!tableId) throw new Error("Stock Counts table was not found.");

    const itemId = String(payload.itemId || "");
    const countedQuantity = Number(payload.countedQuantity);
    const notes = String(payload.notes || "");

    if (!/^rec[a-zA-Z0-9]+$/.test(itemId)) throw new Error("Choose an item.");
    if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
      throw new Error("Counted quantity must be zero or greater.");
    }

    const items = await getItems();
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("Item not found.");

    const countedAt = new Date().toISOString();
    const countRecord = await airtable(tableId, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Count Line": `${item.name} - ${countedAt.slice(0, 10)}`,
          "Count Date/Time": countedAt,
          "Inventory Item Record ID": item.id,
          "Item Name": item.name,
          "Counted Quantity": countedQuantity,
          "Previous Quantity": item.quantity || 0,
          Unit: item.unit || "",
          "Inventory Area": item.inventoryArea || undefined,
          "Storage Location": item.storageLocation || undefined,
          "Inventory Subgroup": item.category || "",
          "Shelf Code": item.shelfCode || "",
          "Counted By": userName,
          Notes: notes
        }
      })
    });

    const updatedItem = await airtable(`${inventoryTableId}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          "Current Quantity": countedQuantity,
          "Last Updated Date": countedAt
        }
      })
    });

    cache.items.expiresAt = 0;

    return {
      count: { id: countRecord.id, fields: countRecord.fields },
      item: {
        id: updatedItem.id,
        name: updatedItem.fields["Item Name"] || "",
        quantity: updatedItem.fields["Current Quantity"] ?? null,
        unit: updatedItem.fields["Unit of Measure"] || ""
      }
    };
  }

  async function markRequestReceived(recordId, userName) {
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid request record.");
    }

    const record = await airtable(`${requestsTableId}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          Received: true,
          "Received Date/Time": new Date().toISOString(),
          "Received By": userName,
          Status: "Fulfilled"
        }
      })
    });

    cache.requests.expiresAt = 0;
    return normalizeRequest(record);
  }

  async function deliverRequest(recordId, userName, options = {}) {
    if (hasPostgres()) {
      return pgDeliverRequest(recordId, userName, options);
    }
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid request record.");
    }

    const requestRecord = await airtable(`${requestsTableId}/${recordId}`);
    const request = normalizeRequest(requestRecord);
    if (request.received || request.status === "Fulfilled") {
      return request;
    }

    const quantity = Number(request.quantity || 0);
    if (!request.itemId) throw new Error("Request has no linked inventory item.");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Request quantity is not valid.");

    const items = await getItems();
    const item = items.find((candidate) => candidate.id === request.itemId);
    if (!item) throw new Error("Linked inventory item was not found.");

    const currentQuantity = Number(item.quantity || 0);
    const newQuantity = currentQuantity + quantity;
    await createStockCount({
      itemId: item.id,
      countedQuantity: newQuantity,
      notes: `Delivered from order request ${request.requestId || request.id}: added ${quantity} ${item.unit || ""}.`
    }, userName);

    return markRequestReceived(recordId, userName);
  }

  async function updateDriverLine(recordId, payload, userName) {
    if (hasPostgres()) {
      return pgUpdateDriverLine(recordId, payload, userName);
    }
    return updateLegacyDriverLine(recordId, payload, userName);
  }

  async function deliverDriverLine(recordId, requestRecordId, userName, options = {}) {
    if (hasPostgres()) {
      return pgDeliverDriverLine(recordId, requestRecordId, userName, options);
    }
    const result = await deliverLegacyDriverLine(recordId, requestRecordId, userName);
    cache.requests.expiresAt = 0;
    return result;
  }

  async function deleteRequest(recordId, actorUsername = "") {
    if (hasPostgres()) {
      return pgDeleteRequest(recordId, actorUsername);
    }
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid request record.");
    }

    const result = await airtable(`${requestsTableId}/${recordId}`, {
      method: "DELETE"
    });

    cache.requests.expiresAt = 0;
    return {
      id: result.id || recordId,
      deleted: Boolean(result.deleted)
    };
  }

  async function canDeleteRequest(recordId, user) {
    if (hasPostgres()) {
      if (user.permissions?.canDeleteAnyOrder) return true;
      const result = await db().query(`select requested_by_username from order_requests where id = $1`, [recordId]);
      const requestedBy = String(result.rows[0]?.requested_by_username || "").trim().toLowerCase();
      return requestedBy && requestedBy === String(user.name || "").trim().toLowerCase();
    }
    if (user.permissions?.canDeleteAnyOrder) return true;
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) return false;
    const record = await airtable(`${requestsTableId}/${recordId}`);
    const requestedBy = String(record.fields?.["Requested By"] || "").trim().toLowerCase();
    return requestedBy && requestedBy === String(user.name || "").trim().toLowerCase();
  }

  return {
    normalizeCreatedRequest,
    normalizeRequest,
    normalizeDriverLine,
    orderCategory,
    logicalOrderCompare,
    listRequestsByRecordIds,
    listOrderReport,
    listDriverSheet,
    listReceivingSheet,
    assignDriverToSheet,
    persistDriverSheetLines,
    listDriverSheetLines,
    createRequest,
    createRequestsBatch,
    createStandingOrder,
    updateItemSettings,
    deleteInventoryItem,
    updateItemPrimarySupplier,
    createInventoryItem,
    createStockCount,
    markRequestReceived,
    deliverRequest,
    updateDriverLine,
    deliverDriverLine,
    deleteRequest,
    canDeleteRequest
  };
}
