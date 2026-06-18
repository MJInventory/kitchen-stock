import "./lib/load-env.js";
import http from "node:http";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import webpush from "web-push";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountingInbox,
  allowedUnits,
  appTimeZone,
  appUsersTableIdFromEnv,
  appVersion,
  authSecret,
  backofficeMenuOptions,
  baseId,
  brevoApiKey,
  editableUserSources,
  gotoMenuOptions,
  inventoryTableId,
  invoiceOcrRulesTableId,
  isRender,
  itemCacheMs,
  lookupConfigs,
  mailFrom,
  mimeTypes,
  ocrSpaceApiKey,
  port,
  requestCacheMs,
  requestsTableId,
  sessionMaxAgeMs,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpSecure,
  smtpUser,
  suppliersTableId,
  token,
  userConfig,
  vapidPrivateKey,
  vapidPublicKey,
  vapidSubject
} from "./lib/app-config.js";
import { getPool, postgresEnabled } from "./lib/postgres.js";
import { ensurePostgresSchemaUpgrades as applyPostgresSchemaUpgrades } from "./lib/postgres-schema.js";
import { createViewHelpers } from "./lib/view-helpers.js";
import { createPageRouteBuilder } from "./lib/page-routes.js";
import { createRenderer } from "./lib/rendering.js";
import { createHttpHelpers } from "./lib/http-helpers.js";
import { createUserHelpers } from "./lib/user-helpers.js";
import { createAuditLogHelpers } from "./lib/audit-log.js";
import { createPostgresRowMappers } from "./lib/postgres-row-mappers.js";
import { createSupplierDomain } from "./lib/supplier-domain.js";
import { createInventoryDomain } from "./lib/inventory-domain.js";
import { createLookupAdminDomain } from "./lib/lookup-admin-domain.js";
import { createLegacySchemaDomain } from "./lib/legacy-schema-domain.js";
import { createAppUserDomain } from "./lib/app-user-domain.js";
import { createAppUserService } from "./lib/app-user-service.js";
import { createAppUserApi } from "./lib/app-user-api.js";
import { createSetupAdminApi } from "./lib/setup-admin-api.js";
import { createOperationsApi } from "./lib/operations-api.js";
import { createMutationApi } from "./lib/mutation-api.js";
import { createWorkflowApi } from "./lib/workflow-api.js";
import { createNotificationDomain } from "./lib/notification-domain.js";
import { createReportSupportDomain } from "./lib/report-support-domain.js";
import { createSheetDomain } from "./lib/sheet-domain.js";
import { createRequestItemService } from "./lib/request-item-service.js";
import { createLegacySheetDomain } from "./lib/legacy-sheet-domain.js";
import { createStandingOrderDomain } from "./lib/standing-order-domain.js";
import {
  standingSupplierFromNotes,
  standingRunIdFromNotes,
  standingRunLineIdFromNotes,
  isStandingOrderRequestRow
} from "./lib/standing-order-helpers.js";
import { createRequestDomain } from "./lib/request-domain.js";
import { createInternalOrderDomain } from "./lib/internal-order-domain.js";
import { createInvoiceDomain } from "./lib/invoice-domain.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const viewsDir = join(__dirname, "views");

const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);
if (pushEnabled) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const cache = {
  items: { expiresAt: 0, value: null, pending: null },
  requests: { expiresAt: 0, value: null, pending: null },
  suppliers: { expiresAt: 0, value: null, pending: null },
  appUsers: { expiresAt: 0, value: null, pending: null },
  lookups: { expiresAt: 0, value: null, pending: null },
  schema: { expiresAt: 0, value: null, pending: null }
};

const metrics = {
  airtableCalls: 0,
  cacheHits: { items: 0, requests: 0, suppliers: 0, lookups: 0, schema: 0 }
};


function db() {
  return getPool();
}

function normalizeNotificationAreaName(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "bar") return "bar";
  if (raw === "foh" || raw === "front of house" || raw === "front-house") return "foh";
  if (raw === "kitchen") return "kitchen";
  if (raw === "general") return "general";
  return "";
}

function clampOpenOrderDays(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, parsed));
}

