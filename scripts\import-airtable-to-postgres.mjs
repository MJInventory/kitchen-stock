import bcrypt from "bcryptjs";
import { closePool, getPool } from "../lib/postgres.js";

const airtableToken = process.env.AIRTABLE_TOKEN || "";
const baseId = process.env.AIRTABLE_BASE_ID || "appAFvMwWZb2PPWUz";
const appUsersTableIdFromEnv = process.env.APP_USERS_TABLE_ID || "";
const inventoryTableId = process.env.AIRTABLE_INVENTORY_TABLE_ID || "tblEuIXG6gxEiD5oU";
const requestsTableId = process.env.AIRTABLE_REQUESTS_TABLE_ID || "tblUHh1jWhqMFEfjd";
const suppliersTableId = process.env.AIRTABLE_SUPPLIERS_TABLE_ID || "tbl2YP7EpUpk3Ug6f";
const allowedUnits = new Set(["box", "bag", "item", "bottle"]);

if (!airtableToken) {
  throw new Error("AIRTABLE_TOKEN is required for db:import:airtable.");
}

const airtableHeaders = {
  Authorization: `Bearer ${airtableToken}`,
  "Content-Type": "application/json"
};

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function boolValue(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim().toLowerCase() !== "false";
}

function toNumeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function airtable(path, { meta = false, method = "GET", query = {}, body } = {}) {
  const baseUrl = meta
    ? `https://api.airtable.com/v0/meta/bases/${baseId}`
    : `https://api.airtable.com/v0/${baseId}`;
  const url = new URL(`${baseUrl}/${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    method,
    headers: airtableHeaders,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Airtable ${method} ${url.pathname} failed: ${data?.error?.message || response.statusText}`);
  }
  return data;
}

async function listAllRecords(tableId, query = {}) {
  const records = [];
  let offset = "";

  do {
    const page = await airtable(tableId, {
      query: {
        pageSize: "100",
        ...query,
        ...(offset ? { offset } : {})
      }
    });
    records.push(...(page.records || []));
    offset = page.offset || "";
  } while (offset);

  return records;
}

async function getMetaTables() {
  const data = await airtable("tables", { meta: true });
  return data.tables || [];
}

function findTable(tables, ...aliases) {
  for (const alias of aliases) {
    const expected = normalizeName(alias);
    const match = tables.find((table) => normalizeName(table.name) === expected);
    if (match) return match;
  }
  return null;
}

function parseItemsJson(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function queryMap(sqlText, values = []) {
  const result = await getPool().query(sqlText, values);
  return new Map(result.rows.map((row) => [row.external_id, row.id]));
}

async function upsertLookup(tableName, records, options = {}) {
  const pool = getPool();
  const sortField = options.sortField || "";
  for (const [index, record] of records.entries()) {
    const fields = record.fields || {};
    const name = String(
      fields[options.primaryField]
      || fields.Name
      || fields[tableName.slice(0, -1)]
      || ""
    ).trim();
    if (!name) continue;
    const active = boolValue(fields.Active, true);
    const sortOrder = toNumeric(fields[sortField], index);
    await pool.query(
      `
        insert into ${tableName} (external_id, name, active, sort_order)
        values ($1, $2, $3, $4)
        on conflict (external_id) do update
          set name = excluded.name,
              active = excluded.active,
              sort_order = excluded.sort_order,
              updated_at = now()
      `,
      [record.id, name, active, sortOrder]
    );
  }
}

async function importSuppliers(records) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const name = String(fields["Supplier Name"] || fields.Name || "").trim();
    if (!name) continue;
    await pool.query(
      `
        insert into suppliers (external_id, name, contact_information, active)
        values ($1, $2, $3, $4)
        on conflict (name) do update
          set external_id = coalesce(suppliers.external_id, excluded.external_id),
              contact_information = excluded.contact_information,
              active = excluded.active,
              updated_at = now()
      `,
      [
        record.id,
        name,
        String(fields["Contact Information"] || "").trim(),
        boolValue(fields.Active, true)
      ]
    );
  }
}

async function importUnits(lookupUnits) {
  const pool = getPool();
  for (const unit of lookupUnits) {
    const name = String(unit.fields.Unit || unit.fields.Name || "").trim();
    if (!name) continue;
    await pool.query(
      `
        insert into units_of_measure (external_id, name, active)
        values ($1, $2, $3)
        on conflict (external_id) do update
          set name = excluded.name,
              active = excluded.active,
              updated_at = now()
      `,
      [unit.id, name, boolValue(unit.fields.Active, true)]
    );
  }

  for (const name of allowedUnits) {
    await pool.query(
      `
        insert into units_of_measure (name, active)
        values ($1, true)
        on conflict (name) do nothing
      `,
      [name]
    );
  }
}

