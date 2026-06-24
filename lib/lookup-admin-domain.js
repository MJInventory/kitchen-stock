export function createLookupAdminDomain({
  db,
  cache,
  auditChanged,
  pgRecordAuditEntry,
  pgFindOrCreateLookupRecord,
  pgResolveShelfCodeRecord = async () => "",
  hasPostgres = () => true,
  airtable = async () => ({}),
  getSchema = async () => ({}),
  ensureShelfCodeStorageLocationField = async (schema) => schema,
  findOrCreateLookupRecord = async () => "",
  getLookups = async () => ({}),
  getStorageLocationsAdmin = async () => []
}) {
  function normalizeStorageLocation(record) {
    return {
      id: record.id,
      name: String(record.fields["Storage Location"] || "").trim(),
      active: record.fields.Active !== false
    };
  }

  function normalizeCategory(record) {
    return {
      id: record.id,
      name: String(record.fields.Category || "").trim()
    };
  }

  function normalizeUnitOfMeasure(record) {
    return {
      id: record.id,
      name: String(record.fields.Unit || "").trim(),
      active: record.fields.Active !== false
    };
  }

  function normalizeShelfCode(record) {
    return {
      id: record.id,
      name: String(record.fields["Shelf Code"] || "").trim(),
      storageLocation: String(record.fields["Storage Location"] || record.fields["Storage Locations"] || "").trim(),
      storageLocationId: record.fields["Storage Location Link"]?.[0] || record.fields["Storage Locations Link"]?.[0] || record.fields["Storage Location Links"]?.[0] || "",
      active: record.fields.Active !== false
    };
  }

  async function pgListStorageLocationsAdmin() {
    const result = await db().query(`
      select id, name, active
      from storage_locations
      order by sort_order, name
    `);
    return result.rows.map((row) => ({ id: row.id, name: row.name || "", active: row.active !== false }));
  }

  async function pgListCategoriesAdmin() {
    const result = await db().query(`
      select id, name
      from categories
      order by sort_order, name
    `);
    return result.rows.map((row) => ({ id: row.id, name: row.name || "" }));
  }

  async function pgListUnitsOfMeasureAdmin() {
    const result = await db().query(`
      select id, name, active
      from units_of_measure
      order by name
    `);
    return result.rows.map((row) => ({ id: row.id, name: row.name || "", active: row.active !== false }));
  }

  async function pgListShelfCodesAdmin() {
    const result = await db().query(`
      select sc.id, sc.code, sc.active, sl.name as storage_location
      from shelf_codes sc
      left join storage_locations sl on sl.id = sc.storage_location_id
      order by sl.name nulls last, sc.sort_order, sc.code
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.code || "",
      storageLocation: row.storage_location || "",
      active: row.active !== false
    }));
  }

  async function pgSaveStorageLocation(payload, recordId = "", actorUsername = "") {
    const name = String(payload.name || payload.storageLocation || "").trim();
    const active = payload.active !== false;
    if (!name) throw new Error("Storage location name is required.");
    let before = null;
    if (recordId) {
      const current = await db().query(`select id, name, active from storage_locations where id = $1`, [recordId]);
      before = current.rows[0] ? {
        id: current.rows[0].id,
        name: current.rows[0].name || "",
        active: current.rows[0].active !== false
      } : null;
      const result = await db().query(`
        update storage_locations
        set name = $2, active = $3, updated_at = now()
        where id = $1
        returning id, name, active
      `, [recordId, name, active]);
      cache.lookups.expiresAt = 0;
      const saved = { id: result.rows[0].id, name: result.rows[0].name, active: result.rows[0].active !== false };
      if (auditChanged(before, saved)) {
        await pgRecordAuditEntry({
          actionType: "change",
          entityType: "storage-location",
          entityId: saved.id,
          entityName: saved.name,
          actorUsername,
          reasonCode: "storage-location-update",
          before,
          after: saved
        });
      }
      return saved;
    }
    const result = await db().query(`
      insert into storage_locations (name, active, sort_order)
      values ($1, $2, 0)
      returning id, name, active
    `, [name, active]);
    cache.lookups.expiresAt = 0;
    const saved = { id: result.rows[0].id, name: result.rows[0].name, active: result.rows[0].active !== false };
    await pgRecordAuditEntry({
      actionType: "add",
      entityType: "storage-location",
      entityId: saved.id,
      entityName: saved.name,
      actorUsername,
      reasonCode: "storage-location-create",
      after: saved
    });
    return saved;
  }

  async function pgSaveCategory(payload, recordId = "", actorUsername = "") {
    const name = String(payload.name || payload.category || "").trim();
    if (!name) throw new Error("Category name is required.");
    let before = null;
    if (recordId) {
      const current = await db().query(`select id, name from categories where id = $1`, [recordId]);
      before = current.rows[0] ? { id: current.rows[0].id, name: current.rows[0].name || "" } : null;
      const result = await db().query(`
        update categories
        set name = $2, updated_at = now()
        where id = $1
        returning id, name
      `, [recordId, name]);
      cache.lookups.expiresAt = 0;
      const saved = { id: result.rows[0].id, name: result.rows[0].name };
      if (auditChanged(before, saved)) {
        await pgRecordAuditEntry({
          actionType: "change",
          entityType: "category",
          entityId: saved.id,
          entityName: saved.name,
          actorUsername,
          reasonCode: "category-update",
          before,
          after: saved
        });
      }
      return saved;
    }
    const result = await db().query(`
      insert into categories (name, active, sort_order)
      values ($1, true, 0)
      returning id, name
    `, [name]);
    cache.lookups.expiresAt = 0;
    const saved = { id: result.rows[0].id, name: result.rows[0].name };
    await pgRecordAuditEntry({
      actionType: "add",
      entityType: "category",
      entityId: saved.id,
      entityName: saved.name,
      actorUsername,
      reasonCode: "category-create",
      after: saved
    });
    return saved;
  }

  async function pgDeleteCategory(recordId, actorUsername = "") {
    const current = await db().query(`select id, name from categories where id = $1`, [recordId]);
    const before = current.rows[0] ? { id: current.rows[0].id, name: current.rows[0].name || "" } : null;
    await db().query(`delete from categories where id = $1`, [recordId]);
    cache.lookups.expiresAt = 0;
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "category",
        entityId: recordId,
        entityName: before.name,
        actorUsername,
        reasonCode: "category-delete",
        before
      });
    }
    return { ok: true, recordId };
  }

  async function pgSaveUnitOfMeasure(payload, recordId = "", actorUsername = "") {
    const name = String(payload.name || payload.unit || "").trim().toLowerCase();
    const active = payload.active !== false;
    if (!name) throw new Error("Unit name is required.");
    let before = null;
    if (recordId) {
      const current = await db().query(`select id, name, active from units_of_measure where id = $1`, [recordId]);
      before = current.rows[0]
        ? { id: current.rows[0].id, name: current.rows[0].name || "", active: current.rows[0].active !== false }
        : null;
      const result = await db().query(`
        update units_of_measure
        set name = $2, active = $3, updated_at = now()
        where id = $1
        returning id, name, active
      `, [recordId, name, active]);
      cache.lookups.expiresAt = 0;
      const saved = { id: result.rows[0].id, name: result.rows[0].name, active: result.rows[0].active !== false };
      if (auditChanged(before, saved)) {
        await pgRecordAuditEntry({
          actionType: "change",
          entityType: "unit-of-measure",
          entityId: saved.id,
          entityName: saved.name,
          actorUsername,
          reasonCode: "unit-of-measure-update",
          before,
          after: saved
        });
      }
      return saved;
    }
    const result = await db().query(`
      insert into units_of_measure (name, active)
      values ($1, $2)
      returning id, name, active
    `, [name, active]);
    cache.lookups.expiresAt = 0;
    const saved = { id: result.rows[0].id, name: result.rows[0].name, active: result.rows[0].active !== false };
    await pgRecordAuditEntry({
      actionType: "add",
      entityType: "unit-of-measure",
      entityId: saved.id,
      entityName: saved.name,
      actorUsername,
      reasonCode: "unit-of-measure-create",
      after: saved
    });
    return saved;
  }

  async function pgDeleteUnitOfMeasure(recordId, actorUsername = "") {
    const current = await db().query(`select id, name, active from units_of_measure where id = $1`, [recordId]);
    const before = current.rows[0]
      ? { id: current.rows[0].id, name: current.rows[0].name || "", active: current.rows[0].active !== false }
      : null;
    await db().query(`delete from units_of_measure where id = $1`, [recordId]);
    cache.lookups.expiresAt = 0;
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "unit-of-measure",
        entityId: recordId,
        entityName: before.name,
        actorUsername,
        reasonCode: "unit-of-measure-delete",
        before
      });
    }
    return { ok: true, recordId };
  }

  async function pgSaveShelfCode(payload, recordId = "", actorUsername = "") {
    const name = String(payload.name || payload.shelfCode || "").trim();
    const storageLocation = String(payload.storageLocation || "").trim();
    const active = payload.active !== false;
    if (!name) throw new Error("Shelf code is required.");
    const storageLocationId = storageLocation ? await pgFindOrCreateLookupRecord("storageLocations", storageLocation) : null;
    let before = null;
    if (recordId) {
      const current = await db().query(`
        select sc.id, sc.code, sc.active, sl.name as storage_location
        from shelf_codes sc
        left join storage_locations sl on sl.id = sc.storage_location_id
        where sc.id = $1
      `, [recordId]);
      before = current.rows[0] ? {
        id: current.rows[0].id,
        name: current.rows[0].code || "",
        storageLocation: current.rows[0].storage_location || "",
        active: current.rows[0].active !== false
      } : null;
      const result = await db().query(`
        update shelf_codes
        set code = $2, storage_location_id = $3, active = $4, updated_at = now()
        where id = $1
        returning id, code, active
      `, [recordId, name, storageLocationId, active]);
      cache.lookups.expiresAt = 0;
      const saved = { id: result.rows[0].id, name: result.rows[0].code, storageLocation, storageLocationId, active: result.rows[0].active !== false };
      if (auditChanged(before, saved)) {
        await pgRecordAuditEntry({
          actionType: "change",
          entityType: "shelf-code",
          entityId: saved.id,
          entityName: `${saved.storageLocation || "No Location"} / ${saved.name}`,
          actorUsername,
          reasonCode: "shelf-code-update",
          before,
          after: saved
        });
      }
      return saved;
    }
    const result = await db().query(`
      insert into shelf_codes (storage_location_id, code, active, sort_order)
      values ($1, $2, $3, 0)
      returning id, code, active
    `, [storageLocationId, name, active]);
    cache.lookups.expiresAt = 0;
    const saved = { id: result.rows[0].id, name: result.rows[0].code, storageLocation, storageLocationId, active: result.rows[0].active !== false };
    await pgRecordAuditEntry({
      actionType: "add",
      entityType: "shelf-code",
      entityId: saved.id,
      entityName: `${saved.storageLocation || "No Location"} / ${saved.name}`,
      actorUsername,
      reasonCode: "shelf-code-create",
      after: saved
    });
    return saved;
  }

  async function findExistingShelfCodeRecordId(name, storageLocation, excludeRecordId = "") {
    let schema = await getSchema();
    schema = await ensureShelfCodeStorageLocationField(schema);
    const tableId = schema.tables?.shelfCodes;
    if (!tableId) return "";

    const wantedName = String(name || "").trim().toLowerCase();
    const wantedLocation = String(storageLocation || "").trim().toLowerCase();
    if (!wantedName) return "";

    const records = await airtable(tableId, {
      method: "GET",
      query: {
        "sort[0][field]": "Shelf Code",
        "sort[0][direction]": "asc"
      }
    });
    const normalizedRecords = Array.isArray(records?.records) ? records.records : [];
    const locations = await getStorageLocationsAdmin();
    const locationById = new Map(locations.map((location) => [location.id, location.name]));
    const match = normalizedRecords
      .map(normalizeShelfCode)
      .map((shelf) => ({
        ...shelf,
        storageLocation: shelf.storageLocation || locationById.get(shelf.storageLocationId) || ""
      }))
      .find((shelf) =>
        shelf.id !== excludeRecordId &&
        String(shelf.name || "").trim().toLowerCase() === wantedName &&
        String(shelf.storageLocation || "").trim().toLowerCase() === wantedLocation
      );
    return match?.id || "";
  }

  async function findExistingCategoryRecordId(name, excludeRecordId = "") {
    if (hasPostgres()) return "";
    const wantedName = String(name || "").trim().toLowerCase();
    if (!wantedName) return "";
    const categories = await listCategoriesAdmin();
    const match = categories.find((category) =>
      category.id !== excludeRecordId &&
      String(category.name || "").trim().toLowerCase() === wantedName
    );
    return match?.id || "";
  }

  async function listStorageLocationsAdmin() {
    if (hasPostgres()) {
      return pgListStorageLocationsAdmin();
    }
    const schema = await getSchema();
    const tableId = schema.tables?.storageLocations;
    if (!tableId) throw new Error("Storage Locations table was not found.");
    const result = await airtable(tableId, { method: "GET" });
    return (result?.records || []).map(normalizeStorageLocation);
  }

  async function listCategoriesAdmin() {
    if (hasPostgres()) {
      return pgListCategoriesAdmin();
    }
    const schema = await getSchema();
    const tableId = schema.tables?.categories;
    if (!tableId) throw new Error("Categories table was not found.");
    const result = await airtable(tableId, { method: "GET" });
    return (result?.records || []).map(normalizeCategory);
  }

  async function listUnitsOfMeasureAdmin() {
    if (hasPostgres()) {
      return pgListUnitsOfMeasureAdmin();
    }
    const schema = await getSchema();
    const tableId = schema.tables?.unitOfMeasurement;
    if (!tableId) throw new Error("Unit Of Measurement table was not found.");
    const result = await airtable(tableId, { method: "GET" });
    return (result?.records || []).map(normalizeUnitOfMeasure);
  }

  async function listShelfCodesAdmin() {
    if (hasPostgres()) {
      return pgListShelfCodesAdmin();
    }
    let schema = await getSchema();
    schema = await ensureShelfCodeStorageLocationField(schema);
    const tableId = schema.tables?.shelfCodes;
    if (!tableId) throw new Error("Shelf Codes table was not found.");
    const result = await airtable(tableId, {
      method: "GET",
      query: {
        "sort[0][field]": "Shelf Code",
        "sort[0][direction]": "asc"
      }
    });
    const records = (result?.records || []).map(normalizeShelfCode);
    const locations = await listStorageLocationsAdmin();
    const locationById = new Map(locations.map((location) => [location.id, location.name]));
    return records.map((shelf) => ({
      ...shelf,
      storageLocation: shelf.storageLocation || locationById.get(shelf.storageLocationId) || ""
    }));
  }

  async function resolveShelfCodeRecord(name, storageLocation) {
    if (hasPostgres()) {
      return pgResolveShelfCodeRecord(name, storageLocation);
    }
    const shelfName = String(name || "").trim();
    const locationName = String(storageLocation || "").trim();
    if (!shelfName) return "";

    const shelves = await listShelfCodesAdmin();
    const match = shelves.find((shelf) =>
      shelf.name.toLowerCase() === shelfName.toLowerCase() &&
      (!locationName || String(shelf.storageLocation || "").toLowerCase() === locationName.toLowerCase())
    );
    if (match) return match.id;

    const created = await saveShelfCode({
      name: shelfName,
      storageLocation: locationName,
      active: true
    });
    return created.id;
  }

  async function saveStorageLocation(payload, recordId = "", actorUsername = "") {
    if (hasPostgres()) {
      return pgSaveStorageLocation(payload, recordId, actorUsername);
    }
    const schema = await getSchema();
    const tableId = schema.tables?.storageLocations;
    if (!tableId) throw new Error("Storage Locations table was not found.");
    const name = String(payload.name || payload.storageLocation || "").trim();
    const active = payload.active !== false;
    if (!name) throw new Error("Storage location name is required.");
    const fields = { "Storage Location": name };
    if (schema.lookupFields?.storageLocations?.hasActive) fields.Active = active;

    const record = recordId
      ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
      : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
    cache.lookups.expiresAt = 0;
    cache.items.expiresAt = 0;
    return normalizeStorageLocation(record);
  }

  async function saveCategory(payload, recordId = "", actorUsername = "") {
    if (hasPostgres()) {
      return pgSaveCategory(payload, recordId, actorUsername);
    }
    const schema = await getSchema();
    const tableId = schema.tables?.categories;
    if (!tableId) throw new Error("Categories table was not found.");
    const name = String(payload.name || payload.category || "").trim();
    if (!name) throw new Error("Category name is required.");

    const duplicateId = await findExistingCategoryRecordId(name, recordId);
    if (duplicateId && !recordId) {
      recordId = duplicateId;
    } else if (duplicateId && recordId && duplicateId !== recordId) {
      throw new Error(`Category "${name}" already exists.`);
    }

    const fields = { Category: name };
    const record = recordId
      ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
      : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
    cache.lookups.expiresAt = 0;
    cache.items.expiresAt = 0;
    return normalizeCategory(record);
  }

  async function deleteCategory(recordId, actorUsername = "") {
    if (hasPostgres()) {
      return pgDeleteCategory(recordId, actorUsername);
    }
    const schema = await getSchema();
    const tableId = schema.tables?.categories;
    if (!tableId) throw new Error("Categories table was not found.");
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid category record.");
    }
    await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
    cache.lookups.expiresAt = 0;
    cache.items.expiresAt = 0;
    return { ok: true, recordId };
  }

  async function saveUnitOfMeasure(payload, recordId = "", actorUsername = "") {
    if (hasPostgres()) {
      return pgSaveUnitOfMeasure(payload, recordId, actorUsername);
    }
    const schema = await getSchema();
    const tableId = schema.tables?.unitOfMeasurement;
    if (!tableId) throw new Error("Unit Of Measurement table was not found.");
    const name = String(payload.name || payload.unit || "").trim().toLowerCase();
    const active = payload.active !== false;
    if (!name) throw new Error("Unit name is required.");
    const fields = { Unit: name };
    if (schema.lookupFields?.unitOfMeasurement?.hasActive) fields.Active = active;
    const record = recordId
      ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
      : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
    cache.lookups.expiresAt = 0;
    cache.items.expiresAt = 0;
    return normalizeUnitOfMeasure(record);
  }

  async function deleteUnitOfMeasure(recordId, actorUsername = "") {
    if (hasPostgres()) {
      return pgDeleteUnitOfMeasure(recordId, actorUsername);
    }
    const schema = await getSchema();
    const tableId = schema.tables?.unitOfMeasurement;
    if (!tableId) throw new Error("Unit Of Measurement table was not found.");
    await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
    cache.lookups.expiresAt = 0;
    cache.items.expiresAt = 0;
    return { ok: true, recordId };
  }

  async function saveShelfCode(payload, recordId = "", actorUsername = "") {
    if (hasPostgres()) {
      return pgSaveShelfCode(payload, recordId, actorUsername);
    }
    let schema = await getSchema();
    schema = await ensureShelfCodeStorageLocationField(schema);
    const tableId = schema.tables?.shelfCodes;
    if (!tableId) throw new Error("Shelf Codes table was not found.");
    const name = String(payload.name || payload.shelfCode || "").trim();
    const storageLocation = String(payload.storageLocation || "").trim();
    const active = payload.active !== false;
    if (!name) throw new Error("Shelf code is required.");
    const duplicateId = await findExistingShelfCodeRecordId(name, storageLocation, recordId);
    if (duplicateId && !recordId) {
      recordId = duplicateId;
    } else if (duplicateId && recordId && duplicateId !== recordId) {
      throw new Error(`Shelf code "${name}" already exists for ${storageLocation}.`);
    }
    const fields = { "Shelf Code": name };
    if (schema.lookupFields?.shelfCodes?.hasActive) fields.Active = active;
    if (storageLocation) {
      if (schema.lookupFields?.shelfCodes?.hasStorageLocationLink) {
        const locationId = await findOrCreateLookupRecord("storageLocations", storageLocation);
        fields[schema.lookupFields.shelfCodes.storageLocationLinkFieldName || "Storage Location Link"] = locationId ? [locationId] : [];
      } else if (schema.lookupFields?.shelfCodes?.hasStorageLocation) {
        fields[schema.lookupFields.shelfCodes.storageLocationFieldName || "Storage Location"] = storageLocation;
      } else {
        throw new Error("Add Storage Location or Storage Location Link to the Shelf Codes table first.");
      }
    }

    const record = recordId
      ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
      : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
    cache.lookups.expiresAt = 0;
    cache.items.expiresAt = 0;
    return normalizeShelfCode(record);
  }

  return {
    normalizeStorageLocation,
    normalizeCategory,
    normalizeUnitOfMeasure,
    normalizeShelfCode,
    pgListStorageLocationsAdmin,
    pgListCategoriesAdmin,
    pgListUnitsOfMeasureAdmin,
    pgListShelfCodesAdmin,
    pgSaveStorageLocation,
    pgSaveCategory,
    pgDeleteCategory,
    pgSaveUnitOfMeasure,
    pgDeleteUnitOfMeasure,
    pgSaveShelfCode,
    listStorageLocationsAdmin,
    listCategoriesAdmin,
    listUnitsOfMeasureAdmin,
    listShelfCodesAdmin,
    resolveShelfCodeRecord,
    saveStorageLocation,
    saveCategory,
    deleteCategory,
    saveUnitOfMeasure,
    deleteUnitOfMeasure,
    saveShelfCode
  };
}
