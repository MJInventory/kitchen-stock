export function createRuntimeDataHelpers({
  token,
  baseId,
  metrics,
  cache,
  itemCacheMs,
  requestCacheMs,
  pgListItems,
  pgListSuppliers,
  pgListRequests,
  pgListOpenRequests
}) {
  async function airtable(path, options = {}) {
    if (!token) {
      throw new Error("AIRTABLE_TOKEN is not set.");
    }

    metrics.airtableCalls += 1;

    const url = options.meta
      ? `https://api.airtable.com/v0/meta/bases/${baseId}/${path}`
      : `https://api.airtable.com/v0/${baseId}/${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = data?.error?.message || response.statusText;
      throw new Error(`${response.status} ${message}`);
    }

    return data;
  }

  async function listAirtableRecords(tableId, params = {}) {
    const records = [];
    let offset = "";

    do {
      const query = new URLSearchParams({
        pageSize: "100",
        ...params
      });

      if (offset) {
        query.set("offset", offset);
      }

      const data = await airtable(`${tableId}?${query}`);
      records.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);

    return records;
  }

  function linkedValue(record, linkFieldName, fallbackFieldName, lookupMap) {
    const linkedId = record.fields[linkFieldName]?.[0] || "";
    return lookupMap?.byId?.get(linkedId)?.name || record.fields[fallbackFieldName] || "";
  }

  function normalizeItem(record, supplierById, lookups) {
    const supplierId = record.fields["Supplier/Vendor"]?.[0] || "";
    const supplier = supplierById.get(supplierId);

    return {
      id: record.id,
      name: record.fields["Item Name"] || "",
      category: linkedValue(record, "Category Link", "Category", lookups.categories) || record.fields.Category || "",
      categoryId: record.fields["Category Link"]?.[0] || "",
      storageLocation: linkedValue(record, "Storage Location Link", "Storage Location", lookups.storageLocations),
      storageLocationId: record.fields["Storage Location Link"]?.[0] || "",
      inventoryArea: linkedValue(record, "Inventory Area Link", "Inventory Area", lookups.inventoryAreas),
      inventoryAreaId: record.fields["Inventory Area Link"]?.[0] || "",
      inventorySubgroup: linkedValue(record, "Inventory Subgroup Link", "Inventory Subgroup", lookups.inventorySubgroups),
      inventorySubgroupId: record.fields["Inventory Subgroup Link"]?.[0] || "",
      shelfCode: linkedValue(record, "Shelf Code Link", "Shelf Code", lookups.shelfCodes),
      shelfCodeId: record.fields["Shelf Code Link"]?.[0] || "",
      supplierId,
      supplierName: supplier?.name || "Unassigned Supplier",
      supplierContact: supplier?.contact || "",
      quantity: record.fields["Current Quantity"] ?? null,
      unit: linkedValue(record, "Unit Of Measurement Link", "Unit of Measure", lookups.unitOfMeasurement),
      minimum: record.fields["Minimum Threshold"] ?? null
    };
  }

  async function listItems() {
    return pgListItems();
  }

  async function listSuppliers() {
    return pgListSuppliers();
  }

  async function listRequests() {
    return pgListRequests();
  }

  async function listOpenRequests() {
    return pgListOpenRequests();
  }

  async function cached(key, ttlMs, loader) {
    const entry = cache[key];
    const now = Date.now();

    if (entry.value && entry.expiresAt > now) {
      metrics.cacheHits[key] += 1;
      return entry.value;
    }

    if (!entry.pending) {
      entry.pending = loader()
        .then((value) => {
          entry.value = value;
          entry.expiresAt = Date.now() + ttlMs;
          return value;
        })
        .finally(() => {
          entry.pending = null;
        });
    }

    return entry.pending;
  }

  async function getItems() {
    return cached("items", itemCacheMs, listItems);
  }

  async function getSuppliers() {
    return cached("suppliers", Math.min(itemCacheMs, 60000), listSuppliers);
  }

  async function getRequests() {
    return cached("requests", requestCacheMs, listRequests);
  }

  return {
    airtable,
    listAirtableRecords,
    linkedValue,
    normalizeItem,
    listItems,
    listSuppliers,
    listRequests,
    listOpenRequests,
    cached,
    getItems,
    getSuppliers,
    getRequests
  };
}