async function importShelfCodes(records, storageLocationIdByExternalId) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const code = String(fields["Shelf Code"] || fields.Name || "").trim();
    if (!code) continue;
    const storageExternalId = fields["Storage Location Link"]?.[0] || "";
    const storageLocationId = storageLocationIdByExternalId.get(storageExternalId);
    if (!storageLocationId) continue;
    await pool.query(
      `
        insert into shelf_codes (external_id, storage_location_id, code, active, sort_order)
        values ($1, $2, $3, $4, $5)
        on conflict (external_id) do update
          set storage_location_id = excluded.storage_location_id,
              code = excluded.code,
              active = excluded.active,
              sort_order = excluded.sort_order,
              updated_at = now()
      `,
      [
        record.id,
        storageLocationId,
        code,
        boolValue(fields.Active, true),
        toNumeric(fields["Sort Order"], 0)
      ]
    );
  }
}

async function importAppUsers(records) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const username = String(fields.Username || fields["User Name"] || fields.Name || "").trim();
    if (!username) continue;
    const plainPassword = String(fields.Password || fields["New Password"] || "").trim();
    const passwordHash = plainPassword ? await bcrypt.hash(plainPassword, 10) : await bcrypt.hash("changeme", 10);
    const role = String(fields.Role || "user").trim() || "user";
    const theme = String(fields.Theme || "dark").trim().toLowerCase() === "light" ? "light" : "dark";
    await pool.query(
      `
        insert into app_users (
          external_id, username, display_name, password_hash, role, theme, active, must_change_password, source
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'airtable')
        on conflict (username) do update
          set external_id = coalesce(app_users.external_id, excluded.external_id),
              display_name = excluded.display_name,
              password_hash = excluded.password_hash,
              role = excluded.role,
              theme = excluded.theme,
              active = excluded.active,
              must_change_password = excluded.must_change_password,
              updated_at = now()
      `,
      [
        record.id,
        username.toLowerCase(),
        String(fields["Display Name"] || username).trim(),
        passwordHash,
        role,
        theme,
        boolValue(fields.Active, true),
        boolValue(fields["Force Password Change"], false)
      ]
    );
  }
}

async function importInventoryItems(records, maps) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const name = String(fields["Item Name"] || "").trim();
    if (!name) continue;

    const categoryId = maps.categories.get(fields["Category Link"]?.[0] || "") || null;
    const storageLocationId = maps.storageLocations.get(fields["Storage Location Link"]?.[0] || "") || null;
    const shelfCodeId = maps.shelfCodes.get(fields["Shelf Code Link"]?.[0] || "") || null;
    const inventoryAreaId = maps.inventoryAreas.get(fields["Inventory Area Link"]?.[0] || "") || null;
    const supplierId = maps.suppliers.get(fields["Supplier/Vendor"]?.[0] || "") || null;
    const unitId = maps.units.get(fields["Unit Of Measurement Link"]?.[0] || "") || maps.unitsByName.get(String(fields["Unit of Measure"] || "").trim().toLowerCase()) || null;

    await pool.query(
      `
        insert into inventory_items (
          external_id, name, category_id, storage_location_id, shelf_code_id, inventory_area_id,
          primary_supplier_id, unit_of_measure_id, current_quantity, minimum_threshold, active
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (external_id) do update
          set name = excluded.name,
              category_id = excluded.category_id,
              storage_location_id = excluded.storage_location_id,
              shelf_code_id = excluded.shelf_code_id,
              inventory_area_id = excluded.inventory_area_id,
              primary_supplier_id = excluded.primary_supplier_id,
              unit_of_measure_id = excluded.unit_of_measure_id,
              current_quantity = excluded.current_quantity,
              minimum_threshold = excluded.minimum_threshold,
              active = excluded.active,
              updated_at = now()
      `,
      [
        record.id,
        name,
        categoryId,
        storageLocationId,
        shelfCodeId,
        inventoryAreaId,
        supplierId,
        unitId,
        toNumeric(fields["Current Quantity"], 0),
        toNumeric(fields["Minimum Threshold"], 0),
        boolValue(fields.Active, true)
      ]
    );
  }
}

