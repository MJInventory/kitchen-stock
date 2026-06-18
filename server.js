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
import { createNotificationDomain } from "./lib/notification-domain.js";
import { createReportSupportDomain } from "./lib/report-support-domain.js";
import { createSheetDomain } from "./lib/sheet-domain.js";
import { createLegacySheetDomain } from "./lib/legacy-sheet-domain.js";
import { createStandingOrderDomain } from "./lib/standing-order-domain.js";
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
} = createPostgresRowMappers({
  standingRunIdFromNotes,
  standingRunLineIdFromNotes
});
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

async function getAppUsersTableId() {
  if (appUsersTableIdFromEnv) return appUsersTableIdFromEnv;
  const schema = await getSchema();
  return schema.tables.appUsers || "";
}

async function listAppUsers() {
  return pgListAppUsers();
}

async function getAppUsers() {
  return cached("appUsers", 30 * 1000, listAppUsers);
}

async function findAppUserByName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const user = await pgFindAppUserByName(normalized);
  return user && user.active !== false ? user : null;
}

async function refreshUserFromDirectory(user) {
  const freshUser = await findAppUserByName(user?.name);
  if (!freshUser) return user;
  return freshUser;
}

async function findAppUserById(recordId) {
  const appUsers = await getAppUsers();
  return appUsers.find((user) => user.id === recordId);
}

async function createAppUser(payload, actorUsername = "") {
  return pgCreateAppUser(payload, actorUsername);
}

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

async function changeOwnPassword(userName, currentPassword, newPassword, options = {}) {
  return pgChangeOwnPassword(userName, currentPassword, newPassword, options);
}

async function itemFormOptions() {
  return pgItemFormOptions();
}

async function listStandingOrders() {
  return pgListStandingOrders();
}

async function getDailyGuestCount(date) {
  return pgGetDailyGuestCount(date);
}

async function saveDailyGuestCount(payload, user) {
  return pgSaveDailyGuestCount(payload, user);
}

function standingSupplierFromNotes(notes) {
  const match = String(notes || "").match(/^Standing supplier:\s*(.+?)\.?$/im);
  return match ? match[1].trim().replace(/\.$/, "") : "";
}

function standingRunIdFromNotes(notes) {
  const match = String(notes || "").match(/^Standing run id:\s*(rec[a-zA-Z0-9]+)\.?$/im);
  return match ? match[1].trim() : "";
}

function standingRunLineIdFromNotes(notes) {
  const match = String(notes || "").match(/^Standing run line id:\s*(rec[a-zA-Z0-9]+)\.?$/im);
  return match ? match[1].trim() : "";
}

function isStandingOrderRequestRow(row) {
  return Boolean(String(row?.standingRunId || "").trim())
    || Boolean(String(row?.standingRunLineId || "").trim())
    || String(row?.requestedBy || "").toLowerCase().includes("standing order")
    || String(row?.notes || "").toLowerCase().includes("standing order");
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

async function updateAppUser(recordId, payload, actorUsername = "") {
  if (hasPostgres()) {
    return pgUpdateAppUser(recordId, payload, actorUsername);
  }
  const tableId = await getAppUsersTableId();
  if (!tableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid app user record.");

  const schema = await getSchema();
  const currentUser = await findAppUserById(recordId);
  if (!currentUser) throw new Error("User was not found.");
  const fields = legacyAppUserUpdateFields(payload, currentUser, schema);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true })
  });
  cache.appUsers.expiresAt = 0;
  return normalizeLegacyAppUser(record);
}

