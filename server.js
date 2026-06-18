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
import { createAdminLookupRuntime } from "./lib/admin-lookup-runtime.js";
import {
  clampOpenOrderDays,
  createServerCoreUtils,
  normalizeHiddenMenuItems,
  normalizeNotificationAreaName
} from "./lib/server-core-utils.js";
import { createUserHelpers } from "./lib/user-helpers.js";
import { createAuditLogHelpers } from "./lib/audit-log.js";
import { createPostgresRowMappers } from "./lib/postgres-row-mappers.js";
import { createServerApiHandlers } from "./lib/server-api-runtime.js";
import { createHttpServer } from "./lib/server-runtime.js";
import { createRuntimeDataHelpers } from "./lib/runtime-data.js";
import { createSupplierDomain } from "./lib/supplier-domain.js";
import { createInventoryDomain } from "./lib/inventory-domain.js";
import { createAppUserDomain } from "./lib/app-user-domain.js";
import { createAppUserService } from "./lib/app-user-service.js";
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


const {
  db,
  hasPostgres,
  ensurePostgresSchemaUpgrades,
  isValidId,
  isoDate,
  todayIso
} = createServerCoreUtils({
  appTimeZone,
  postgresEnabled,
  applyPostgresSchemaUpgrades,
  getPool
});

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
} = createRuntimeDataHelpers({
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
  saveStandingOrderDefinition: (payload, user) => pgSaveStandingOrderDefinition(payload, user),
  generateStandingOrdersForDate: (selectedDate, userName = "System") => pgGenerateStandingOrdersForDate(selectedDate, userName),
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
  getAppUsers: (...args) => getAppUsers(...args),
  pgCreateNotificationsForUsers,
  pgRecordAuditEntry,
  pgEnsureDriverSheetLines
});

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
} = createAdminLookupRuntime({
  airtable,
  cache,
  requestsTableId,
  lookupConfigs,
  db,
  auditChanged,
  pgRecordAuditEntry,
  hasPostgres,
  pgListLookups,
  pgFindOrCreateLookupRecord,
  pgResolveShelfCodeRecord
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
  handleAppUserApi,
  handleOperationsApi,
  handleSetupAdminApi,
  handleMutationApi,
  handleWorkflowApi
} = createServerApiHandlers({
  editableUserSources,
  normalizeRole,
  publicUser,
  canChangeAppUserRole,
  canDeleteAppUserRecord,
  bcrypt,
  hasPostgres,
  pushEnabled,
  vapidPublicKey,
  readJson,
  send,
  requireUser,
  requireRole,
  storeSession,
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
  deleteAppUser,
  getItems,
  listOpenRequests: pgListOpenRequests,
  listStandingOrders: () => pgListStandingOrders(),
  pgListNotificationsForUser,
  pgMarkNotificationsRead,
  listDriverSheet,
  assignDriverToSheet,
  listReceivingSheet,
  pgSaveSupplierDeliveryNote,
  listOrderReport,
  getDailyGuestCount: pgGetDailyGuestCount,
  saveDailyGuestCount: pgSaveDailyGuestCount,
  itemFormOptions: pgItemFormOptions,
  listStorageLocationsAdmin,
  listCategoriesAdmin,
  listSuppliersAdmin: pgListSuppliersAdmin,
  listShelfCodesAdmin,
  saveStorageLocation,
  saveCategory,
  deleteCategory,
  saveShelfCode,
  saveSupplier: pgSaveSupplier,
  deleteSupplier: pgDeleteSupplier,
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
  deleteRequest,
  getRequests,
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
  listStandingOrderRuns: () => pgListStandingOrderRuns(),
  updateStandingOrderRecord: pgUpdateStandingOrderRecord,
  pgDeleteStandingOrder
});

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

const server = createHttpServer({
  http,
  send,
  renderView,
  serveStatic,
  buildPageRoute,
  handleAppUserApi,
  handleSetupAdminApi,
  handleOperationsApi,
  handleMutationApi,
  handleWorkflowApi
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