async function importRequests(records, maps) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const inventoryItemId = maps.inventoryItems.get(fields["Requested Item"]?.[0] || "");
    if (!inventoryItemId) continue;
    await pool.query(
      `
        insert into order_requests (
          external_id, inventory_item_id, quantity_needed, urgency_level, status, requested_by_username,
          requested_at, delivered, delivered_at, delivered_by_username, notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (external_id) do update
          set inventory_item_id = excluded.inventory_item_id,
              quantity_needed = excluded.quantity_needed,
              urgency_level = excluded.urgency_level,
              status = excluded.status,
              requested_by_username = excluded.requested_by_username,
              requested_at = excluded.requested_at,
              delivered = excluded.delivered,
              delivered_at = excluded.delivered_at,
              delivered_by_username = excluded.delivered_by_username,
              notes = excluded.notes,
              updated_at = now()
      `,
      [
        record.id,
        inventoryItemId,
        toNumeric(fields["Quantity Needed"], 0),
        String(fields["Urgency Level"] || "Medium"),
        String(fields.Status || "Approved"),
        String(fields["Requested By"] || "Kitchen"),
        fields["Request Date/Time"] || new Date().toISOString(),
        Boolean(fields.Received),
        fields["Received Date/Time"] || null,
        String(fields["Received By"] || ""),
        String(fields.Notes || "")
      ]
    );
  }
}

async function importDriverLines(records, maps) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const orderRequestId = maps.requests.get(fields["Item Request Record ID"] || "");
    if (!orderRequestId) continue;
    const supplierId = maps.suppliersByName.get(String(fields["Supplier Name"] || "").trim().toLowerCase()) || null;
    await pool.query(
      `
        insert into driver_sheet_lines (
          external_id, sheet_date, order_request_id, supplier_id, driver_username, ordered, ordered_at,
          ordered_by_username, received, received_at, received_by_username, to_deliver, delivery_day, notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        on conflict (external_id) do update
          set sheet_date = excluded.sheet_date,
              order_request_id = excluded.order_request_id,
              supplier_id = excluded.supplier_id,
              driver_username = excluded.driver_username,
              ordered = excluded.ordered,
              ordered_at = excluded.ordered_at,
              ordered_by_username = excluded.ordered_by_username,
              received = excluded.received,
              received_at = excluded.received_at,
              received_by_username = excluded.received_by_username,
              to_deliver = excluded.to_deliver,
              delivery_day = excluded.delivery_day,
              notes = excluded.notes,
              updated_at = now()
      `,
      [
        record.id,
        fields["Sheet Date"] || null,
        orderRequestId,
        supplierId,
        String(fields.Driver || ""),
        Boolean(fields.Ordered),
        fields["Ordered Date/Time"] || null,
        String(fields["Ordered By"] || ""),
        Boolean(fields.Received),
        fields["Received Date/Time"] || null,
        String(fields["Received By"] || ""),
        Boolean(fields["2Deliver"]),
        fields["Delivery Day"] || fields["Delivery Date"] || null,
        String(fields.Notes || "")
      ]
    );
  }
}

async function importStockCounts(records, maps) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const inventoryItemId = maps.inventoryItems.get(fields["Inventory Item Record ID"] || "");
    if (!inventoryItemId) continue;
    await pool.query(
      `
        insert into stock_counts (
          external_id, inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (external_id) do update
          set inventory_item_id = excluded.inventory_item_id,
              counted_quantity = excluded.counted_quantity,
              previous_quantity = excluded.previous_quantity,
              counted_by_username = excluded.counted_by_username,
              counted_at = excluded.counted_at,
              notes = excluded.notes
      `,
      [
        record.id,
        inventoryItemId,
        toNumeric(fields["Counted Quantity"], 0),
        toNumeric(fields["Previous Quantity"], 0),
        String(fields["Counted By"] || ""),
        fields["Counted At"] || fields["Count Date/Time"] || new Date().toISOString(),
        String(fields.Notes || "")
      ]
    );
  }
}

