export function createSupplierDomain({
  db,
  cache,
  isValidId,
  auditChanged,
  pgRecordAuditEntry
}) {
  async function pgListSuppliers() {
    const result = await db().query(`
      select id, name, contact_information
      from suppliers
      where active = true
      order by name
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      contact: row.contact_information || ""
    }));
  }

  async function pgListSuppliersAdmin() {
    const result = await db().query(`
      select id, name, contact_information, active
      from suppliers
      order by name
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      contact: row.contact_information || "",
      active: row.active !== false
    }));
  }

  async function pgSaveSupplier(payload, recordId = "", actorUsername = "") {
    const name = String(payload.name || "").trim();
    const contact = String(payload.contact || "").trim();
    const active = payload.active !== false;
    if (!name) throw new Error("Supplier name is required.");
    let result;
    let before = null;
    if (recordId) {
      if (!isValidId(recordId)) throw new Error("Invalid supplier record.");
      const current = await db().query(`select id, name, contact_information, active from suppliers where id = $1`, [recordId]);
      before = current.rows[0] ? {
        id: current.rows[0].id,
        name: current.rows[0].name || "",
        contact: current.rows[0].contact_information || "",
        active: current.rows[0].active !== false
      } : null;
      result = await db().query(`
        update suppliers
        set name = $2,
            contact_information = $3,
            active = $4,
            updated_at = now()
        where id = $1
        returning id, name, contact_information, active
      `, [recordId, name, contact, active]);
    } else {
      result = await db().query(`
        insert into suppliers (name, contact_information, active)
        values ($1, $2, $3)
        returning id, name, contact_information, active
      `, [name, contact, active]);
    }
    cache.suppliers.expiresAt = 0;
    cache.items.expiresAt = 0;
    const row = result.rows[0];
    const saved = {
      id: row.id,
      name: row.name || "",
      contact: row.contact_information || "",
      active: row.active !== false
    };
    if (!recordId || auditChanged(before, saved)) {
      await pgRecordAuditEntry({
        actionType: recordId ? "change" : "add",
        entityType: "supplier",
        entityId: saved.id,
        entityName: saved.name,
        actorUsername,
        reasonCode: recordId ? "supplier-update" : "supplier-create",
        before,
        after: saved
      });
    }
    return saved;
  }

  async function pgDeleteSupplier(recordId, actorUsername = "") {
    if (!isValidId(recordId)) throw new Error("Invalid supplier record.");
    const current = await db().query(`select id, name, contact_information, active from suppliers where id = $1`, [recordId]);
    const before = current.rows[0] ? {
      id: current.rows[0].id,
      name: current.rows[0].name || "",
      contact: current.rows[0].contact_information || "",
      active: current.rows[0].active !== false
    } : null;
    const inUse = await db().query(`
      select exists(select 1 from inventory_items where primary_supplier_id = $1) as inventory_used,
             exists(select 1 from standing_orders where supplier_id = $1) as standing_used,
             exists(select 1 from driver_sheet_lines where supplier_id = $1) as driver_used
    `, [recordId]);
    const usage = inUse.rows[0] || {};
    if (usage.inventory_used || usage.standing_used || usage.driver_used) {
      throw new Error("This supplier is still used by inventory items, standing orders, or driver lines. Set it inactive instead of deleting it.");
    }
    await db().query(`delete from suppliers where id = $1`, [recordId]);
    cache.suppliers.expiresAt = 0;
    cache.items.expiresAt = 0;
    if (before) {
      await pgRecordAuditEntry({
        actionType: "delete",
        entityType: "supplier",
        entityId: recordId,
        entityName: before.name,
        actorUsername,
        reasonCode: "supplier-delete",
        before
      });
    }
    return { ok: true, recordId };
  }

  async function pgFindOrCreateSupplierByName(name) {
    const cleaned = String(name || "").trim();
    if (!cleaned) return null;
    const existing = await db().query(`
      select id, name, contact_information
      from suppliers
      where lower(name) = lower($1)
      limit 1
    `, [cleaned]);
    if (existing.rows[0]) return existing.rows[0];
    const created = await db().query(`
      insert into suppliers (name, contact_information, active)
      values ($1, '', true)
      returning id, name, contact_information
    `, [cleaned]);
    cache.suppliers.expiresAt = 0;
    return created.rows[0] || null;
  }

  return {
    pgListSuppliers,
    pgListSuppliersAdmin,
    pgSaveSupplier,
    pgDeleteSupplier,
    pgFindOrCreateSupplierByName
  };
}
