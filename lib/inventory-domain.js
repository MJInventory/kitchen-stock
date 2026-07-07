export function createInventoryDomain({
  db,
  cache,
  pgItemFromRow,
  allowedUnits,
  isValidId,
  auditChanged,
  pgRecordAuditEntry,
  getSuppliers = async () => [],
  getLookups = async () => ({}),
  listShelfCodesAdmin = async () => []
}) {
  function normalizeUnitPrice(value) {
    if (value === "" || value === null || value === undefined) return 0;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : Number.NaN;
  }

  async function pgListLookup(tableName) {
    const orderBy = tableName === "units_of_measure" ? "name" : "sort_order, name";
    const result = await db().query(`
      select id, name
      from ${tableName}
      where active = true
      order by ${orderBy}
    `);
    const values = result.rows.map((row) => ({ id: row.id, name: row.name || "" })).filter((row) => row.name);
    return {
      records: values,
      byId: new Map(values.map((record) => [record.id, record])),
      byName: new Map(values.map((record) => [record.name.toLowerCase(), record]))
    };
  }

  async function pgListLookups() {
    const [categories, storageLocations, inventoryAreas, units] = await Promise.all([
      pgListLookup("categories"),
      pgListLookup("storage_locations"),
      pgListLookup("inventory_areas"),
      pgListLookup("units_of_measure")
    ]);
    const shelfResult = await db().query(`
      select sc.id, sc.code as name, sl.name as storage_location
      from shelf_codes sc
      left join storage_locations sl on sl.id = sc.storage_location_id
      where sc.active = true
      order by sl.name nulls last, sc.sort_order, sc.code
    `);
    const shelfRecords = shelfResult.rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      storageLocation: row.storage_location || ""
    }));
    return {
      categories,
      storageLocations,
      inventoryAreas,
      inventorySubgroups: categories,
      unitOfMeasurement: units,
      shelfCodes: {
        records: shelfRecords,
        byId: new Map(shelfRecords.map((record) => [record.id, record])),
        byName: new Map(shelfRecords.map((record) => [`${String(record.storageLocation || "").toLowerCase()}::${record.name.toLowerCase()}`, record]))
      }
    };
  }

  async function pgListItems() {
    const result = await db().query(`
      select
        i.id,
        i.name,
        c.id as category_id,
        c.name as category,
        sl.id as storage_location_id,
        sl.name as storage_location,
        ia.id as inventory_area_id,
        ia.name as inventory_area,
        sc.id as shelf_code_id,
        sc.code as shelf_code,
        sp.id as supplier_id,
        sp.name as supplier_name,
        sp.contact_information as supplier_contact,
        u.id as unit_id,
        u.name as unit,
        i.current_quantity as quantity,
        i.minimum_threshold as minimum,
        i.unit_price
      from inventory_items i
      left join categories c on c.id = i.category_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      left join suppliers sp on sp.id = i.primary_supplier_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
      where i.active = true
      order by i.name
    `);
    return result.rows.map(pgItemFromRow);
  }

  async function pgFindOrCreateLookupRecord(lookupKey, value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) return "";
    const map = {
      categories: "categories",
      storageLocations: "storage_locations",
      inventoryAreas: "inventory_areas",
      unitOfMeasurement: "units_of_measure"
    };
    const table = map[lookupKey];
    if (!table) return "";
    const existing = await db().query(`select id from ${table} where lower(name) = lower($1) limit 1`, [cleaned]);
    if (existing.rows[0]?.id) return existing.rows[0].id;
    const inserted = await db().query(`
      insert into ${table} (name, active, sort_order)
      values ($1, true, 0)
      returning id
    `, [lookupKey === "unitOfMeasurement" ? cleaned.toLowerCase() : cleaned]);
    cache.lookups.expiresAt = 0;
    return inserted.rows[0].id;
  }

  async function pgResolveShelfCodeRecord(name, storageLocation) {
    const shelfName = String(name || "").trim();
    const locationName = String(storageLocation || "").trim();
    if (!shelfName) return "";
    const existing = await db().query(`
      select sc.id
      from shelf_codes sc
      left join storage_locations sl on sl.id = sc.storage_location_id
      where lower(sc.code) = lower($1)
        and coalesce(lower(sl.name), '') = coalesce(lower($2), '')
      limit 1
    `, [shelfName, locationName]);
    if (existing.rows[0]?.id) return existing.rows[0].id;
    const storageLocationId = locationName ? await pgFindOrCreateLookupRecord("storageLocations", locationName) : null;
    const inserted = await db().query(`
      insert into shelf_codes (storage_location_id, code, active, sort_order)
      values ($1, $2, true, 0)
      returning id
    `, [storageLocationId, shelfName]);
    cache.lookups.expiresAt = 0;
    return inserted.rows[0].id;
  }

  async function pgUpdateItemSettings(recordId, payload, actorUsername = "") {
    const itemName = String(payload.name || payload.itemName || "").trim();
    const minimum = Number(payload.minimumThreshold);
    const unitPrice = normalizeUnitPrice(payload.unitPrice);
    const unit = String(payload.unit || "").trim().toLowerCase();
    const inventoryArea = String(payload.inventoryArea || "").trim();
    const storageLocation = String(payload.storageLocation || "").trim();
    const category = String(payload.category || "").trim();
    const shelfCode = String(payload.shelfCode || "").trim();
    const supplierId = String(payload.supplierId || "").trim();
    if (!itemName) throw new Error("Item name is required.");
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Minimum stock must be zero or greater.");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Unit price must be zero or greater.");
    if (!unit) throw new Error("Unit is required.");
    const unitId = await pgFindOrCreateLookupRecord("unitOfMeasurement", unit);
    const categoryId = await pgFindOrCreateLookupRecord("categories", category);
    const areaId = await pgFindOrCreateLookupRecord("inventoryAreas", inventoryArea);
    const storageLocationId = await pgFindOrCreateLookupRecord("storageLocations", storageLocation);
    const shelfCodeId = await pgResolveShelfCodeRecord(shelfCode, storageLocation);
    const beforeItems = await pgListItems();
    const before = beforeItems.find((item) => item.id === recordId) || null;
    await db().query(`
      update inventory_items
      set name = $2,
          minimum_threshold = $3,
          unit_of_measure_id = $4,
          category_id = $5,
          inventory_area_id = $6,
          storage_location_id = $7,
          shelf_code_id = $8,
          primary_supplier_id = $9,
          unit_price = $10,
          updated_at = now()
      where id = $1
    `, [recordId, itemName, minimum, unitId || null, categoryId || null, areaId || null, storageLocationId || null, shelfCodeId || null, isValidId(supplierId) ? supplierId : null, unitPrice]);
    cache.items.expiresAt = 0;
    const items = await pgListItems();
    const saved = items.find((item) => item.id === recordId);
    if (saved && auditChanged(before, saved)) {
      await pgRecordAuditEntry({
        actionType: "change",
        entityType: "inventory-item",
        entityId: recordId,
        entityName: saved.name || itemName,
        actorUsername,
        reasonCode: "inventory-update",
        before,
        after: saved
      });
    }
    return saved;
  }

  async function pgDeleteInventoryItem(recordId, actorUsername = "") {
    const items = await pgListItems();
    const before = items.find((item) => item.id === recordId) || null;
    await db().query(`delete from inventory_items where id = $1`, [recordId]);
    cache.items.expiresAt = 0;
    cache.requests.expiresAt = 0;
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "inventory-item",
        entityId: recordId,
        entityName: before.name || "",
        actorUsername,
        reasonCode: "inventory-delete",
        before
      });
    }
    return { ok: true, recordId };
  }

  async function pgCreateInventoryItem(payload, actorUsername = "") {
    const itemName = String(payload.itemName || "").trim();
    const category = String(payload.category || "").trim();
    const storageLocation = String(payload.storageLocation || "").trim();
    const inventoryArea = String(payload.inventoryArea || "").trim();
    const shelfCode = String(payload.shelfCode || "TBD").trim();
    const supplierId = String(payload.supplierId || "").trim();
    const unit = String(payload.unit || "item").trim().toLowerCase();
    const currentQuantity = Number(payload.currentQuantity || 0);
    const minimum = Number(payload.minimumThreshold || 0);
    const unitPrice = normalizeUnitPrice(payload.unitPrice);
    if (!itemName) throw new Error("Item name is required.");
    if (!unit) throw new Error("Unit is required.");
    if (!Number.isFinite(currentQuantity) || currentQuantity < 0) throw new Error("Current stock must be zero or greater.");
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Minimum stock must be zero or greater.");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Unit price must be zero or greater.");
    const categoryId = await pgFindOrCreateLookupRecord("categories", category);
    const storageLocationId = await pgFindOrCreateLookupRecord("storageLocations", storageLocation);
    const inventoryAreaId = await pgFindOrCreateLookupRecord("inventoryAreas", inventoryArea);
    const shelfId = await pgResolveShelfCodeRecord(shelfCode, storageLocation);
    const unitId = await pgFindOrCreateLookupRecord("unitOfMeasurement", unit);
    const result = await db().query(`
      insert into inventory_items (
        name, category_id, storage_location_id, shelf_code_id, inventory_area_id,
        primary_supplier_id, unit_of_measure_id, current_quantity, minimum_threshold, unit_price, active
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
      returning id
    `, [itemName, categoryId || null, storageLocationId || null, shelfId || null, inventoryAreaId || null, isValidId(supplierId) ? supplierId : null, unitId || null, currentQuantity, minimum, unitPrice]);
    cache.items.expiresAt = 0;
    const items = await pgListItems();
    const saved = items.find((item) => item.id === result.rows[0].id);
    if (saved) {
      await pgRecordAuditEntry({
        actionType: "add",
        entityType: "inventory-item",
        entityId: saved.id,
        entityName: saved.name || itemName,
        actorUsername,
        reasonCode: "inventory-create",
        after: saved
      });
    }
    return saved;
  }

  async function pgItemFormOptions() {
    const [suppliers, lookups, shelfCodes] = await Promise.all([
      getSuppliers(),
      getLookups(),
      listShelfCodesAdmin()
    ]);
    return {
      suppliers,
      categories: lookups.categories?.records || [],
      storageLocations: lookups.storageLocations?.records || [],
      inventoryAreas: lookups.inventoryAreas?.records || [],
      inventorySubgroups: lookups.categories?.records || [],
      shelfCodes: shelfCodes.map((shelf) => ({
        id: shelf.id,
        name: shelf.name,
        storageLocation: shelf.storageLocation || "",
        displayName: [shelf.storageLocation, shelf.name].filter(Boolean).join(" / ") || shelf.name
      })),
      units: lookups.unitOfMeasurement?.records?.length
        ? lookups.unitOfMeasurement.records
        : [...allowedUnits].map((name) => ({ id: name, name }))
    };
  }

  return {
    pgListLookup,
    pgListLookups,
    pgListItems,
    pgFindOrCreateLookupRecord,
    pgResolveShelfCodeRecord,
    pgUpdateItemSettings,
    pgDeleteInventoryItem,
    pgCreateInventoryItem,
    pgItemFormOptions
  };
}
