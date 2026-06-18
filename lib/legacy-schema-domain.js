export function createLegacySchemaDomain({
  airtable,
  cache,
  requestsTableId,
  lookupConfigs
}) {
  async function listSchema() {
    const data = await airtable("tables", { meta: true });
    const normalizeFieldName = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    const findFieldName = (tableName, ...candidates) => {
      const table = data.tables.find((entry) => entry.name === tableName);
      if (!table) return "";
      const fields = table.fields || [];
      for (const candidate of candidates) {
        const expected = normalizeFieldName(candidate);
        const match = fields.find((field) => normalizeFieldName(field.name) === expected);
        if (match) return match.name;
      }
      return "";
    };
    const findTable = (...candidates) => {
      for (const candidate of candidates) {
        const expected = normalizeFieldName(candidate);
        const match = data.tables.find((table) => normalizeFieldName(table.name) === expected);
        if (match) return match;
      }
      return null;
    };
    const requests = data.tables.find((table) => table.id === requestsTableId);
    const driverSheetLines = data.tables.find((table) => table.name === "Driver Sheet Lines");
    const appUsers = data.tables.find((table) => table.name === "App Users");
    const standingOrders = data.tables.find((table) => table.name === "Standing Orders");
    const standingOrderRuns = data.tables.find((table) => table.name === "Standing Order Runs");
    const standingOrderRunLines = data.tables.find((table) => table.name === "Standing Order Run Lines");
    const dailyGuestCounts = findTable("Daily Guest Counts", "Daily Guests", "Guest Counts", "Daily Guest Count");
    const requestFields = new Set((requests?.fields || []).map((field) => field.name));
    const driverLineFields = new Set((driverSheetLines?.fields || []).map((field) => field.name));
    const appUserFields = new Set((appUsers?.fields || []).map((field) => field.name));
    const standingOrderFields = new Set((standingOrders?.fields || []).map((field) => field.name));
    const tableByName = new Map(data.tables.map((table) => [table.name, table.id]));
    const fieldsByTableName = new Map(data.tables.map((table) => [table.name, new Set((table.fields || []).map((field) => field.name))]));
    const lookupTables = Object.fromEntries(
      Object.entries(lookupConfigs).map(([key, config]) => [key, tableByName.get(config.tableName) || ""])
    );

    return {
      tables: {
        driverSheetLines: driverSheetLines?.id || "",
        stockCounts: tableByName.get("Stock Counts") || "",
        invoiceCaptures: tableByName.get("Invoice Captures") || "",
        invoiceLines: tableByName.get("Invoice Lines") || "",
        appUsers: tableByName.get("App Users") || "",
        standingOrders: tableByName.get("Standing Orders") || "",
        standingOrderRuns: standingOrderRuns?.id || "",
        standingOrderRunLines: standingOrderRunLines?.id || "",
        dailyGuestCounts: dailyGuestCounts?.id || "",
        ...lookupTables
      },
      requests: {
        hasStorageLocation: requestFields.has("Storage Location"),
        hasInventoryArea: requestFields.has("Inventory Area")
      },
      driverLines: {
        hasDriver: driverLineFields.has("Driver"),
        hasDeliveryDay: driverLineFields.has("Delivery Day"),
        hasDeliveryDate: driverLineFields.has("Delivery Date"),
        hasStandingRunId: driverLineFields.has("Standing Order Run ID"),
        hasStandingRunLineId: driverLineFields.has("Standing Order Run Line ID")
      },
      standingOrders: {
        hasItemsJson: standingOrderFields.has("Items JSON"),
        hasInventoryItem: standingOrderFields.has("Inventory Item"),
        hasInventoryItemRecordId: standingOrderFields.has("Inventory Item Record ID"),
        hasItemName: standingOrderFields.has("Item Name"),
        hasQuantity: standingOrderFields.has("Quantity")
      },
      dailyGuestCounts: {
        tableName: dailyGuestCounts?.name || "",
        dateField: dailyGuestCounts
          ? findFieldName(dailyGuestCounts.name, "Date", "Guest Date", "Report Date")
          : "",
        guestField: dailyGuestCounts
          ? findFieldName(dailyGuestCounts.name, "Guest Count", "Guests", "Guest Total", "Daily Guests")
          : "",
        notesField: dailyGuestCounts
          ? findFieldName(dailyGuestCounts.name, "Notes", "Guest Notes")
          : "",
        enteredByField: dailyGuestCounts
          ? findFieldName(dailyGuestCounts.name, "Entered By", "Created By", "User")
          : "",
        enteredAtField: dailyGuestCounts
          ? findFieldName(dailyGuestCounts.name, "Entered At", "Created At", "Timestamp")
          : ""
      },
      lookupFields: {
        storageLocations: {
          hasActive: fieldsByTableName.get("Storage Locations")?.has("Active") || false
        },
        shelfCodes: {
          storageLocationFieldName: findFieldName("Shelf Codes", "Storage Location", "Storage Locations"),
          storageLocationLinkFieldName: findFieldName("Shelf Codes", "Storage Location Link", "Storage Locations Link", "Storage Location Links"),
          hasStorageLocation: Boolean(findFieldName("Shelf Codes", "Storage Location", "Storage Locations")),
          hasStorageLocationLink: Boolean(findFieldName("Shelf Codes", "Storage Location Link", "Storage Locations Link", "Storage Location Links")),
          hasActive: fieldsByTableName.get("Shelf Codes")?.has("Active") || false
        }
      },
      appUsers: {
        hasTheme: appUserFields.has("Theme"),
        hasActive: appUserFields.has("Active"),
        hasForcePasswordChange: appUserFields.has("Force Password Change")
      }
    };
  }

  async function getSchema() {
    const ttlMs = 10 * 60 * 1000;
    const entry = cache.schema;
    const now = Date.now();
    if (entry.value && entry.expiresAt > now) return entry.value;
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
      try {
        const value = await listSchema();
        entry.value = value;
        entry.expiresAt = now + ttlMs;
        return value;
      } finally {
        entry.pending = null;
      }
    })();
    return entry.pending;
  }

  async function ensureShelfCodeStorageLocationField(schema = null) {
    const currentSchema = schema || await getSchema();
    if (currentSchema.lookupFields.shelfCodes.hasStorageLocation || currentSchema.lookupFields.shelfCodes.hasStorageLocationLink) {
      return currentSchema;
    }

    const shelfCodesTableId = currentSchema.tables.shelfCodes;
    if (!shelfCodesTableId) throw new Error("Shelf Codes table was not found.");

    await airtable(`tables/${shelfCodesTableId}/fields`, {
      meta: true,
      method: "POST",
      body: JSON.stringify({
        name: "Storage Location",
        type: "singleLineText"
      })
    });

    cache.schema.expiresAt = 0;
    cache.lookups.expiresAt = 0;
    return getSchema();
  }

  return {
    listSchema,
    getSchema,
    ensureShelfCodeStorageLocationField
  };
}
