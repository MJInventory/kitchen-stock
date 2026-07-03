import { getPool, postgresEnabled } from "./postgres.js";
import {
  ensurePostgresSchemaUpgrades as applyPostgresSchemaUpgrades,
  assertPostgresSchemaReady as assertPostgresSchemaReadyRuntime
} from "./postgres-schema.js";
import { createAdminLookupRuntime } from "./admin-lookup-runtime.js";
import { createServerCoreUtils } from "./server-core-utils.js";
import { createUserHelpers } from "./user-helpers.js";
import { createAuditLogHelpers } from "./audit-log.js";
import { createHttpHelpers } from "./http-helpers.js";
import { createPostgresRowMappers } from "./postgres-row-mappers.js";
import { createServerApiHandlers } from "./server-api-runtime.js";
import { createPostgresRuntimeDataHelpers } from "./postgres-runtime-data.js";
import { createLegacyRuntimeDataHelpers } from "./legacy-runtime-data.js";
import { createSupplierDomain } from "./supplier-domain.js";
import { createInventoryDomain } from "./inventory-domain.js";
import { createAppUserDomain } from "./app-user-domain.js";
import { createAppUserService } from "./app-user-service.js";
import { createNotificationDomain } from "./notification-domain.js";
import { createDashboardDomain } from "./dashboard-domain.js";
import { createReportSupportDomain } from "./report-support-domain.js";
import { createSheetDomain } from "./sheet-domain.js";
import { createRequestItemService } from "./request-item-service.js";
import { createLegacySheetDomain } from "./legacy-sheet-domain.js";
import { createStandingOrderDomain } from "./standing-order-domain.js";
import {
  standingSupplierFromNotes,
  standingRunIdFromNotes,
  standingRunLineIdFromNotes,
  isStandingOrderRequestRow
} from "./standing-order-helpers.js";
import { createRequestDomain } from "./request-domain.js";
import { createInternalOrderDomain } from "./internal-order-domain.js";
import { createInvoiceDomain } from "./invoice-domain.js";
import { createKitchenRosterDomain } from "./kitchen-roster-domain.js";

