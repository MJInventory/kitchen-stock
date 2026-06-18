import { createLegacySchemaDomain } from "./legacy-schema-domain.js";
import { createLookupAdminDomain } from "./lookup-admin-domain.js";
import { createLookupRuntime } from "./server-runtime.js";

export function createAdminLookupRuntime({
  airtable,
  cache,
  requestsTableId,
  lookupConfigs,
  db,
  auditChanged,
  pgRecordAuditEntry,
  pgListLookups,
  pgFindOrCreateLookupRecord,
  pgResolveShelfCodeRecord,
  hasPostgres
}) {
  const {
    listSchema,
    getSchema,
    ensureShelfCodeStorageLocationField
  } = createLegacySchemaDomain({
    airtable,
    cache,
    requestsTableId,
    lookupConfigs
  });

  const {
    getLookups,
    findOrCreateLookupRecord
  } = createLookupRuntime({
    airtable,
    cache,
    hasPostgres,
    pgListLookups,
    pgFindOrCreateLookupRecord
  });

  const {
    listStorageLocationsAdmin,
    listCategoriesAdmin,
    listShelfCodesAdmin,
    resolveShelfCodeRecord,
    saveStorageLocation,
    saveCategory,
    deleteCategory,
    saveShelfCode,
    pgListStorageLocationsAdmin,
    pgListCategoriesAdmin,
    pgListShelfCodesAdmin,
    pgSaveStorageLocation,
    pgSaveCategory,
    pgDeleteCategory,
    pgSaveShelfCode
  } = createLookupAdminDomain({
    db,
    cache,
    auditChanged,
    pgRecordAuditEntry,
    pgFindOrCreateLookupRecord,
    pgResolveShelfCodeRecord,
    hasPostgres,
    airtable,
    getSchema: () => getSchema(),
    ensureShelfCodeStorageLocationField: (schema) => ensureShelfCodeStorageLocationField(schema),
    findOrCreateLookupRecord: (lookupKey, value) => findOrCreateLookupRecord(lookupKey, value),
    getLookups: () => getLookups(),
    getStorageLocationsAdmin: () => listStorageLocationsAdmin()
  });

  return {
    listSchema,
    getSchema,
    ensureShelfCodeStorageLocationField,
    getLookups,
    findOrCreateLookupRecord,
    listStorageLocationsAdmin,
    listCategoriesAdmin,
    listShelfCodesAdmin,
    resolveShelfCodeRecord,
    saveStorageLocation,
    saveCategory,
    deleteCategory,
    saveShelfCode,
    pgListStorageLocationsAdmin,
    pgListCategoriesAdmin,
    pgListShelfCodesAdmin,
    pgSaveStorageLocation,
    pgSaveCategory,
    pgDeleteCategory,
    pgSaveShelfCode
  };
}