async function importStandingOrders(records, maps) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const supplierId = maps.suppliersByName.get(String(fields["Supplier Name"] || "").trim().toLowerCase()) || null;
    await pool.query(
      `
        insert into standing_orders (
          external_id, name, supplier_id, expected_arrival_date, schedule, other_schedule,
          recurring, active, last_generated_date, notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (external_id) do update
          set name = excluded.name,
              supplier_id = excluded.supplier_id,
              expected_arrival_date = excluded.expected_arrival_date,
              schedule = excluded.schedule,
              other_schedule = excluded.other_schedule,
              recurring = excluded.recurring,
              active = excluded.active,
              last_generated_date = excluded.last_generated_date,
              notes = excluded.notes,
              updated_at = now()
      `,
      [
        record.id,
        String(fields["Standing Order"] || fields.Name || "Standing Order"),
        supplierId,
        fields["Expected Arrival Date"] || null,
        String(fields.Schedule || "Weekly"),
        String(fields["Other Schedule"] || ""),
        String(fields.Schedule || "").toLowerCase() !== "one time",
        boolValue(fields.Active, true),
        fields["Last Generated Date"] || null,
        String(fields.Notes || "")
      ]
    );
  }
}

async function importStandingOrderItems(records, maps) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const standingOrderId = maps.standingOrders.get(record.id);
    if (!standingOrderId) continue;
    const items = parseItemsJson(fields["Items JSON"]);
    for (const item of items) {
      const inventoryItemId = maps.inventoryItems.get(String(item.itemId || ""));
      if (!inventoryItemId) continue;
      await pool.query(
        `
          insert into standing_order_items (standing_order_id, inventory_item_id, quantity)
          values ($1, $2, $3)
          on conflict (standing_order_id, inventory_item_id) do update
            set quantity = excluded.quantity,
                updated_at = now()
        `,
        [standingOrderId, inventoryItemId, toNumeric(item.quantity, 0)]
      );
    }
  }
}

async function importDailyGuestCounts(records) {
  const pool = getPool();
  for (const record of records) {
    const fields = record.fields || {};
    const reportDate = fields.Date || fields["Guest Date"] || fields["Report Date"] || "";
    if (!reportDate) continue;
    const guests = fields["Guest Count"] ?? fields.Guests ?? fields["Guest Total"] ?? fields["Daily Guests"];
    await pool.query(
      `
        insert into daily_guest_counts (
          external_id, report_date, guests, notes, entered_by_username, entered_at
        )
        values ($1, $2, $3, $4, $5, $6)
        on conflict (external_id) do update
          set report_date = excluded.report_date,
              guests = excluded.guests,
              notes = excluded.notes,
              entered_by_username = excluded.entered_by_username,
              entered_at = excluded.entered_at
      `,
      [
        record.id,
        reportDate,
        Math.max(0, Math.round(toNumeric(guests, 0))),
        String(fields.Notes || fields["Guest Notes"] || ""),
        String(fields["Entered By"] || fields["Created By"] || fields.User || ""),
        fields["Entered At"] || fields["Created At"] || fields.Timestamp || new Date().toISOString()
      ]
    );
  }
}

