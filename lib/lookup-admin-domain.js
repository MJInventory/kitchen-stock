export function createLookupAdminDomain({
  db,
  cache,
  auditChanged,
  pgRecordAuditEntry,
  pgFindOrCreateLookupRecord
}) {
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

  return {
    pgListStorageLocationsAdmin,
    pgListCategoriesAdmin,
    pgListShelfCodesAdmin,
    pgSaveStorageLocation,
    pgSaveCategory,
    pgDeleteCategory,
    pgSaveShelfCode
  };
}