function normalizeHiddenMenuItems(values, allowedValues) {
  const allowed = new Set(allowedValues);
  const list = Array.isArray(values)
    ? values
    : String(values || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  return [...new Set(list.filter((entry) => allowed.has(entry)))];
}

function hasPostgres() {
  return postgresEnabled();
}

async function ensurePostgresSchemaUpgrades() {
  return applyPostgresSchemaUpgrades({ hasPostgres, db });
}

function isValidId(value) {
  return /^[a-z0-9-]+$/i.test(String(value || "").trim());
}

function isoDate(value) {
  return String(value || "").slice(0, 10);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

const {
  cleanAuditSnapshot,
  auditChanged,
  pgRecordAuditEntry,
  pgListAuditEntries
} = createAuditLogHelpers({
  ensurePostgresSchemaUpgrades,
  db,
  todayIso
});

const {
  normalizeRole,
  userPermissions,
  presentUserName,
  publicUser,
  mapPgAppUserRow,
  createSession,
  verifySession,
  storeSession
} = createUserHelpers({
  userConfig,
  editableUserSources,
  gotoMenuOptions,
  backofficeMenuOptions,
  authSecret,
  sessionMaxAgeMs,
  clampOpenOrderDays,
  normalizeHiddenMenuItems
});

const {
  bearerUser,
  requireUser,
  requireRole,
  send,
  readJson
} = createHttpHelpers({
  verifySession
});

const {
  pgNumber,
  pgItemFromRow,
  pgRequestFromRow,
  pgDriverLineFromRow,
  pgStandingOrderFromRow
} = createPostgresRowMappers();
const {
  pgListSuppliers,
  pgListSuppliersAdmin,
  pgSaveSupplier,
  pgDeleteSupplier,
  pgFindOrCreateSupplierByName
} = createSupplierDomain({
  db,
  cache,
  isValidId,
  auditChanged,
  pgRecordAuditEntry
});
const {
  pgListLookup,
  pgListLookups,
  pgListItems,
  pgFindOrCreateLookupRecord,
  pgResolveShelfCodeRecord,
  pgUpdateItemSettings,
  pgDeleteInventoryItem,
  pgCreateInventoryItem,
  pgItemFormOptions
} = createInventoryDomain({
  db,
  cache,
  pgItemFromRow,
  allowedUnits,
  isValidId,
  auditChanged,
  pgRecordAuditEntry,
  getSuppliers: () => getSuppliers(),
  getLookups: () => getLookups(),
  listShelfCodesAdmin: () => listShelfCodesAdmin()
});
const {
  normalizeLegacyAppUser,
  legacyAppUserUpdateFields,
  canChangeAppUserRole,
  canDeleteAppUserRecord,
  pgListAppUsers,
  pgFindAppUserByName,
  pgCreateAppUser,
  pgUpdateAppUser,
  pgDeleteAppUser,
  pgChangeOwnPassword,
  pgGetOwnSettings,
  pgUpdateOwnSettings,
  pgRecordSuccessfulLogin,
  pgGetDedicatedDriverName,
  pgGetAssignedDriverName,
  pgResolveDriverName
} = createAppUserDomain({
  ensurePostgresSchemaUpgrades,
  db,
  cache,
  isValidId,
  mapPgAppUserRow,
  normalizeRole,
  clampOpenOrderDays,
  normalizeHiddenMenuItems,
  gotoMenuOptions,
  backofficeMenuOptions,
  publicUser,
  auditChanged,
  pgRecordAuditEntry,
  presentUserName,
  todayIso
});
const {
  getAppUsersTableId,
  listAppUsers,
  getAppUsers,
  findAppUserByName,
  refreshUserFromDirectory,
  findAppUserById,
  createAppUser,
  changeOwnPassword,
  updateAppUser,
  deleteAppUser
} = createAppUserService({
  appUsersTableIdFromEnv,
  airtable,
  cache,
  cached,
  getSchema: () => getSchema(),
  hasPostgres,
  normalizeLegacyAppUser,
  legacyAppUserUpdateFields,
  pgListAppUsers,
  pgFindAppUserByName,
  pgCreateAppUser,
  pgUpdateAppUser,
  pgDeleteAppUser,
  pgChangeOwnPassword
});
const {
  pgListNotificationsForUser,
  pgMarkNotificationsRead,
  pgCreateNotificationsForUsers,
  pgListPushSubscriptionsForUserId,
  pgSavePushSubscription,
  pgRemovePushSubscription,
  pushNotificationToUser,
  pgNotificationUsers,
  pgAreasForInventoryItemIds
} = createNotificationDomain({
  ensurePostgresSchemaUpgrades,
  db,
  isValidId,
  pushEnabled,
  webpush,
  pgFindAppUserByName,
  normalizeNotificationAreaName
});
const {
  pgListSupplierDeliveryNotes,
  pgSaveSupplierDeliveryNote,
  pgGetDailyGuestCount,
  pgSaveDailyGuestCount
} = createReportSupportDomain({
  ensurePostgresSchemaUpgrades,
  db,
  pgRecordAuditEntry,
  todayIso
});
let pgCloseStandingOrderRunIfCompleteTx = null;
const {
  pgListRequests,
  pgListOpenRequests,
  pgCreateRequest,
  pgCreateRequestsBatch,
  pgCreateStockCount,
  pgDeliverRequest,
  pgDeleteRequest
} = createRequestDomain({
  db,
  cache,
  allowedUnits,
  isValidId,
  pgRequestFromRow,
  pgNumber,
  pgRecordAuditEntry,
  pgAreasForInventoryItemIds,
  pgNotificationUsers,
  pgCreateNotificationsForUsers,
  presentUserName,
  getPgCloseStandingOrderRunIfCompleteTx: () => pgCloseStandingOrderRunIfCompleteTx
});
const {
  pgRepairStandingOrderStates,
  pgListStandingOrders,
  pgListStandingOrderRuns,
  pgStandingOrderFields,
  pgSaveStandingOrderDefinition,
  pgUpdateStandingOrderRecord,
  pgRebuildStandingOrderRunTx,
  pgSyncStandingOrderRunsForDate,
  pgSyncStandingOrderRunsForOrder,
  pgDeleteStandingOrder,
  pgGenerateStandingOrdersForDate,
  pgCloseStandingOrderRunIfCompleteTx: closeStandingOrderRunIfCompleteTx
} = createStandingOrderDomain({
  db,
  cache,
  todayIso,
  isValidId,
  ensurePostgresSchemaUpgrades,
  pgStandingOrderFromRow,
  pgFindOrCreateSupplierByName,
  pgCreateRequest,
  pgCreateNotificationsForUsers,
  pgNotificationUsers,
  pgRecordAuditEntry
});
pgCloseStandingOrderRunIfCompleteTx = closeStandingOrderRunIfCompleteTx;
const {
  pgEnsureDriverSheetLines,
  pgDriverSheetRequests,
  pgListDriverSheet,
  pgListReceivingSheet,
  pgListOrderReport,
  pgAssignDriverToSheet,
  pgUpdateDriverLine,
  pgDeliverDriverLine
} = createSheetDomain({
  db,
  cache,
  appTimeZone,
  todayIso,
  isValidId,
  allowedUnits,
  presentUserName,
  auditChanged,
  pgRecordAuditEntry,
  pgResolveDriverName,
  pgGenerateStandingOrdersForDate,
  pgSyncStandingOrderRunsForDate,
  pgListSuppliers,
  pgListSupplierDeliveryNotes,
  pgGetDailyGuestCount,
  pgListStandingOrders,
  pgListAuditEntries,
  pgDriverLineFromRow,
  pgRequestFromRow,
  isStandingOrderRequestRow,
  pgDeliverRequest,
  pgNotificationUsers,
  pgCreateNotificationsForUsers,
  pgCloseStandingOrderRunIfCompleteTx
});

let requestItemService = null;

function normalizeDriverLine(...args) {
  return requestItemService.normalizeDriverLine(...args);
}

function updateItemPrimarySupplier(...args) {
  return requestItemService.updateItemPrimarySupplier(...args);
}

function deliverRequest(...args) {
  return requestItemService.deliverRequest(...args);
}

const {
  assignLegacyDriverToSheet,
  persistLegacyDriverSheetLines,
  listLegacyDriverSheetLines,
  updateLegacyDriverLine,
  deliverLegacyDriverLine
} = createLegacySheetDomain({
  airtable,
  getSchema: () => getSchema(),
  listAirtableRecords,
  normalizeDriverLine,
  standingSupplierFromNotes,
  standingRunIdFromNotes,
  standingRunLineIdFromNotes,
  getSuppliers: () => getSuppliers(),
  updateItemPrimarySupplier,
  allowedUnits,
  deliverRequest,
  patchStandingOrderRunLine: undefined,
  closeStandingOrderRunIfComplete: undefined
});
const {
  normalizeCreatedRequest,
  normalizeRequest,
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
  createInventoryItem,
  createStockCount,
  markRequestReceived,
  deliverDriverLine,
  updateDriverLine,
  deleteRequest,
  canDeleteRequest
} = (requestItemService = createRequestItemService({
  db,
  hasPostgres,
  airtable,
  cache,
  requestsTableId,
  inventoryTableId,
  allowedUnits,
  listAirtableRecords,
  getSchema: () => getSchema(),
  getItems: () => getItems(),
  getSuppliers: () => getSuppliers(),
  getLookups: () => getLookups(),
  normalizeItem,
  findOrCreateLookupRecord: (lookupKey, value) => findOrCreateLookupRecord(lookupKey, value),
  resolveShelfCodeRecord: (shelfCode, storageLocation) => resolveShelfCodeRecord(shelfCode, storageLocation),
  saveStandingOrderDefinition: (payload, user) => saveStandingOrderDefinition(payload, user),
  generateStandingOrdersForDate: (selectedDate, userName = "System") => generateStandingOrdersForDate(selectedDate, userName),
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
}));
const {
  pgListInternalOrders,
  pgCreateInternalOrder,
  pgRefreshInternalOrderBatchStatusTx,
  pgUpsertAutoMinimumRequestTx,
  pgUpdateInternalOrderPicking,
  pgUpdateInternalOrderRequest
} = createInternalOrderDomain({
  ensurePostgresSchemaUpgrades,
  db,
  cache,
  isValidId,
  normalizeRole,
  presentUserName,
  todayIso,
  getAppUsers,
  pgCreateNotificationsForUsers,
  pgRecordAuditEntry,
  pgEnsureDriverSheetLines
});

function publicUserForAdmin(user, actor = null) {
  const editable = editableUserSources.has(user.source);
  const canEditRole = actor ? canChangeAppUserRole(actor, user, user.role) : true;
  return {
    ...publicUser(user),
    id: user.id || "",
    lastLoginAt: user.lastLoginAt || "",
    isDriver: Boolean(user.isDriver),
    isPicker: Boolean(user.isPicker),
    notifyOnNewOrders: Boolean(user.notifyOnNewOrders),
    notifyOnDelivery: user.notifyOnDelivery !== false,
    notifyAreas: {
      bar: user.notifyAreas?.bar !== false,
      foh: user.notifyAreas?.foh !== false,
      kitchen: user.notifyAreas?.kitchen !== false,
      general: user.notifyAreas?.general !== false
    },
    editable,
    canEditRole,
    canSave: editable && (canEditRole || normalizeRole(user.role) === "user" || normalizeRole(user.role) === "power-user"),
    canDelete: actor ? canDeleteAppUserRecord(actor, user) && String(actor.name || "").toLowerCase() !== String(user.name || "").toLowerCase() : false
  };
}

const handleAppUserApi = createAppUserApi({
  bcrypt,
  hasPostgres,
  pushEnabled,
  vapidPublicKey,
  readJson,
  send,
  requireUser,
  requireRole,
  storeSession,
  publicUser,
  publicUserForAdmin,
  canChangeAppUserRole,
  canDeleteAppUserRecord,
  findAppUserByName,
  changeOwnPassword,
  refreshUserFromDirectory,
  pgRecordSuccessfulLogin,
  pgGetOwnSettings,
  pgUpdateOwnSettings,
  pgSavePushSubscription,
  pgRemovePushSubscription,
  getAppUsers,
  createAppUser,
  findAppUserById,
  updateAppUser,
  deleteAppUser
});
const handleOperationsApi = createOperationsApi({
  requireUser,
  requireRole,
  readJson,
  send,
  getItems,
  listOpenRequests,
  listStandingOrders,
  pgListNotificationsForUser,
  pgMarkNotificationsRead,
  listDriverSheet,
  assignDriverToSheet,
  listReceivingSheet,
  pgSaveSupplierDeliveryNote,
  listOrderReport,
  getDailyGuestCount,
  saveDailyGuestCount
});
const handleWorkflowApi = createWorkflowApi({
  requireUser,
  requireRole,
  readJson,
  send,
  getItems: () => getItems(),
  getRequests: () => getRequests(),
  hasPostgres,
  brevoApiKey,
  mailFrom,
  accountingInbox,
  smtpHost,
  smtpUser,
  smtpPass,
  isRender,
  metrics,
  cache,
  createRequest,
  createRequestsBatch,
  pgListInternalOrders,
  pgCreateInternalOrder,
  pgUpdateInternalOrderRequest,
  pgUpdateInternalOrderPicking,
  createStandingOrder,
  listStandingOrders: () => listStandingOrders(),
  listStandingOrderRuns: () => listStandingOrderRuns(),
  updateStandingOrderRecord,
  pgDeleteStandingOrder
});

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

async function listItems() {
  return pgListItems();
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

async function listSuppliers() {
  return pgListSuppliers();
}

async function listSuppliersAdmin() {
  return pgListSuppliersAdmin();
}

async function saveSupplier(payload, recordId = "", actorUsername = "") {
  return pgSaveSupplier(payload, recordId, actorUsername);
}

async function deleteSupplier(recordId, actorUsername = "") {
  return pgDeleteSupplier(recordId, actorUsername);
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

const {
  ocrSpaceParseImage,
  createInvoiceCapture,
  createInvoiceLine,
  listOcrRules,
  createOcrRule,
  emailInvoicePicture
} = createInvoiceDomain({
  nodemailer,
  accountingInbox,
  brevoApiKey,
  db,
  getItems: () => getItems(),
  getSchema: () => getSchema(),
  hasPostgres,
  inventoryTableId,
  invoiceOcrRulesTableId,
  isRender,
  isValidId,
  mailFrom,
  ocrSpaceApiKey,
  pgFindOrCreateSupplierByName,
  pgNumber,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpSecure,
  smtpUser,
  airtable
});

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

async function itemFormOptions() {
  return pgItemFormOptions();
}

const handleSetupAdminApi = createSetupAdminApi({
  requireUser,
  requireRole,
  readJson,
  send,
  itemFormOptions,
  listStorageLocationsAdmin,
  listCategoriesAdmin,
  listSuppliersAdmin,
  listShelfCodesAdmin,
  saveStorageLocation,
  saveCategory,
  deleteCategory,
  saveShelfCode,
  saveSupplier,
  deleteSupplier
});

const handleMutationApi = createMutationApi({
  requireUser,
  requireRole,
  readJson,
  send,
  updateItemSettings,
  deleteInventoryItem,
  createInventoryItem,
  createStockCount,
  createInvoiceCapture,
  createInvoiceLine,
  listOcrRules,
  createOcrRule,
  emailInvoicePicture,
  ocrSpaceParseImage,
  deliverRequest,
  updateDriverLine,
  deliverDriverLine,
  canDeleteRequest,
  deleteRequest
});

async function listStandingOrders() {
  return pgListStandingOrders();
}

async function getDailyGuestCount(date) {
  return pgGetDailyGuestCount(date);
}

async function saveDailyGuestCount(payload, user) {
  return pgSaveDailyGuestCount(payload, user);
}

async function listStandingOrderRuns(limit = 50) {
  return pgListStandingOrderRuns(limit);
}

async function updateStandingOrderRecord(recordId, payload, user) {
  return pgUpdateStandingOrderRecord(recordId, payload, user);
}

async function saveStandingOrderDefinition(payload, user) {
  return pgSaveStandingOrderDefinition(payload, user);
}

async function generateStandingOrdersForDate(selectedDate, userName = "System") {
  return pgGenerateStandingOrdersForDate(selectedDate, userName);
}

async function getLookups() {
  return pgListLookups();
}

async function findOrCreateLookupRecord(lookupKey, value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  if (hasPostgres()) {
    return pgFindOrCreateLookupRecord(lookupKey, cleaned);
  }

  let lookups = await getLookups();
  const lookup = lookups[lookupKey];
  if (!lookup?.tableId) return "";

  const existing = lookup.byName.get(cleaned.toLowerCase());
  if (existing) return existing.id;

  const record = await airtable(lookup.tableId, {
    method: "POST",
    body: JSON.stringify({ fields: { [lookup.primaryField]: cleaned } })
  });

  cache.lookups.expiresAt = 0;
  cache.schema.expiresAt = 0;
  return record.id;
}

const viewHelpers = createViewHelpers(viewsDir);
const buildPageRoute = createPageRouteBuilder(viewHelpers);
const { renderView, serveStatic } = createRenderer({
  publicDir,
  viewsDir,
  appVersion,
  assetWithVersion: viewHelpers.assetWithVersion,
  mimeTypes,
  send
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/storage-locations.html") {
      res.writeHead(302, { Location: "/shelf-codes.html" });
      res.end();
      return;
    }

    if (req.method === "GET") {
      const pageRoute = await buildPageRoute(req.url);
      if (pageRoute) {
        await renderView(res, pageRoute.view, pageRoute.options);
        return;
      }
    }

    if (await handleAppUserApi(req, res)) return;
    if (await handleSetupAdminApi(req, res)) return;
    if (await handleOperationsApi(req, res)) return;
    if (await handleMutationApi(req, res)) return;
    if (await handleWorkflowApi(req, res)) return;

    await serveStatic(req, res);
  } catch (error) {
    send(res, 400, { error: error.message });
  }
});

async function startServer() {
  if (hasPostgres()) {
    await ensurePostgresSchemaUpgrades();
  }
  server.listen(port, () => {
    console.log(`Kitchen inventory web app running at http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