async function main() {
  const pool = getPool();
  const tables = await getMetaTables();

  const categoriesTable = findTable(tables, "Categories");
  const storageLocationsTable = findTable(tables, "Storage Locations");
  const inventoryAreasTable = findTable(tables, "Inventory Areas");
  const shelfCodesTable = findTable(tables, "Shelf Codes");
  const unitsTable = findTable(tables, "Unit Of Measurement", "Units Of Measurement", "Units");
  const appUsersTable = appUsersTableIdFromEnv
    ? tables.find((table) => table.id === appUsersTableIdFromEnv) || null
    : findTable(tables, "App Users");
  const stockCountsTable = findTable(tables, "Stock Counts");
  const standingOrdersTable = findTable(tables, "Standing Orders");
  const driverLinesTable = findTable(tables, "Driver Sheet Lines");
  const dailyGuestCountsTable = findTable(tables, "Daily Guest Counts", "Daily Guests", "Guest Counts", "Daily Guest Count");

  console.log("Loading Airtable data...");
  const [
    supplierRecords,
    categoryRecords,
    storageLocationRecords,
    inventoryAreaRecords,
    unitRecords,
    shelfCodeRecords,
    appUserRecords,
    inventoryRecords,
    requestRecords,
    driverLineRecords,
    stockCountRecords,
    standingOrderRecords,
    dailyGuestRecords
  ] = await Promise.all([
    listAllRecords(suppliersTableId),
    categoriesTable ? listAllRecords(categoriesTable.id) : Promise.resolve([]),
    storageLocationsTable ? listAllRecords(storageLocationsTable.id) : Promise.resolve([]),
    inventoryAreasTable ? listAllRecords(inventoryAreasTable.id) : Promise.resolve([]),
    unitsTable ? listAllRecords(unitsTable.id) : Promise.resolve([]),
    shelfCodesTable ? listAllRecords(shelfCodesTable.id) : Promise.resolve([]),
    appUsersTable ? listAllRecords(appUsersTable.id) : Promise.resolve([]),
    listAllRecords(inventoryTableId),
    listAllRecords(requestsTableId),
    driverLinesTable ? listAllRecords(driverLinesTable.id) : Promise.resolve([]),
    stockCountsTable ? listAllRecords(stockCountsTable.id) : Promise.resolve([]),
    standingOrdersTable ? listAllRecords(standingOrdersTable.id) : Promise.resolve([]),
    dailyGuestCountsTable ? listAllRecords(dailyGuestCountsTable.id) : Promise.resolve([])
  ]);

  console.log("Importing lookup tables...");
  await pool.query("begin");
  try {
    await importSuppliers(supplierRecords);
    await upsertLookup("categories", categoryRecords, { primaryField: "Category", sortField: "Sort Order" });
    await upsertLookup("storage_locations", storageLocationRecords, { primaryField: "Storage Location", sortField: "Sort Order" });
    await upsertLookup("inventory_areas", inventoryAreaRecords, { primaryField: "Inventory Area", sortField: "Sort Order" });
    await importUnits(unitRecords);

    const storageLocationsMap = await queryMap("select external_id, id from storage_locations where external_id is not null");
    await importShelfCodes(shelfCodeRecords, storageLocationsMap);

    if (appUserRecords.length) {
      await importAppUsers(appUserRecords);
    }

    const maps = {
      suppliers: await queryMap("select external_id, id from suppliers where external_id is not null"),
      suppliersByName: new Map((await pool.query("select lower(name) as key, id from suppliers")).rows.map((row) => [row.key, row.id])),
      categories: await queryMap("select external_id, id from categories where external_id is not null"),
      storageLocations: storageLocationsMap,
      shelfCodes: await queryMap("select external_id, id from shelf_codes where external_id is not null"),
      inventoryAreas: await queryMap("select external_id, id from inventory_areas where external_id is not null"),
      units: await queryMap("select external_id, id from units_of_measure where external_id is not null"),
      unitsByName: new Map((await pool.query("select lower(name) as key, id from units_of_measure")).rows.map((row) => [row.key, row.id]))
    };

    console.log("Importing inventory...");
    await importInventoryItems(inventoryRecords, maps);
    maps.inventoryItems = await queryMap("select external_id, id from inventory_items where external_id is not null");

    console.log("Importing requests...");
    await importRequests(requestRecords, maps);
    maps.requests = await queryMap("select external_id, id from order_requests where external_id is not null");

    if (driverLineRecords.length) {
      console.log("Importing driver sheet lines...");
      await importDriverLines(driverLineRecords, maps);
    }

    if (stockCountRecords.length) {
      console.log("Importing stock counts...");
      await importStockCounts(stockCountRecords, maps);
    }

    if (standingOrderRecords.length) {
      console.log("Importing standing orders...");
      await importStandingOrders(standingOrderRecords, maps);
      maps.standingOrders = await queryMap("select external_id, id from standing_orders where external_id is not null");
      await importStandingOrderItems(standingOrderRecords, maps);
    }

    if (dailyGuestRecords.length) {
      console.log("Importing daily guest counts...");
      await importDailyGuestCounts(dailyGuestRecords);
    }

    await pool.query("commit");
    console.log("Airtable import completed.");
    console.log(JSON.stringify({
      suppliers: supplierRecords.length,
      categories: categoryRecords.length,
      storageLocations: storageLocationRecords.length,
      inventoryAreas: inventoryAreaRecords.length,
      units: unitRecords.length,
      shelfCodes: shelfCodeRecords.length,
      appUsers: appUserRecords.length,
      inventoryItems: inventoryRecords.length,
      requests: requestRecords.length,
      driverSheetLines: driverLineRecords.length,
      stockCounts: stockCountRecords.length,
      standingOrders: standingOrderRecords.length,
      dailyGuestCounts: dailyGuestRecords.length
    }, null, 2));
  } catch (error) {
    await pool.query("rollback");
    throw error;
  } finally {
    await closePool();
  }
}

await main();