export function createServerComposition({
  config,
  bcrypt,
  nodemailer,
  webpush,
  pushEnabled
}) {
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
    assertPostgresSchemaReady,
    isValidId,
    isoDate,
    todayIso
  } = createServerCoreUtils({
    appTimeZone: config.appTimeZone,
    postgresEnabled,
    applyPostgresSchemaUpgrades: Object.assign(applyPostgresSchemaUpgrades, { assertReady: assertPostgresSchemaReadyRuntime }),
    getPool
  });

  const {
    cleanAuditSnapshot,
    auditChanged,
    pgRecordAuditEntry,
    pgListAuditEntries,
    pgGetAuditSummary
  } = createAuditLogHelpers({
    assertPostgresSchemaReady,
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
    userConfig: config.userConfig,
    editableUserSources: config.editableUserSources,
    gotoMenuOptions: config.gotoMenuOptions,
    backofficeMenuOptions: config.backofficeMenuOptions,
    authSecret: config.authSecret,
    sessionMaxAgeMs: config.sessionMaxAgeMs,
    clampOpenOrderDays: config.clampOpenOrderDays,
    normalizeHiddenMenuItems: config.normalizeHiddenMenuItems
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

  let getSuppliers = async () => [];
  let getLookups = async () => ({});
  let listShelfCodesAdmin = async () => [];
  let getSchema = async () => ({});
  let findOrCreateLookupRecord = async () => "";
  let resolveShelfCodeRecord = async () => "";
  let getItems = async () => [];
  let getRequests = async () => [];
  let getAppUsers = async () => [];

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
    allowedUnits: config.allowedUnits,
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
    assertPostgresSchemaReady,
    db,
    cache,
    isValidId,
    mapPgAppUserRow,
    normalizeRole,
    clampOpenOrderDays: config.clampOpenOrderDays,
    normalizeHiddenMenuItems: config.normalizeHiddenMenuItems,
    gotoMenuOptions: config.gotoMenuOptions,
    backofficeMenuOptions: config.backofficeMenuOptions,
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
    assertPostgresSchemaReady,
    db,
    isValidId,
    pushEnabled,
    webpush,
    pgFindAppUserByName,
    normalizeNotificationAreaName: config.normalizeNotificationAreaName
  });

  const {
    pgGetDashboardSummary
  } = createDashboardDomain({
    assertPostgresSchemaReady,
    db
  });

  const {
    pgListSupplierDeliveryNotes,
    pgSaveSupplierDeliveryNote,
    pgGetDailyGuestCount,
    pgSaveDailyGuestCount,
    pgGetManagementReport
  } = createReportSupportDomain({
    assertPostgresSchemaReady,
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
    pgUpdateRequest,
    pgCreateStockCount,
    pgDeliverRequest,
    pgUndoDeliveredRequest,
    pgDeleteRequest,
    pgDeliverStandingOrderRunLine,
    pgUpdateStandingOrderRunLine,
    pgUndoDeliveredStandingOrderRunLine,
    pgDeleteStandingOrderRunLine
  } = createRequestDomain({
    db,
    cache,
    allowedUnits: config.allowedUnits,
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
    assertPostgresSchemaReady,
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
    appTimeZone: config.appTimeZone,
    todayIso,
    isValidId,
    allowedUnits: config.allowedUnits,
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
    pgGetAuditSummary,
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

  const postgresRuntimeData = createPostgresRuntimeDataHelpers({
    metrics,
    cache,
    itemCacheMs: config.itemCacheMs,
    requestCacheMs: config.requestCacheMs,
    pgListItems,
    pgListSuppliers,
    pgListRequests,
    pgListOpenRequests
  });

  const legacyRuntimeData = createLegacyRuntimeDataHelpers({
    token: config.token,
    baseId: config.baseId,
    metrics
  });

  const { airtable, listAirtableRecords, linkedValue, normalizeItem } = legacyRuntimeData;

  const { listItems, listSuppliers, listRequests, listOpenRequests, cached } = postgresRuntimeData;

  getItems = postgresRuntimeData.getItems;
  getSuppliers = postgresRuntimeData.getSuppliers;
  getRequests = postgresRuntimeData.getRequests;

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
    allowedUnits: config.allowedUnits,
    deliverRequest,
    patchStandingOrderRunLine: undefined,
    closeStandingOrderRunIfComplete: undefined
  });

  const requestItemDomain = createRequestItemService({
    db,
    hasPostgres,
    airtable,
    cache,
    requestsTableId: config.requestsTableId,
    inventoryTableId: config.inventoryTableId,
    allowedUnits: config.allowedUnits,
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
  });
  requestItemService = requestItemDomain;

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
  } = requestItemDomain;

  const {
    pgListInternalOrders,
    pgCreateInternalOrder,
    pgRefreshInternalOrderBatchStatusTx,
    pgUpsertAutoMinimumRequestTx,
    pgUpdateInternalOrderPicking,
    pgUpdateInternalOrderRequest
  } = createInternalOrderDomain({
    assertPostgresSchemaReady,
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
    accountingInbox: config.accountingInbox,
    brevoApiKey: config.brevoApiKey,
    db,
    getItems: () => getItems(),
    getSchema: () => getSchema(),
    hasPostgres,
    inventoryTableId: config.inventoryTableId,
    invoiceOcrRulesTableId: config.invoiceOcrRulesTableId,
    isRender: config.isRender,
    isValidId,
    mailFrom: config.mailFrom,
    ocrSpaceApiKey: config.ocrSpaceApiKey,
    pgFindOrCreateSupplierByName,
    pgNumber,
    smtpHost: config.smtpHost,
    smtpPass: config.smtpPass,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: config.smtpUser,
    airtable
  });

  const {
    pgListKitchenRoster,
    pgSaveKitchenRoster,
    pgSetKitchenRosterLocked,
    pgListKitchenShiftTypesAdmin,
    pgSaveKitchenShiftType
  } = createKitchenRosterDomain({
    assertPostgresSchemaReady,
    db,
    todayIso,
    presentUserName
  });

  const adminLookupRuntime = createAdminLookupRuntime({
    airtable,
    cache,
    requestsTableId: config.requestsTableId,
    lookupConfigs: config.lookupConfigs,
    db,
    auditChanged,
    pgRecordAuditEntry,
    hasPostgres,
    pgListLookups,
    pgFindOrCreateLookupRecord,
    pgResolveShelfCodeRecord
  });

  getLookups = adminLookupRuntime.getLookups;
  findOrCreateLookupRecord = adminLookupRuntime.findOrCreateLookupRecord;
  getSchema = adminLookupRuntime.getSchema;
  listShelfCodesAdmin = adminLookupRuntime.listShelfCodesAdmin;
  resolveShelfCodeRecord = adminLookupRuntime.resolveShelfCodeRecord;

  const {
    getAppUsersTableId,
    listAppUsers,
    findAppUserByName,
    refreshUserFromDirectory,
    findAppUserById,
    createAppUser,
    changeOwnPassword,
    updateAppUser,
    deleteAppUser
  } = createAppUserService({
    appUsersTableIdFromEnv: config.appUsersTableIdFromEnv,
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

  getAppUsers = async (...args) => {
    const serviceUsers = await listAppUsers(...args);
    return serviceUsers;
  };

  const {
    handleAppUserApi,
    handleSetupAdminApi,
    handleOperationsApi,
    handleMutationApi,
    handleWorkflowApi
  } = createServerApiHandlers({
    editableUserSources: config.editableUserSources,
    normalizeRole,
    publicUser,
    canChangeAppUserRole,
    canDeleteAppUserRecord,
    bcrypt,
    hasPostgres,
    pushEnabled,
    vapidPublicKey: config.vapidPublicKey,
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
    listStandingOrders: (options) => pgListStandingOrders(options),
    getDashboardSummary: pgGetDashboardSummary,
    pgListNotificationsForUser,
    pgMarkNotificationsRead,
    listDriverSheet,
    assignDriverToSheet,
    listReceivingSheet,
    pgSaveSupplierDeliveryNote,
    listOrderReport,
    getDailyGuestCount: pgGetDailyGuestCount,
    saveDailyGuestCount: pgSaveDailyGuestCount,
    getManagementReport: pgGetManagementReport,
    listKitchenRoster: pgListKitchenRoster,
    saveKitchenRoster: pgSaveKitchenRoster,
    setKitchenRosterLocked: pgSetKitchenRosterLocked,
    listKitchenShiftTypesAdmin: pgListKitchenShiftTypesAdmin,
    saveKitchenShiftType: pgSaveKitchenShiftType,
    itemFormOptions: pgItemFormOptions,
    listStorageLocationsAdmin: adminLookupRuntime.listStorageLocationsAdmin,
    listCategoriesAdmin: adminLookupRuntime.listCategoriesAdmin,
    listUnitsOfMeasureAdmin: adminLookupRuntime.listUnitsOfMeasureAdmin,
    listSuppliersAdmin: pgListSuppliersAdmin,
    listShelfCodesAdmin: adminLookupRuntime.listShelfCodesAdmin,
    saveStorageLocation: adminLookupRuntime.saveStorageLocation,
    saveCategory: adminLookupRuntime.saveCategory,
    deleteCategory: adminLookupRuntime.deleteCategory,
    saveUnitOfMeasure: adminLookupRuntime.saveUnitOfMeasure,
    deleteUnitOfMeasure: adminLookupRuntime.deleteUnitOfMeasure,
    saveShelfCode: adminLookupRuntime.saveShelfCode,
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
    updateRequest: pgUpdateRequest,
    deliverRequest,
    deliverStandingOrderRunLine: pgDeliverStandingOrderRunLine,
    updateStandingOrderRunLine: pgUpdateStandingOrderRunLine,
    undoDeliveredStandingOrderRunLine: pgUndoDeliveredStandingOrderRunLine,
    undoDeliveredRequest: pgUndoDeliveredRequest,
    updateDriverLine,
    deliverDriverLine,
    canDeleteRequest,
    deleteRequest,
    deleteStandingOrderRunLine: pgDeleteStandingOrderRunLine,
    getRequests,
    brevoApiKey: config.brevoApiKey,
    mailFrom: config.mailFrom,
    accountingInbox: config.accountingInbox,
    smtpHost: config.smtpHost,
    smtpUser: config.smtpUser,
    smtpPass: config.smtpPass,
    isRender: config.isRender,
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

  return {
    cache,
    metrics,
    send,
    hasPostgres,
    ensurePostgresSchemaUpgrades,
    handleAppUserApi,
    handleSetupAdminApi,
    handleOperationsApi,
    handleMutationApi,
    handleWorkflowApi
  };
}