async function deleteAppUser(recordId, actorUsername = "") {
  if (hasPostgres()) {
    return pgDeleteAppUser(recordId, actorUsername);
  }
  const tableId = await getAppUsersTableId();
  if (!tableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid app user record.");
  const result = await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
  cache.appUsers.expiresAt = 0;
  return { id: result.id || recordId, deleted: Boolean(result.deleted) };
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

async function createRequest(payload, requestedByOverride = "") {
  if (hasPostgres()) {
    return pgCreateRequest(payload, requestedByOverride);
  }
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");

  if (!itemId) throw new Error("Choose an item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");

  const schema = await getSchema();
  const fields = {
    "Requested Item": [itemId],
    "Quantity Needed": quantity,
    "Urgency Level": urgency,
    "Requested By": requestedBy,
    "Request Date/Time": new Date().toISOString(),
    Status: "Approved",
    Notes: notes
  };

  const record = await airtable(requestsTableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });

  cache.requests.expiresAt = 0;
  return normalizeCreatedRequest(record);
}

function createRequestFields(payload, schema, requestedByOverride = "") {
  const itemId = String(payload.itemId || "");
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");

  if (!itemId) throw new Error("Choose an item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");

  const fields = {
    "Requested Item": [itemId],
    "Quantity Needed": quantity,
    "Urgency Level": urgency,
    "Requested By": requestedBy,
    "Request Date/Time": new Date().toISOString(),
    Status: "Approved",
    Notes: notes
  };

  return fields;
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

  if (!Number.isFinite(minimum) || minimum < 0) {
    throw new Error("Minimum stock must be zero or greater.");
  }

  if (!allowedUnits.has(unit)) {
    throw new Error("Unit must be box, bag, item, or bottle.");
  }

  const unitRecordId = await findOrCreateLookupRecord("unitOfMeasurement", unit);
  const categoryRecordId = await findOrCreateLookupRecord("categories", category);
  const areaRecordId = await findOrCreateLookupRecord("inventoryAreas", inventoryArea);
  const storageLocationRecordId = await findOrCreateLookupRecord("storageLocations", storageLocation);
  const shelfRecordId = await resolveShelfCodeRecord(shelfCode, storageLocation);
  const fields = {
    "Minimum Threshold": minimum
  };

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

async function deliverRequest(recordId, userName) {
  if (hasPostgres()) {
    return pgDeliverRequest(recordId, userName);
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

async function deliverDriverLine(recordId, requestRecordId, userName) {
  if (hasPostgres()) {
    return pgDeliverDriverLine(recordId, requestRecordId, userName);
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

const viewHelpers = createViewHelpers(viewsDir);
const buildPageRoute = createPageRouteBuilder(viewHelpers);
const { renderView, serveStatic } = createRenderer({
  publicDir,
  viewsDir,
  appVersion,
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

    if (req.method === "POST" && req.url === "/api/login") {
      const payload = await readJson(req);
      const name = String(payload.username || "").trim();
      const password = String(payload.password || "").trim();
      const user = await findAppUserByName(name);

      let validPassword = false;
      if (user) {
        if (user.passwordHash) {
          validPassword = await bcrypt.compare(password, user.passwordHash);
        } else {
          validPassword = user.password === password;
        }
      }

      if (!user || !validPassword) {
        send(res, 401, { error: "Invalid username or password." });
        return;
      }

      if (hasPostgres() && user.id) {
        user.lastLoginAt = await pgRecordSuccessfulLogin(user.id);
      }

      send(res, 200, storeSession(user));
      return;
    }

    if (req.method === "POST" && req.url === "/api/change-password") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const payload = await readJson(req);
      const updatedUser = await changeOwnPassword(user.name, payload.currentPassword, payload.newPassword, {
        forceChange: Boolean(user.mustChangePassword)
      });
      send(res, 200, storeSession(updatedUser));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/me")) {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const freshUser = await refreshUserFromDirectory(user);
      if (freshUser.active === false) {
        send(res, 403, { error: "This user is no longer active." });
        return;
      }
      send(res, 200, storeSession(freshUser));
      return;
    }

    if (req.method === "GET" && req.url === "/api/user-settings") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const settings = hasPostgres()
        ? await pgGetOwnSettings(user.name)
        : publicUser(user).settings;
      send(res, 200, { settings });
      return;
    }

    if (req.method === "PATCH" && req.url === "/api/user-settings") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const payload = await readJson(req);
      const settings = hasPostgres()
        ? await pgUpdateOwnSettings(user.name, payload)
        : publicUser(user).settings;
      send(res, 200, { settings });
      return;
    }

    if (req.method === "GET" && req.url === "/api/push/public-key") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      send(res, 200, { enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : "" });
      return;
    }

    if (req.method === "POST" && req.url === "/api/push/subscribe") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const payload = await readJson(req);
      const result = hasPostgres()
        ? await pgSavePushSubscription(user.name, payload.subscription || {}, req.headers["user-agent"] || "")
        : { ok: false };
      send(res, 200, result);
      return;
    }

    if (req.method === "DELETE" && req.url === "/api/push/subscribe") {
      const user = requireUser(req, res, { allowPasswordChange: true });
      if (!user) return;
      const payload = await readJson(req);
      const result = hasPostgres()
        ? await pgRemovePushSubscription(user.name, payload.endpoint || "")
        : { ok: false, removed: 0 };
      send(res, 200, result);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/app-users")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      send(res, 200, { users: (await getAppUsers()).map((appUser) => publicUserForAdmin(appUser, user)) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/app-users") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      const payload = await readJson(req);
      if (!canChangeAppUserRole(user, { role: "user" }, payload.role)) {
        send(res, 403, { error: "Only God can create admin or god users." });
        return;
      }
      const created = await createAppUser(payload, user.name);
      send(res, 201, { user: publicUserForAdmin(created, user) });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/app-users/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const target = await findAppUserById(recordId);
      if (!target) {
        send(res, 404, { error: "User was not found." });
        return;
      }
      if (!canChangeAppUserRole(user, target, payload.role)) {
        send(res, 403, { error: "Only God can change admin roles. Admins can manage power users and users only." });
        return;
      }
      const updated = await updateAppUser(recordId, payload, user.name);
      send(res, 200, { user: publicUserForAdmin(updated, user) });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/app-users/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can manage users.")) return;
      const recordId = req.url.split("/")[3];
      const target = await findAppUserById(recordId);
      if (!target) {
        send(res, 404, { error: "User was not found." });
        return;
      }
      if (String(target.name || "").toLowerCase() === String(user.name || "").toLowerCase()) {
        send(res, 403, { error: "You cannot delete your own user." });
        return;
      }
      if (!canDeleteAppUserRecord(user, target)) {
        send(res, 403, { error: "Only God can delete admin users. Admins can delete power users and users only." });
        return;
      }
      const result = await deleteAppUser(recordId, user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/items")) {
      if (!requireUser(req, res)) return;
      send(res, 200, { items: await getItems() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/item-form-options")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can add inventory items.")) return;
      send(res, 200, await itemFormOptions());
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/storage-locations")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, { storageLocations: await listStorageLocationsAdmin() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/categories")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, { categories: await listCategoriesAdmin() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/suppliers")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, { suppliers: await listSuppliersAdmin() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/categories") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const category = await saveCategory(await readJson(req), "", user.name);
      send(res, 201, { category });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/suppliers") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const supplier = await saveSupplier(await readJson(req), "", user.name);
      send(res, 201, { supplier });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/categories/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const category = await saveCategory(await readJson(req), recordId, user.name);
      send(res, 200, { category });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/suppliers/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const supplier = await saveSupplier(await readJson(req), recordId, user.name);
      send(res, 200, { supplier });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/setup/suppliers/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const result = await deleteSupplier(recordId, user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/setup/categories/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const result = await deleteCategory(recordId, user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/storage-locations") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const storageLocation = await saveStorageLocation(await readJson(req), "", user.name);
      send(res, 201, { storageLocation });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/storage-locations/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const storageLocation = await saveStorageLocation(await readJson(req), recordId, user.name);
      send(res, 200, { storageLocation });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/shelf-codes")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      send(res, 200, {
        shelfCodes: await listShelfCodesAdmin(),
        storageLocations: await listStorageLocationsAdmin()
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup/shelf-codes") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const shelfCode = await saveShelfCode(await readJson(req), "", user.name);
      send(res, 201, { shelfCode });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/shelf-codes/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can manage setup.")) return;
      const recordId = req.url.split("/")[4];
      const shelfCode = await saveShelfCode(await readJson(req), recordId, user.name);
      send(res, 200, { shelfCode });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/requests")) {
      if (!requireUser(req, res)) return;
      send(res, 200, { requests: await getRequests() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      const user = requireUser(req, res);
      if (!user) return;
      const [items, requests, standingOrders, notifications] = await Promise.all([
        getItems(),
        listOpenRequests(),
        listStandingOrders(),
        pgListNotificationsForUser(user.name)
      ]);
      send(res, 200, {
        items,
        requests,
        notifications,
        standingOrders: standingOrders
          .filter((order) => order.active !== false)
          .sort((a, b) => {
            const dateCompare = String(a.expectedDate || "").localeCompare(String(b.expectedDate || ""));
            if (dateCompare) return dateCompare;
            const supplierCompare = String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
            if (supplierCompare) return supplierCompare;
            return String(a.name || "").localeCompare(String(b.name || ""));
          })
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/notifications/read") {
      const user = requireUser(req, res);
      if (!user) return;
      const payload = await readJson(req);
      const result = await pgMarkNotificationsRead(user.name, payload.ids || []);
      send(res, 200, { result, notifications: await pgListNotificationsForUser(user.name) });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/driver-sheet")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listDriverSheet(url.searchParams.get("date")));
      return;
    }

    if (req.method === "PATCH" && req.url === "/api/driver-sheet/driver") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can assign a driver.")) return;
      const payload = await readJson(req);
      send(res, 200, await assignDriverToSheet(payload.date, payload.driverName, user));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/receiving-sheet")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listReceivingSheet(url.searchParams.get("date")));
      return;
    }

    if (req.method === "POST" && req.url === "/api/receiving-notes") {
      const user = requireUser(req, res);
      if (!user) return;
      const note = await pgSaveSupplierDeliveryNote(await readJson(req), user.name);
      send(res, 200, { note });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/order-report")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listOrderReport(url.searchParams.get("date")));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/daily-guests")) {
      if (!requireUser(req, res)) return;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, { guestCount: await getDailyGuestCount(url.searchParams.get("date")) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/daily-guests") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can enter daily guest counts.")) return;
      const guestCount = await saveDailyGuestCount(await readJson(req), user);
      send(res, 200, { guestCount });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/health")) {
      send(res, 200, {
        ok: true,
        backend: hasPostgres() ? "postgres" : "airtable",
        email: {
          provider: brevoApiKey ? "Brevo API" : "SMTP",
          hasBrevoApiKey: Boolean(brevoApiKey),
          hasMailFrom: Boolean(mailFrom),
          hasAccountingInbox: Boolean(accountingInbox),
          smtpConfigured: Boolean(smtpHost && smtpUser && smtpPass),
          render: isRender
        },
        metrics,
        cache: {
          itemsCached: Boolean(cache.items.value),
          requestsCached: Boolean(cache.requests.value),
          suppliersCached: Boolean(cache.suppliers.value),
          lookupsCached: Boolean(cache.lookups.value),
          schemaCached: Boolean(cache.schema.value)
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/requests") {
      const user = requireUser(req, res);
      if (!user) return;
      const request = await createRequest(await readJson(req), user.name);
      send(res, 201, { request });
      return;
    }

    if (req.method === "POST" && req.url === "/api/requests/batch") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseSupplierOrdering, "This user can only create internal requests.")) return;
      const requests = await createRequestsBatch(await readJson(req), user.name);
      send(res, 201, { requests });
      return;
    }

    if (req.method === "GET" && req.url === "/api/internal-orders") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPlaceInternalOrders || candidate.permissions.canPickInternalOrders, "This user cannot open internal requests.")) return;
      send(res, 200, { internalOrders: await pgListInternalOrders(user) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/internal-orders") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPlaceInternalOrders, "This user cannot create internal requests.")) return;
      const internalOrder = await pgCreateInternalOrder(await readJson(req), user.name);
      send(res, 201, { internalOrder });
      return;
    }

    if (req.method === "PATCH" && /^\/api\/internal-orders\/[0-9a-f-]+$/i.test(req.url || "")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPlaceInternalOrders, "This user cannot change internal requests.")) return;
      const batchId = req.url.split("/")[3];
      const internalOrder = await pgUpdateInternalOrderRequest(batchId, await readJson(req), user);
      send(res, 200, { internalOrder });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/internal-orders/") && req.url.endsWith("/pick")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPickInternalOrders, "Only pickers can prepare internal requests.")) return;
      const batchId = req.url.split("/")[3];
      const internalOrder = await pgUpdateInternalOrderPicking(batchId, await readJson(req), user.name);
      send(res, 200, { internalOrder });
      return;
    }

    if (req.method === "POST" && req.url === "/api/standing-orders") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can create standing orders.")) return;
      const result = await createStandingOrder(await readJson(req), user);
      send(res, 201, result);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/standing-orders")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can view standing orders.")) return;
      send(res, 200, { standingOrders: await listStandingOrders() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/standing-order-runs")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can view standing order runs.")) return;
      send(res, 200, { runs: await listStandingOrderRuns() });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/standing-orders/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can update standing orders.")) return;
      const recordId = req.url.split("/")[3];
      const standingOrder = await updateStandingOrderRecord(recordId, await readJson(req), user);
      send(res, 200, { standingOrder });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/standing-orders/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can delete standing orders.")) return;
      const recordId = req.url.split("/")[3];
      const result = await pgDeleteStandingOrder(recordId, user);
      send(res, 200, { result });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/items/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can edit inventory setup.")) return;
      const recordId = req.url.split("/")[3];
      const item = await updateItemSettings(recordId, await readJson(req), user.name);
      send(res, 200, { item });
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/items/")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can delete inventory items.")) return;
      const recordId = req.url.split("/")[3];
      const result = await deleteInventoryItem(recordId, user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/items") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can add inventory items.")) return;
      const item = await createInventoryItem(await readJson(req), user.name);
      send(res, 201, { item });
      return;
    }

    if (req.method === "POST" && req.url === "/api/stock-counts") {
      const user = requireUser(req, res);
      if (!user) return;
      const result = await createStockCount(await readJson(req), user.name);
      send(res, 201, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/invoice-captures") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const invoice = await createInvoiceCapture(await readJson(req), user.name);
      send(res, 201, { invoice });
      return;
    }

    if (req.method === "POST" && req.url === "/api/invoice-lines") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const invoiceLine = await createInvoiceLine(await readJson(req), user.name);
      send(res, 201, { invoiceLine });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/ocr-rules")) {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const url = new URL(req.url, "http://localhost");
      const rules = await listOcrRules(url.searchParams.get("supplier"));
      send(res, 200, { rules });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ocr-rules") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const payload = await readJson(req);
      const rule = await createOcrRule(payload, user.name);
      send(res, 201, { rule });
      return;
    }

    if (req.method === "POST" && req.url === "/api/email-invoice") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canSendInvoiceToAccounting, "Only admins can send invoices to accounting.")) return;
      const result = await emailInvoicePicture(await readJson(req), user.name);
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ocr-invoice") {
      const user = requireUser(req, res);
      if (!user) return;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return;
      const result = await ocrSpaceParseImage(await readJson(req));
      send(res, 200, { result });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/receive")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const request = await deliverRequest(recordId, user.name);
      send(res, 200, { request });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const request = await deliverRequest(recordId, user.name);
      send(res, 200, { request });
      return;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/driver-lines/")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const line = await updateDriverLine(recordId, await readJson(req), user.name);
      send(res, 200, { line });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/driver-lines/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const result = await deliverDriverLine(recordId, String(payload.requestId || ""), user.name, {
        quantityReceived: payload.quantityReceived
      });
      send(res, 200, result);
      return;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/requests/")) {
      const user = requireUser(req, res);
      if (!user) return;
      const recordId = req.url.split("/")[3];
      if (!(await canDeleteRequest(recordId, user))) {
        send(res, 403, { error: "Regular users can only remove order lines they added themselves." });
        return;
      }
      const result = await deleteRequest(recordId, user.name);
      send(res, 200, { result });
      return;
    }

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
