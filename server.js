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
import { createUserHelpers } from "./lib/user-helpers.js";
import { createAuditLogHelpers } from "./lib/audit-log.js";
import { createPostgresRowMappers } from "./lib/postgres-row-mappers.js";
import { createSupplierDomain } from "./lib/supplier-domain.js";
import { createInventoryDomain } from "./lib/inventory-domain.js";
import { createLookupAdminDomain } from "./lib/lookup-admin-domain.js";
import { createAppUserDomain } from "./lib/app-user-domain.js";
import { createNotificationDomain } from "./lib/notification-domain.js";
import { createReportSupportDomain } from "./lib/report-support-domain.js";
import { createSheetDomain } from "./lib/sheet-domain.js";

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
  parseUsers,
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
  pgCreateInventoryItem
} = createInventoryDomain({
  db,
  cache,
  pgItemFromRow,
  allowedUnits,
  isValidId,
  auditChanged,
  pgRecordAuditEntry
});
const {
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
  pgFindOrCreateLookupRecord
});
const {
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

const users = parseUsers();

function publicUserForAdmin(user, actor = null) {
  const editable = editableUserSources.has(user.source);
  const canEditRole = actor ? canChangeAppUser(actor, user, user.role) : true;
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
    canDelete: actor ? canDeleteAppUser(actor, user) && String(actor.name || "").toLowerCase() !== String(user.name || "").toLowerCase() : false
  };
}

function bearerUser(req) {
  const header = req.headers.authorization || "";
  const tokenValue = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifySession(tokenValue);
}

function requireUser(req, res, options = {}) {
  const user = bearerUser(req);
  if (!user) {
    send(res, 401, { error: "Login required." });
    return null;
  }
  if (user.mustChangePassword && !options.allowPasswordChange) {
    send(res, 403, { error: "Password change required.", code: "PASSWORD_CHANGE_REQUIRED" });
    return null;
  }
  return user;
}

function requireRole(user, res, predicate, message) {
  if (predicate(user)) return true;
  send(res, 403, { error: message || "You do not have permission for this action." });
  return false;
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function requireEmailConfig() {
  if (brevoApiKey) {
    if (!mailFrom) throw new Error("Email is not configured yet. Add MAIL_FROM in Render.");
    return;
  }

  if (isRender) {
    throw new Error("Email is not configured for Render. Add BREVO_API_KEY and MAIL_FROM in Render environment variables. SMTP ports time out on Render.");
  }

  const missing = [];
  if (!smtpHost) missing.push("SMTP_HOST");
  if (!smtpUser) missing.push("SMTP_USER");
  if (!smtpPass) missing.push("SMTP_PASS");
  if (!mailFrom) missing.push("MAIL_FROM");
  if (missing.length) {
    throw new Error(`Email is not configured yet. Add BREVO_API_KEY and MAIL_FROM, or add SMTP settings: ${missing.join(", ")}.`);
  }
}

function attachmentFromDataUrl(dataUrl, fileName) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invoice image data was not valid.");

  const content = Buffer.from(match[2], "base64");
  if (!content.length) throw new Error("Invoice image was empty.");
  if (content.length > 12 * 1024 * 1024) throw new Error("Invoice image is too large to email. Retake a smaller photo.");

  return {
    filename: String(fileName || "invoice.jpg").replace(/[^\w.\- ]+/g, "_"),
    contentType: match[1],
    content
  };
}

async function ocrSpaceParseImage(payload) {
  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("OCR file data was not valid.");

  const mimeType = match[1].toLowerCase();
  const fileBytes = Buffer.from(match[2], "base64");
  if (!fileBytes.length) throw new Error("OCR file was empty.");
  if (fileBytes.length > 1024 * 1024) {
    throw new Error("OCR.space free API accepts files up to 1 MB. Use a smaller PDF/photo or split the invoice.");
  }

  const form = new FormData();
  form.set("base64Image", dataUrl);
  form.set("language", "eng");
  form.set("isOverlayRequired", "false");
  form.set("detectOrientation", "true");
  form.set("scale", "true");
  form.set("isTable", "true");
  form.set("OCREngine", String(payload.engine || "2"));
  if (mimeType === "application/pdf") {
    form.set("filetype", "PDF");
  }

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: {
      apikey: ocrSpaceApiKey
    },
    body: form
  });

  const data = await response.json();
  if (!response.ok || data.IsErroredOnProcessing) {
    const errorText = Array.isArray(data.ErrorMessage)
      ? data.ErrorMessage.join(" ")
      : data.ErrorMessage || response.statusText;
    throw new Error(`Hosted OCR failed: ${errorText}`);
  }

  const parsedText = (data.ParsedResults || [])
    .map((result) => result.ParsedText || "")
    .join("\n")
    .trim();

  return {
    text: parsedText,
    provider: "OCR.space",
    exitCode: data.OCRExitCode || null
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

function pgInvoiceCaptureFromRow(row) {
  return {
    id: row.id,
    supplierName: row.supplier_name || "",
    invoiceNumber: row.invoice_number || "",
    invoiceTotal: row.invoice_total == null ? "" : pgNumber(row.invoice_total),
    photoUrl: row.image_url || "",
    extractedText: row.ocr_text || "",
    notes: row.notes || "",
    capturedBy: row.captured_by_username || "",
    capturedAt: row.captured_at || ""
  };
}

function pgInvoiceRuleFromRow(row) {
  return {
    id: row.id,
    supplierName: row.supplier_name || "",
    ruleType: row.rule_type || "",
    ocrMatchText: row.ocr_match_text || "",
    targetField: row.target_field || "",
    inventoryItemId: row.inventory_item_id || "",
    inventoryItemName: row.inventory_item_name || "",
    notes: row.notes || "",
    active: row.active !== false
  };
}


async function pgListRequests(limit = 20) {
  const result = await db().query(`
    select
      r.id,
      r.request_number,
      r.inventory_item_id as item_id,
      r.quantity_needed as quantity,
      r.urgency_level as urgency,
      r.status,
      r.requested_by_username as requested_by,
      r.requested_at,
      r.delivered as received,
      r.delivered_at as received_at,
      r.delivered_by_username as received_by,
      r.notes,
      i.name as item_name,
      c.name as category,
      sl.name as storage_location,
      ia.name as inventory_area,
      sc.code as shelf_code,
      coalesce(nullif(r.order_unit, ''), u.name) as unit,
      sp.name as supplier_name,
      sp.contact_information as supplier_contact
    from order_requests r
    join inventory_items i on i.id = r.inventory_item_id
    left join categories c on c.id = i.category_id
    left join storage_locations sl on sl.id = i.storage_location_id
    left join inventory_areas ia on ia.id = i.inventory_area_id
    left join shelf_codes sc on sc.id = i.shelf_code_id
    left join units_of_measure u on u.id = i.unit_of_measure_id
    left join suppliers sp on sp.id = i.primary_supplier_id
    order by r.request_number desc
    limit $1
  `, [limit]);
  return result.rows.map(pgRequestFromRow);
}

async function pgListOpenRequests() {
  const result = await db().query(`
    select
      r.id,
      r.request_number,
      r.inventory_item_id as item_id,
      r.quantity_needed as quantity,
      r.urgency_level as urgency,
      r.status,
      r.requested_by_username as requested_by,
      r.requested_at,
      r.delivered,
      r.delivered_at,
      r.delivered_by_username,
      r.ordered,
      r.ordered_at,
      r.ordered_by_username,
      r.to_deliver,
      r.delivery_day,
      r.notes,
      r.partial_receipt,
      r.standing_order_run_id,
      r.standing_order_run_line_id,
      i.name as item_name,
      c.name as category,
      sl.name as storage_location,
      ia.name as inventory_area,
      sc.code as shelf_code,
      coalesce(nullif(r.order_unit, ''), u.name) as unit,
      sp.name as supplier_name,
      sp.contact_information as supplier_contact
    from order_requests r
    join inventory_items i on i.id = r.inventory_item_id
    left join categories c on c.id = i.category_id
    left join storage_locations sl on sl.id = i.storage_location_id
    left join inventory_areas ia on ia.id = i.inventory_area_id
    left join shelf_codes sc on sc.id = i.shelf_code_id
    left join units_of_measure u on u.id = i.unit_of_measure_id
    left join suppliers sp on sp.id = i.primary_supplier_id
    where r.delivered = false and r.status in ('Pending', 'Approved')
    order by c.name nulls last, i.name, r.requested_at
  `);
  return result.rows.map(pgRequestFromRow);
}

async function pgRepairStandingOrderStates() {
  await ensurePostgresSchemaUpgrades();
  await db().query(`
    update standing_orders so
    set active = true,
        updated_at = now()
    where coalesce(so.deleted, false) = false
      and so.schedule = 'One Time'
      and so.active = false
      and so.expected_arrival_date is not null
      and so.expected_arrival_date >= current_date
      and not exists (
        select 1
        from standing_order_runs sor
        where sor.standing_order_id = so.id
          and sor.expected_delivery_date = so.expected_arrival_date
          and sor.status = 'Closed'
      )
  `);
}

async function pgListStandingOrders() {
  await pgRepairStandingOrderStates();
  const result = await db().query(`
    select
      so.id,
      so.name,
      so.expected_arrival_date::text as expected_date,
      so.schedule,
      so.other_schedule,
      so.active,
      so.last_generated_date::text as last_generated_date,
      so.notes,
      sp.name as supplier_name,
      coalesce(
        json_agg(
          json_build_object(
            'itemId', i.id,
            'itemName', i.name,
            'quantity', soi.quantity
          )
          order by i.name
        ) filter (where soi.id is not null),
        '[]'::json
      ) as items
    from standing_orders so
    left join suppliers sp on sp.id = so.supplier_id
    left join standing_order_items soi on soi.standing_order_id = so.id
    left join inventory_items i on i.id = soi.inventory_item_id
    where coalesce(so.deleted, false) = false
    group by so.id, sp.name
    order by so.expected_arrival_date asc nulls last, sp.name asc nulls last, so.name asc
  `);
  return result.rows.map(pgStandingOrderFromRow);
}

async function pgListStandingOrderRuns(limit = 50) {
  const result = await db().query(`
    select
      sor.id,
      so.id as standing_order_id,
      so.name as standing_order_name,
      sp.name as supplier_name,
      sor.expected_delivery_date::text as expected_date,
      so.schedule,
      sor.status,
      sor.generated_at,
      sor.generated_by_username,
      sor.closed_at,
      sor.closed_by_username,
      sor.notes,
      coalesce(
        json_agg(
          json_build_object(
            'id', sorl.id,
            'itemId', i.id,
            'itemName', i.name,
            'quantity', sorl.quantity,
            'unit', sorl.unit,
            'supplierName', sorl.supplier_name,
            'received', sorl.received,
            'receivedAt', sorl.received_at,
            'receivedBy', sorl.received_by_username,
            'status', sorl.status,
            'notes', sorl.notes
          )
          order by i.name
        ) filter (where sorl.id is not null),
        '[]'::json
      ) as lines
    from standing_order_runs sor
    join standing_orders so on so.id = sor.standing_order_id
    left join suppliers sp on sp.id = so.supplier_id
    left join standing_order_run_lines sorl on sorl.standing_order_run_id = sor.id
    left join inventory_items i on i.id = sorl.inventory_item_id
    group by sor.id, so.id, so.name, sp.name, so.schedule
    order by sor.expected_delivery_date desc, sor.generated_at desc
    limit $1
  `, [Math.min(Math.max(Number(limit) || 50, 1), 200)]);

  return result.rows.map((row) => {
    const lines = Array.isArray(row.lines) ? row.lines : [];
    return {
      id: row.id,
      standingOrderId: row.standing_order_id || "",
      standingOrderName: row.standing_order_name || "",
      name: `${row.standing_order_name || row.supplier_name || "Standing Order"} - ${row.expected_date || ""}`,
      supplierName: row.supplier_name || "",
      expectedDate: row.expected_date || "",
      schedule: row.schedule || "",
      status: row.status || "",
      generatedAt: row.generated_at || "",
      generatedBy: row.generated_by_username || "",
      closedAt: row.closed_at || "",
      closedBy: row.closed_by_username || "",
      notes: row.notes || "",
      lines,
      totalLines: lines.length,
      receivedLines: lines.filter((line) => line.received).length,
      openLines: lines.filter((line) => !line.received).length
    };
  });
}

async function pgStandingOrderFields(payload) {
  const rawItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: payload.quantityNeeded || payload.quantity
    }];
  const supplierName = String(payload.supplierName || "").trim();
  const standingName = String(payload.name || payload.standingOrderName || "").trim();
  const expectedDate = String(payload.expectedDate || "").trim();
  const schedule = ["Daily", "Weekly", "One Time", "Other"].includes(payload.schedule) ? payload.schedule : "Weekly";
  const otherSchedule = String(payload.otherSchedule || payload.recurrence || "").trim();
  const active = payload.active !== false;
  const recurring = schedule !== "One Time";

  if (!supplierName) throw new Error("Choose one supplier for this standing order.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw new Error("Choose the expected arrival date.");

  const items = rawItems.map((item) => ({
    itemId: String(item.itemId || "").trim(),
    itemName: String(item.itemName || "").trim(),
    quantity: Number(item.quantityNeeded || item.quantity || 0)
  }));
  if (!items.length) throw new Error("Add at least one inventory item.");
  for (const item of items) {
    if (!isValidId(item.itemId)) throw new Error("Choose valid inventory items.");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Each standing-order item needs a quantity greater than zero.");
  }

  const supplier = await pgFindOrCreateSupplierByName(supplierName);
  const name = standingName || `${supplierName} - ${schedule} - ${expectedDate}`;
  return {
    name,
    supplierId: supplier?.id || null,
    supplierName,
    expectedDate,
    schedule,
    otherSchedule,
    recurring,
    active,
    notes: String(payload.notes || ""),
    items
  };
}

async function pgSaveStandingOrderDefinition(payload, user, recordId = "") {
  if (!user.permissions?.canAddInventoryItems) throw new Error("Only admins and power users can save standing orders.");
  const data = await pgStandingOrderFields(payload);
  const client = await db().connect();
  let createdNew = false;
  const beforeOrders = recordId ? await pgListStandingOrders() : [];
  const before = recordId ? beforeOrders.find((entry) => entry.id === recordId) || null : null;
  try {
    await client.query("begin");

    let orderId = recordId;
    if (recordId) {
      if (!isValidId(recordId)) throw new Error("Invalid standing order.");
      await client.query(`
        update standing_orders
        set name = $2,
            supplier_id = $3,
            expected_arrival_date = $4::date,
            schedule = $5,
            other_schedule = $6,
            recurring = $7,
            active = $8,
            notes = $9,
            deleted = false,
            updated_at = now()
        where id = $1
      `, [recordId, data.name, data.supplierId, data.expectedDate, data.schedule, data.otherSchedule, data.recurring, data.active, data.notes]);
      await client.query(`delete from standing_order_items where standing_order_id = $1`, [recordId]);
    } else {
      createdNew = true;
      const created = await client.query(`
        insert into standing_orders (
          name, supplier_id, expected_arrival_date, schedule, other_schedule, recurring, active, notes
        )
        values ($1, $2, $3::date, $4, $5, $6, $7, $8)
        returning id
      `, [data.name, data.supplierId, data.expectedDate, data.schedule, data.otherSchedule, data.recurring, data.active, data.notes]);
      orderId = created.rows[0].id;
    }

    for (const item of data.items) {
      await client.query(`
        insert into standing_order_items (standing_order_id, inventory_item_id, quantity)
        values ($1, $2, $3)
      `, [orderId, item.itemId, item.quantity]);
    }

    if (!createdNew) {
      const openRuns = await client.query(`
        select sor.id, sor.expected_delivery_date::text as expected_date
        from standing_order_runs sor
        where sor.standing_order_id = $1
          and sor.status = 'Open'
        order by sor.expected_delivery_date
      `, [orderId]);

      for (const run of openRuns.rows) {
        await pgRebuildStandingOrderRunTx(
          client,
          run.id,
          orderId,
          String(run.expected_date || data.expectedDate || "").trim(),
          data,
          user.name || "System"
        );
      }
    }

    await client.query("commit");
    cache.requests.expiresAt = 0;
    const savedOrder = (await pgListStandingOrders()).find((entry) => entry.id === orderId) || { id: orderId, ...data };
    if (data.active !== false && /^\d{4}-\d{2}-\d{2}$/.test(data.expectedDate || "") && data.expectedDate <= todayIso()) {
      await pgGenerateStandingOrdersForDate(data.expectedDate, user.name || "System");
    }
    await pgSyncStandingOrderRunsForOrder(orderId, user.name || "System");
    await pgRecordAuditEntry({
      actionType: createdNew ? "add" : "change",
      entityType: "standing-order",
      entityId: orderId,
      entityName: savedOrder.name || data.name,
      actorUsername: user.name || "",
      reasonCode: createdNew ? "standing-order-create" : "standing-order-update",
      before,
      after: savedOrder
    });
    const notifyUsers = await pgNotificationUsers("new-order", user.name);
    if (notifyUsers.length) {
      await pgCreateNotificationsForUsers(notifyUsers, {
        type: "standing-order",
        title: `${createdNew ? "New" : "Updated"} standing order`,
        body: `${savedOrder.supplierName || data.supplierName} - ${savedOrder.expectedDate || data.expectedDate} - ${(savedOrder.items || data.items || []).length} item(s).`,
        relatedStandingOrderId: orderId,
        url: `/standing-orders.html?orderId=${encodeURIComponent(orderId)}`
      });
    }
    return savedOrder;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgUpdateStandingOrderRecord(recordId, payload, user) {
  return pgSaveStandingOrderDefinition(
    payload,
    user || { permissions: { canAddInventoryItems: true }, name: "System" },
    recordId
  );
}

async function pgRebuildStandingOrderRunTx(client, runId, orderId, effectiveDate, data, userName) {
  const currentLinesResult = await client.query(`
    select sorl.id,
           sorl.inventory_item_id,
           sorl.order_request_id,
           sorl.quantity,
           sorl.unit,
           sorl.supplier_name,
           sorl.received,
           sorl.status,
           coalesce(r.ordered, false) as ordered
    from standing_order_run_lines sorl
    left join order_requests r on r.id = sorl.order_request_id
    where sorl.standing_order_run_id = $1
  `, [runId]);
  const currentLines = currentLinesResult.rows;
  const orderItemMap = new Map((data.items || []).map((item) => [item.itemId, item]));

  for (const line of currentLines) {
    const keepLine = orderItemMap.has(line.inventory_item_id) || Boolean(line.received);
    if (keepLine) continue;
    if (line.order_request_id) {
      await client.query(`delete from order_requests where id = $1`, [line.order_request_id]);
    }
    await client.query(`delete from standing_order_run_lines where id = $1`, [line.id]);
  }

  for (const item of data.items) {
    const existingLines = currentLines.filter((line) => line.inventory_item_id === item.itemId);
    const editableLine = existingLines.find((line) => !line.received);
    const itemNote = [
      `Standing order: ${data.schedule}.`,
      data.name ? `Standing order name: ${data.name}.` : "",
      data.supplierName ? `Standing supplier: ${data.supplierName}.` : "",
      runId ? `Standing run id: ${runId}.` : "",
      data.otherSchedule ? `Schedule detail: ${data.otherSchedule}.` : "",
      `Expected arrival: ${effectiveDate}.`,
      data.notes
    ].filter(Boolean).join("\n");

    if (editableLine?.order_request_id) {
      await client.query(`
        update order_requests
        set quantity_needed = $2,
            notes = $3,
            updated_at = now()
        where id = $1
      `, [editableLine.order_request_id, item.quantity, itemNote]);
      await client.query(`
        update standing_order_run_lines
        set quantity = $2,
            supplier_name = $3,
            notes = $4,
            status = 'Scheduled'
        where id = $1
      `, [editableLine.id, item.quantity, data.supplierName || "", itemNote]);
      continue;
    }

    if (existingLines.length) {
      continue;
    }

    const requestInsert = await client.query(`
      insert into order_requests (
        inventory_item_id, quantity_needed, urgency_level, status, requested_by_username, requested_at,
        delivered, ordered, to_deliver, delivery_day, notes, standing_order_run_id, order_unit, updated_at
      )
      select
        $1, $2, 'Low', 'Approved', $3, now(),
        false, false, false, null, $4, $5, coalesce(u.name, ''), now()
      from inventory_items i
      left join units_of_measure u on u.id = i.unit_of_measure_id
      where i.id = $1
      returning id
    `, [item.itemId, item.quantity, `Standing Order - ${userName || "System"}`, itemNote, runId]);
    const requestId = requestInsert.rows[0]?.id || "";

    const lineInsert = await client.query(`
      insert into standing_order_run_lines (
        standing_order_run_id, standing_order_id, inventory_item_id, order_request_id,
        quantity, unit, supplier_name, received, status, notes
      )
      select $1, $2, $3, $4, $5, coalesce(u.name, ''), $6, false, 'Scheduled', $7
      from inventory_items i
      left join units_of_measure u on u.id = i.unit_of_measure_id
      where i.id = $3
      returning id
    `, [runId, orderId, item.itemId, requestId, item.quantity, data.supplierName || "", itemNote]);

    if (requestId && lineInsert.rows[0]?.id) {
      await client.query(`
        update order_requests
        set standing_order_run_line_id = $2,
            updated_at = now()
        where id = $1
      `, [requestId, lineInsert.rows[0].id]);
    }
  }

  return true;
}

async function pgSyncStandingOrderRunsForDate(selectedDate, userName = "System") {
  const runs = await db().query(`
    select sor.id,
           sor.standing_order_id,
           sor.expected_delivery_date::text as expected_date
    from standing_order_runs sor
    join standing_orders so on so.id = sor.standing_order_id
    where sor.expected_delivery_date = $1::date
      and sor.status = 'Open'
      and coalesce(so.deleted, false) = false
    order by sor.generated_at
  `, [selectedDate]);
  if (!runs.rows.length) return 0;

  const orders = await pgListStandingOrders();
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const client = await db().connect();
  let synced = 0;
  try {
    await client.query("begin");
    for (const run of runs.rows) {
      const order = orderMap.get(run.standing_order_id);
      if (!order) continue;
      const runLines = await client.query(`
        select inventory_item_id, quantity, supplier_name
        from standing_order_run_lines
        where standing_order_run_id = $1
        order by inventory_item_id
      `, [run.id]);
      const currentSignature = JSON.stringify(runLines.rows.map((line) => ({
        itemId: line.inventory_item_id,
        quantity: Number(line.quantity || 0),
        supplierName: String(line.supplier_name || "")
      })));
      const orderSignature = JSON.stringify(
        [...(order.items || [])]
          .map((item) => ({
            itemId: item.itemId,
            quantity: Number(item.quantity || 0),
            supplierName: String(order.supplierName || "")
          }))
          .sort((left, right) => String(left.itemId).localeCompare(String(right.itemId)))
      );
      if (currentSignature === orderSignature) continue;
      const rebuilt = await pgRebuildStandingOrderRunTx(
        client,
        run.id,
        run.standing_order_id,
        run.expected_date || selectedDate,
        order,
        userName
      );
      if (rebuilt) synced += 1;
    }
    await client.query("commit");
    if (synced) cache.requests.expiresAt = 0;
    return synced;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgSyncStandingOrderRunsForOrder(orderId, userName = "System") {
  if (!isValidId(orderId)) return 0;
  const result = await db().query(`
    select expected_delivery_date::text as expected_date
    from standing_order_runs
    where standing_order_id = $1
      and status = 'Open'
    group by expected_delivery_date
    order by expected_delivery_date
  `, [orderId]);
  let synced = 0;
  for (const row of result.rows) {
    if (!row.expected_date) continue;
    synced += await pgSyncStandingOrderRunsForDate(row.expected_date, userName);
  }
  return synced;
}

async function pgDeleteStandingOrder(recordId, user) {
  if (!user.permissions?.canAdminUsers) throw new Error("Only admins can delete standing orders.");
  if (!isValidId(recordId)) throw new Error("Invalid standing order.");
  const beforeOrders = await pgListStandingOrders();
  const before = beforeOrders.find((entry) => entry.id === recordId) || null;
  await db().query(`
    update standing_orders
    set deleted = true,
        active = false,
        updated_at = now()
    where id = $1
  `, [recordId]);
  if (before) {
    await pgRecordAuditEntry({
      actionType: "delete",
      entityType: "standing-order",
      entityId: recordId,
      entityName: before.name || before.supplierName || "",
      actorUsername: user.name || "",
      reasonCode: "standing-order-delete",
      before
    });
  }
  return { id: recordId, deleted: true };
}

async function pgGenerateStandingOrdersForDate(selectedDate, userName = "System") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate || "")) throw new Error("Choose a valid date.");
  const orders = (await pgListStandingOrders()).filter((order) => isStandingOrderDue(order, selectedDate));
  const generated = [];

  for (const order of orders) {
    const runResult = await db().query(`
      insert into standing_order_runs (
        standing_order_id, expected_delivery_date, status, generated_at, generated_by_username, notes
      )
      values ($1, $2::date, 'Open', now(), $3, $4)
      on conflict do nothing
      returning id
    `, [order.id, selectedDate, userName, order.notes || ""]);

    let runId = runResult.rows[0]?.id || "";
    if (!runId) {
      const existingRun = await db().query(`
        select id
        from standing_order_runs
        where standing_order_id = $1 and expected_delivery_date = $2::date
        limit 1
      `, [order.id, selectedDate]);
      runId = existingRun.rows[0]?.id || "";
    }

    const existingLines = runId
      ? await db().query(`
        select count(*)::int as total
        from standing_order_run_lines
        where standing_order_run_id = $1
      `, [runId])
      : { rows: [{ total: 0 }] };
    if (Number(existingLines.rows[0]?.total || 0) > 0) {
      const nextDate = nextStandingOrderDate(order, selectedDate);
      await db().query(`
        update standing_orders
        set last_generated_date = $2::date,
            expected_arrival_date = $3::date,
            active = $4,
            updated_at = now()
        where id = $1
      `, [order.id, selectedDate, nextDate || selectedDate, order.active]);
      continue;
    }

    for (const line of order.items || []) {
      const itemNote = [
        `Standing order: ${order.schedule}.`,
        order.name ? `Standing order name: ${order.name}.` : "",
        order.supplierName ? `Standing supplier: ${order.supplierName}.` : "",
        runId ? `Standing run id: ${runId}.` : "",
        order.otherSchedule ? `Schedule detail: ${order.otherSchedule}.` : "",
        `Expected arrival: ${selectedDate}.`,
        order.notes
      ].filter(Boolean).join("\n");

      const request = await pgCreateRequest({
        itemId: line.itemId,
        quantityNeeded: line.quantity,
        urgencyLevel: "Low",
        notes: itemNote
      }, `Standing Order - ${userName}`);

      const lineInsert = await db().query(`
        insert into standing_order_run_lines (
          standing_order_run_id, standing_order_id, inventory_item_id, order_request_id,
          quantity, unit, supplier_name, received, status, notes
        )
        select $1, $2, $3, $4, $5, coalesce(u.name, ''), $6, false, 'Scheduled', $7
        from inventory_items i
        left join units_of_measure u on u.id = i.unit_of_measure_id
        where i.id = $3
        returning id
      `, [runId, order.id, line.itemId, request.id, line.quantity, order.supplierName || "", itemNote]);

      if (lineInsert.rows[0]?.id) {
        await db().query(`
          update order_requests
          set standing_order_run_id = $2, standing_order_run_line_id = $3, updated_at = now()
          where id = $1
        `, [request.id, runId, lineInsert.rows[0].id]);
      }
      generated.push(request);
    }

    const nextDate = nextStandingOrderDate(order, selectedDate);
    await db().query(`
      update standing_orders
      set last_generated_date = $2::date,
          expected_arrival_date = $3::date,
          active = $4,
          updated_at = now()
      where id = $1
    `, [order.id, selectedDate, nextDate || selectedDate, order.active]);
  }

  cache.requests.expiresAt = 0;
  return generated;
}

async function pgCloseStandingOrderRunIfCompleteTx(client, runId, userName) {
  if (!isValidId(runId)) return;
  const pending = await client.query(`
    select count(*)::int as open_count
    from standing_order_run_lines
    where standing_order_run_id = $1
      and coalesce(received, false) = false
  `, [runId]);
  if (Number(pending.rows[0]?.open_count || 0) > 0) return;

  await client.query(`
    update standing_order_runs
    set status = 'Closed',
        closed_at = now(),
        closed_by_username = $2
    where id = $1
  `, [runId, userName]);

  const runResult = await client.query(`
    select
      sor.expected_delivery_date::text as expected_date,
      so.id as standing_order_id,
      so.expected_arrival_date::text as current_expected_date,
      so.schedule,
      so.other_schedule,
      so.recurring,
      so.active
    from standing_order_runs sor
    join standing_orders so on so.id = sor.standing_order_id
    where sor.id = $1
    limit 1
  `, [runId]);
  const run = runResult.rows[0];
  if (!run?.standing_order_id) return;

  const currentOrder = {
    id: run.standing_order_id,
    expectedDate: run.current_expected_date || run.expected_date || "",
    schedule: run.schedule || "Weekly",
    otherSchedule: run.other_schedule || "",
    recurring: run.recurring !== false,
    active: run.active !== false
  };
  const nextDate = currentOrder.recurring
    ? nextStandingOrderDate(currentOrder, run.expected_date || currentOrder.expectedDate || todayIso())
    : "";

  await client.query(`
    update standing_orders
    set active = $2,
        last_generated_date = coalesce($3::date, last_generated_date),
        expected_arrival_date = case
          when $4::date is not null then $4::date
          else expected_arrival_date
        end,
        updated_at = now()
    where id = $1
  `, [
    run.standing_order_id,
    currentOrder.recurring ? currentOrder.active : false,
    run.expected_date || null,
    nextDate || null
  ]);
}

async function pgCreateRequest(payload, requestedByOverride = "") {
  const itemId = String(payload.itemId || "").trim();
  const quantity = Number(payload.quantityNeeded || 0);
  const urgency = String(payload.urgencyLevel || "Medium");
  const requestedBy = String(requestedByOverride || payload.requestedBy || "Kitchen");
  const notes = String(payload.notes || "");
  const orderUnit = String(payload.unitOverride || payload.unit || "").trim().toLowerCase();
  if (!isValidId(itemId)) throw new Error("Choose an item.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!["Low", "Medium", "High", "Critical"].includes(urgency)) throw new Error("Invalid urgency level.");
  if (orderUnit && !allowedUnits.has(orderUnit)) throw new Error("Unit must be box, bag, item, or bottle.");
  const client = await db().connect();
  let requestId = "";
  let updatedExisting = false;
  try {
    await client.query("begin");
    const existingResult = await client.query(`
      select id, request_number
      from order_requests
      where inventory_item_id = $1
        and lower(requested_by_username) = lower($2)
        and delivered = false
        and status in ('Pending', 'Approved')
        and standing_order_run_id is null
      order by requested_at desc, request_number desc
      for update
    `, [itemId, requestedBy]);
    const existingRows = existingResult.rows || [];
    const primary = existingRows[0];

    if (primary) {
      updatedExisting = true;
      await client.query(`
        update order_requests
        set quantity_needed = $2,
            urgency_level = $3,
            notes = $4,
            order_unit = $5,
            status = 'Approved',
            updated_at = now()
        where id = $1
      `, [primary.id, quantity, urgency, notes, orderUnit]);
      if (existingRows.length > 1) {
        const duplicateIds = existingRows.slice(1).map((row) => row.id).filter(Boolean);
        if (duplicateIds.length) {
          await client.query(`delete from driver_sheet_lines where order_request_id = any($1::uuid[])`, [duplicateIds]);
          await client.query(`delete from order_requests where id = any($1::uuid[])`, [duplicateIds]);
        }
      }
      requestId = primary.id;
    } else {
      const insertResult = await client.query(`
        insert into order_requests (
          inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
        )
        values ($1, $2, $3, $4, 'Approved', $5, now(), $6)
        returning id
      `, [itemId, quantity, orderUnit, urgency, requestedBy, notes]);
      requestId = insertResult.rows[0]?.id || "";
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  cache.requests.expiresAt = 0;
  const requests = await pgListRequests(200);
  const saved = requests.find((entry) => entry.id === requestId) || { id: requestId };
  await pgRecordAuditEntry({
    actionType: updatedExisting ? "change" : "add",
    entityType: "order-request",
    entityId: saved.id || requestId,
    entityName: saved.itemName || saved.requestId || itemId,
    actorUsername: requestedBy,
    reasonCode: updatedExisting ? "order-update" : "order-create",
    note: updatedExisting ? "Existing open order updated instead of duplicated." : "New order entered.",
    after: saved
  });
  return saved;
}

async function pgCreateRequestsBatch(payload, requestedByOverride = "") {
  const requestedItems = (Array.isArray(payload.requests) ? payload.requests : [])
    .filter((request) => isValidId(String(request?.itemId || "").trim()))
    .filter((request) => Number(request?.quantityNeeded || 0) > 0);
  if (!requestedItems.length) throw new Error("Select at least one item.");
  const created = [];
  for (const request of requestedItems) {
    created.push(await pgCreateRequest(request, requestedByOverride));
  }
  const requester = String(requestedByOverride || requestedItems[0]?.requestedBy || "").trim();
  const notifyAreas = await pgAreasForInventoryItemIds(requestedItems.map((request) => request.itemId));
  const notifyUsers = await pgNotificationUsers("new-order", requester, notifyAreas);
  if (notifyUsers.length && created.length) {
    const itemNames = created.slice(0, 4).map((entry) => entry.itemName || "Item").filter(Boolean);
    const remainder = created.length > itemNames.length ? ` and ${created.length - itemNames.length} more` : "";
    await pgCreateNotificationsForUsers(notifyUsers, {
      type: "new-order",
      title: `New order by ${presentUserName(requester || "User")}`,
      body: `${created.length} item(s) entered: ${itemNames.join(", ")}${remainder}.`,
      url: "/"
    });
  }
  return created;
}

function internalOrderStockUnitsFromItems(quantityItems) {
  const numeric = Number(quantityItems || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric / 12;
}

function normalizePositiveQuantity(value, decimals = 2) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function pgInternalOrderLineFromRow(row) {
  return {
    id: row.id,
    batchId: row.internal_order_batch_id || "",
    itemId: row.inventory_item_id || "",
    itemName: row.item_name || "",
    category: row.category || "",
    inventoryArea: row.inventory_area || "",
    storageLocation: row.storage_location || "",
    shelfCode: row.shelf_code || "",
    unit: row.unit || "",
    currentStock: pgNumber(row.current_quantity),
    currentStockItems: Math.floor((pgNumber(row.current_quantity) || 0) * 12),
    minimumThreshold: pgNumber(row.minimum_threshold) || 0,
    requestedItemQuantity: pgNumber(row.requested_item_quantity) || 0,
    pickedItemQuantity: pgNumber(row.picked_item_quantity) || 0,
    shortageItemQuantity: pgNumber(row.shortage_item_quantity) || 0,
    shortageRequestId: row.shortage_request_id || "",
    autoMinRequestId: row.auto_min_request_id || "",
    status: row.status || "requested",
    notes: row.notes || ""
  };
}

function mapInternalOrderBatch(rows = []) {
  if (!rows.length) return null;
  const first = rows[0];
  return {
    id: first.batch_id,
    requestedBy: first.requested_by_username || "",
    requestedAt: first.requested_at || "",
    status: first.batch_status || "open",
    notes: first.batch_notes || "",
    pickerUsername: first.picker_username || "",
    readyAt: first.ready_at || "",
    readyBy: first.ready_by_username || "",
    closedAt: first.closed_at || "",
    closedBy: first.closed_by_username || "",
    lines: rows.filter((row) => row.id).map(pgInternalOrderLineFromRow)
      .sort((left, right) => String(left.itemName || "").localeCompare(String(right.itemName || ""), undefined, { sensitivity: "base", numeric: true }))
  };
}

async function pgListInternalOrders(user) {
  await ensurePostgresSchemaUpgrades();
  const role = normalizeRole(user?.role);
  const values = [];
  let whereSql = `where b.status in ('open', 'ready', 'partial')`;
  if (role === "staff") {
    values.push(String(user?.name || "").trim());
    whereSql += ` and lower(b.requested_by_username) = lower($${values.length})`;
  }
  const result = await db().query(`
    select
      b.id as batch_id,
      b.requested_by_username,
      coalesce(b.requested_at, b.created_at) as requested_at,
      b.status as batch_status,
      b.notes as batch_notes,
      b.picker_username,
      b.ready_at,
      b.ready_by_username,
      b.closed_at,
      b.closed_by_username,
      l.id,
      l.internal_order_batch_id,
      l.inventory_item_id,
      l.requested_item_quantity,
      l.picked_item_quantity,
      l.shortage_item_quantity,
      l.shortage_request_id,
      l.auto_min_request_id,
      l.status,
      l.notes,
      i.name as item_name,
      i.current_quantity,
      i.minimum_threshold,
      c.name as category,
      ia.name as inventory_area,
      sl.name as storage_location,
      sc.code as shelf_code,
      u.name as unit
    from internal_order_batches b
    join internal_order_lines l on l.internal_order_batch_id = b.id
    join inventory_items i on i.id = l.inventory_item_id
    left join categories c on c.id = i.category_id
    left join inventory_areas ia on ia.id = i.inventory_area_id
    left join storage_locations sl on sl.id = i.storage_location_id
    left join shelf_codes sc on sc.id = i.shelf_code_id
    left join units_of_measure u on u.id = i.unit_of_measure_id
    ${whereSql}
    order by coalesce(b.requested_at, b.created_at) desc, lower(b.requested_by_username), c.name nulls last, i.name
  `, values);
  const grouped = new Map();
  for (const row of result.rows) {
    const key = row.batch_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.values()].map(mapInternalOrderBatch);
}

async function pgCreateInternalOrder(payload, userName) {
  await ensurePostgresSchemaUpgrades();
  const requestedBy = String(userName || payload.requestedBy || "").trim();
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
  const lines = rawLines
    .map((line) => ({
      itemId: String(line?.itemId || "").trim(),
      quantityItems: Number(line?.quantityItems || 0)
    }))
    .filter((line) => isValidId(line.itemId) && Number.isFinite(line.quantityItems) && line.quantityItems > 0);
  if (!requestedBy) throw new Error("User name is required.");
  if (!lines.length) throw new Error("Add at least one internal item.");

  const client = await db().connect();
  try {
    await client.query("begin");
    const userResult = await client.query(`select id from app_users where lower(username) = lower($1) or lower(display_name) = lower($1) limit 1`, [requestedBy]);
    const userId = userResult.rows[0]?.id || null;
    const batchResult = await client.query(`
      insert into internal_order_batches (
        requested_by_user_id, requested_by_username, status, notes
      )
      values ($1, $2, 'open', $3)
      returning id
    `, [userId, requestedBy, String(payload.notes || "").trim()]);
    const batchId = batchResult.rows[0]?.id || "";
    for (const line of lines) {
      await client.query(`
        insert into internal_order_lines (
          internal_order_batch_id, inventory_item_id, requested_item_quantity, status
        )
        values ($1, $2, $3, 'requested')
      `, [batchId, line.itemId, line.quantityItems]);
    }
    await client.query("commit");
    const orders = await pgListInternalOrders({ name: requestedBy, role: "staff" });
    const saved = orders.find((entry) => entry.id === batchId) || null;
    const notifyUsers = await getAppUsers();
    const pickerUsers = notifyUsers
      .filter((entry) => entry.active !== false && Boolean(entry.isPicker))
      .map((entry) => entry.name)
      .filter(Boolean);
    if (pickerUsers.length) {
      const lineNames = saved?.lines?.slice(0, 4).map((line) => line.itemName).filter(Boolean) || [];
      const remainder = (saved?.lines?.length || 0) > lineNames.length ? ` and ${(saved.lines.length - lineNames.length)} more` : "";
      await pgCreateNotificationsForUsers(pickerUsers, {
        type: "internal-order",
        title: `Internal order by ${presentUserName(requestedBy)}`,
        body: `${saved?.lines?.length || lines.length} item(s): ${lineNames.join(", ")}${remainder}.`,
        url: "/picker-sheet.html"
      });
    }
    await pgRecordAuditEntry({
      actionType: "add",
      entityType: "internal-order",
      entityId: batchId,
      entityName: `Internal order ${requestedBy}`,
      actorUsername: requestedBy,
      reasonCode: "internal-order-create",
      after: saved
    });
    return saved;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgRefreshInternalOrderBatchStatusTx(client, batchId, userName = "") {
  const result = await client.query(`
    select
      count(*)::int as total,
      count(*) filter (where status = 'ready')::int as ready_count,
      count(*) filter (where status = 'partial')::int as partial_count,
      count(*) filter (where status = 'requested')::int as requested_count
    from internal_order_lines
    where internal_order_batch_id = $1
  `, [batchId]);
  const row = result.rows[0] || {};
  const total = Number(row.total || 0);
  const readyCount = Number(row.ready_count || 0);
  const partialCount = Number(row.partial_count || 0);
  const requestedCount = Number(row.requested_count || 0);
  let status = "open";
  if (total === 0) status = "closed";
  else if (readyCount === total) status = "ready";
  else if (partialCount > 0 || (readyCount > 0 && requestedCount > 0)) status = "partial";
  else status = "open";
  await client.query(`
    update internal_order_batches
    set status = $2,
        ready_at = case when $2 = 'ready' then now() else ready_at end,
        ready_by_username = case when $2 = 'ready' then $3 else ready_by_username end,
        updated_at = now()
    where id = $1
  `, [batchId, status, String(userName || "").trim()]);
  return status;
}

async function pgUpsertAutoMinimumRequestTx(client, line, batch, batchId) {
  const currentQuantity = Number(line.current_quantity || 0);
  const minimumThreshold = Number(line.minimum_threshold || 0);
  const quantityNeeded = normalizePositiveQuantity(minimumThreshold - currentQuantity, 2);
  const autoNote = `Automatic minimum restock after internal pick for ${batch.requested_by_username}. Batch ${batchId}.`;
  const requestedBy = "Auto Minimum";
  const linkedRequestId = line.auto_min_request_id || null;

  if (quantityNeeded <= 0) {
    const existingAuto = await client.query(`
      select id
      from order_requests
      where inventory_item_id = $1
        and delivered = false
        and lower(requested_by_username) = lower($2)
        and status in ('Pending', 'Approved')
      order by case when id = $3 then 0 else 1 end,
               updated_at desc nulls last,
               requested_at desc nulls last
      limit 1
    `, [line.inventory_item_id, requestedBy, linkedRequestId]);
    const removableId = existingAuto.rows[0]?.id || linkedRequestId;
    if (removableId) {
      await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [removableId]);
      await client.query(`delete from order_requests where id = $1`, [removableId]);
    }
    return null;
  }

  const requestUnit = String(line.unit || "").trim() || "item";
  const existingAuto = await client.query(`
    select id
    from order_requests
    where inventory_item_id = $1
      and delivered = false
      and lower(requested_by_username) = lower($2)
      and status in ('Pending', 'Approved')
    order by case when id = $3 then 0 else 1 end,
             updated_at desc nulls last,
             requested_at desc nulls last
    limit 1
  `, [line.inventory_item_id, requestedBy, linkedRequestId]);
  const requestId = existingAuto.rows[0]?.id || null;

  if (requestId) {
    await client.query(`
      update order_requests
      set quantity_needed = $2,
          order_unit = $3,
          urgency_level = 'High',
          status = 'Approved',
          delivered = false,
          delivered_at = null,
          delivered_by_username = '',
          notes = $4,
          updated_at = now()
      where id = $1
    `, [requestId, quantityNeeded, requestUnit, autoNote]);
    return requestId;
  }

  const inserted = await client.query(`
    insert into order_requests (
      inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
    )
    values ($1, $2, $3, 'High', 'Approved', $4, now(), $5)
    returning id
  `, [line.inventory_item_id, quantityNeeded, requestUnit, requestedBy, autoNote]);
  return inserted.rows[0]?.id || null;
}

async function pgUpdateInternalOrderPicking(batchId, payload, userName) {
  await ensurePostgresSchemaUpgrades();
  if (!isValidId(batchId)) throw new Error("Invalid internal order.");
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!rawLines.length) throw new Error("No picking lines were provided.");
  const client = await db().connect();
  try {
    await client.query("begin");
    const batchResult = await client.query(`
      select id, requested_by_username, status
      from internal_order_batches
      where id = $1
      for update
    `, [batchId]);
    const batch = batchResult.rows[0];
    if (!batch) throw new Error("Internal order was not found.");

    for (const rawLine of rawLines) {
      const lineId = String(rawLine?.lineId || "").trim();
      if (!isValidId(lineId)) continue;
      const pickedItemQuantity = Math.max(0, Number(rawLine?.pickedItemQuantity || 0));
      if (!Number.isFinite(pickedItemQuantity)) continue;
      const lineResult = await client.query(`
        select
          l.id,
          l.internal_order_batch_id,
          l.inventory_item_id,
          l.requested_item_quantity,
          l.picked_item_quantity,
          l.shortage_request_id,
          l.auto_min_request_id,
          i.current_quantity,
          i.minimum_threshold,
          i.name as item_name,
          ia.name as inventory_area,
          u.name as unit
        from internal_order_lines l
        join inventory_items i on i.id = l.inventory_item_id
        left join inventory_areas ia on ia.id = i.inventory_area_id
        left join units_of_measure u on u.id = i.unit_of_measure_id
        where l.id = $1 and l.internal_order_batch_id = $2
        for update of l, i
      `, [lineId, batchId]);
      const line = lineResult.rows[0];
      if (!line) continue;
      const requestedItemQuantity = Number(line.requested_item_quantity || 0);
      const previousPickedItemQuantity = Number(line.picked_item_quantity || 0);

      if (rawLine?.removeRequested) {
        const restoreUnits = internalOrderStockUnitsFromItems(previousPickedItemQuantity);
        const currentQuantityAfterRestore = Number(line.current_quantity || 0) + restoreUnits;
        if (restoreUnits > 0) {
          await client.query(`
            update inventory_items
            set current_quantity = current_quantity + $2,
                updated_at = now()
            where id = $1
          `, [line.inventory_item_id, restoreUnits]);
        }
        if (line.shortage_request_id) {
          await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [line.shortage_request_id]);
          await client.query(`delete from order_requests where id = $1`, [line.shortage_request_id]);
        }
        await pgUpsertAutoMinimumRequestTx(client, {
          ...line,
          current_quantity: currentQuantityAfterRestore
        }, batch, batchId);
        await client.query(`delete from internal_order_lines where id = $1`, [lineId]);
        continue;
      }

      const safePicked = Math.min(requestedItemQuantity, pickedItemQuantity);
      const shortageItemQuantity = Math.max(0, requestedItemQuantity - safePicked);
      const pickedStatus = shortageItemQuantity > 0 ? "partial" : "ready";
      const stockDeltaItems = safePicked - previousPickedItemQuantity;
      const currentQuantityAfterPick = Number(line.current_quantity || 0) - internalOrderStockUnitsFromItems(stockDeltaItems);

      if (stockDeltaItems !== 0) {
        await client.query(`
          update inventory_items
          set current_quantity = greatest(0, current_quantity - $2),
              updated_at = now()
          where id = $1
        `, [line.inventory_item_id, internalOrderStockUnitsFromItems(stockDeltaItems)]);
      }

      let shortageRequestId = line.shortage_request_id || null;
      let autoMinRequestId = line.auto_min_request_id || null;
      if (shortageItemQuantity > 0) {
        const existingShortageResult = await client.query(`
          select id
          from order_requests
          where id = $1
        `, [shortageRequestId || null]);
        if (existingShortageResult.rows[0]?.id) {
          await client.query(`
            update order_requests
            set quantity_needed = $2,
                order_unit = 'item',
                status = 'Approved',
                delivered = false,
                updated_at = now(),
                notes = $3
            where id = $1
          `, [
            shortageRequestId,
            shortageItemQuantity,
            `Internal order shortage for ${batch.requested_by_username}. Batch ${batchId}.`
          ]);
        } else {
          const shortageInsert = await client.query(`
            insert into order_requests (
              inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
            )
            values ($1, $2, 'item', 'High', 'Approved', $3, now(), $4)
            returning id
          `, [
            line.inventory_item_id,
            shortageItemQuantity,
            batch.requested_by_username,
            `Internal order shortage for ${batch.requested_by_username}. Batch ${batchId}.`
          ]);
          shortageRequestId = shortageInsert.rows[0]?.id || null;
        }
      } else if (shortageRequestId) {
        await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [shortageRequestId]);
        await client.query(`delete from order_requests where id = $1`, [shortageRequestId]);
        shortageRequestId = null;
      }

      autoMinRequestId = await pgUpsertAutoMinimumRequestTx(client, {
        ...line,
        auto_min_request_id: autoMinRequestId,
        current_quantity: currentQuantityAfterPick
      }, batch, batchId);

      await client.query(`
        update internal_order_lines
        set picked_item_quantity = $2,
            shortage_item_quantity = $3,
            shortage_request_id = $4,
            auto_min_request_id = $5,
            status = $6,
            notes = $7,
            updated_at = now()
        where id = $1
      `, [
        lineId,
        safePicked,
        shortageItemQuantity,
        shortageRequestId,
        autoMinRequestId,
        pickedStatus,
        String(rawLine?.notes || "").trim()
      ]);
    }

    const status = await pgRefreshInternalOrderBatchStatusTx(client, batchId, userName);
    await client.query(`
      update internal_order_batches
      set picker_username = $2,
          updated_at = now()
      where id = $1
    `, [batchId, String(userName || "").trim()]);

    await client.query("commit");
    cache.items.expiresAt = 0;
    cache.requests.expiresAt = 0;
    await pgEnsureDriverSheetLines(todayIso());

    const batches = await pgListInternalOrders({ name: userName, role: "power-user" });
    const saved = batches.find((entry) => entry.id === batchId) || null;
    if (saved?.status === "ready") {
      await pgCreateNotificationsForUsers([batch.requested_by_username], {
        type: "internal-ready",
        title: "Internal order ready",
        body: `Your internal order is ready in the pickup area.`,
        url: "/internal-orders.html"
      });
    }
    await pgRecordAuditEntry({
      actionType: "change",
      entityType: "internal-order",
      entityId: batchId,
      entityName: `Internal order ${batch.requested_by_username}`,
      actorUsername: userName,
      reasonCode: "internal-order-pick",
      after: saved || { id: batchId, status }
    });
    return saved || { id: batchId, status };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgUpdateInternalOrderRequest(batchId, payload, user) {
  await ensurePostgresSchemaUpgrades();
  if (!isValidId(batchId)) throw new Error("Invalid internal order.");
  const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!rawLines.length) throw new Error("No internal-order changes were provided.");
  const actorName = String(user?.name || "").trim();
  const actorRole = normalizeRole(user?.role);
  const client = await db().connect();
  try {
    await client.query("begin");
    const batchResult = await client.query(`
      select id, requested_by_username, status
      from internal_order_batches
      where id = $1
      for update
    `, [batchId]);
    const batch = batchResult.rows[0];
    if (!batch) throw new Error("Internal order was not found.");
    const ownsBatch = normalize(batch.requested_by_username) === normalize(actorName);
    const canManageOthers = actorRole === "power-user" || actorRole === "admin" || actorRole === "god";
    if (!ownsBatch && !canManageOthers) {
      throw new Error("You can only change your own internal orders.");
    }

    for (const rawLine of rawLines) {
      const lineId = String(rawLine?.lineId || "").trim();
      if (!isValidId(lineId)) continue;
      const requestedItemQuantity = Math.max(0, Math.round(Number(rawLine?.quantityItems || 0)));
      if (!Number.isFinite(requestedItemQuantity) && !rawLine?.removeRequested) continue;
      const lineResult = await client.query(`
        select
          l.id,
          l.internal_order_batch_id,
          l.inventory_item_id,
          l.requested_item_quantity,
          l.picked_item_quantity,
          l.shortage_request_id,
          l.auto_min_request_id,
          i.current_quantity,
          i.minimum_threshold,
          i.name as item_name,
          u.name as unit
        from internal_order_lines l
        join inventory_items i on i.id = l.inventory_item_id
        left join units_of_measure u on u.id = i.unit_of_measure_id
        where l.id = $1 and l.internal_order_batch_id = $2
        for update of l, i
      `, [lineId, batchId]);
      const line = lineResult.rows[0];
      if (!line) continue;

      const previousRequestedItemQuantity = Number(line.requested_item_quantity || 0);
      const previousPickedItemQuantity = Number(line.picked_item_quantity || 0);

      if (rawLine?.removeRequested || requestedItemQuantity <= 0) {
        const restoreUnits = internalOrderStockUnitsFromItems(previousPickedItemQuantity);
        const currentQuantityAfterRestore = Number(line.current_quantity || 0) + restoreUnits;
        if (restoreUnits > 0) {
          await client.query(`
            update inventory_items
            set current_quantity = current_quantity + $2,
                updated_at = now()
            where id = $1
          `, [line.inventory_item_id, restoreUnits]);
        }
        if (line.shortage_request_id) {
          await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [line.shortage_request_id]);
          await client.query(`delete from order_requests where id = $1`, [line.shortage_request_id]);
        }
        if (line.auto_min_request_id) {
          await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [line.auto_min_request_id]);
          await client.query(`delete from order_requests where id = $1`, [line.auto_min_request_id]);
        }
        await pgUpsertAutoMinimumRequestTx(client, {
          ...line,
          auto_min_request_id: null,
          current_quantity: currentQuantityAfterRestore
        }, batch, batchId);
        await client.query(`delete from internal_order_lines where id = $1`, [lineId]);
        continue;
      }

      const safePicked = Math.min(previousPickedItemQuantity, requestedItemQuantity);
      const restoreItems = Math.max(0, previousPickedItemQuantity - safePicked);
      const restoreUnits = internalOrderStockUnitsFromItems(restoreItems);
      const currentQuantityAfterEdit = Number(line.current_quantity || 0) + restoreUnits;
      if (restoreUnits > 0) {
        await client.query(`
          update inventory_items
          set current_quantity = current_quantity + $2,
              updated_at = now()
          where id = $1
        `, [line.inventory_item_id, restoreUnits]);
      }

      const shortageItemQuantity = Math.max(0, requestedItemQuantity - safePicked);
      let shortageRequestId = line.shortage_request_id || null;
      let autoMinRequestId = line.auto_min_request_id || null;

      if (shortageItemQuantity > 0) {
        const shortageNote = `Internal order shortage updated for ${batch.requested_by_username}. Batch ${batchId}.`;
        const existingShortageResult = await client.query(`
          select id
          from order_requests
          where id = $1
        `, [shortageRequestId || null]);
        if (existingShortageResult.rows[0]?.id) {
          await client.query(`
            update order_requests
            set quantity_needed = $2,
                order_unit = 'item',
                status = 'Approved',
                delivered = false,
                updated_at = now(),
                notes = $3
            where id = $1
          `, [shortageRequestId, shortageItemQuantity, shortageNote]);
        } else {
          const shortageInsert = await client.query(`
            insert into order_requests (
              inventory_item_id, quantity_needed, order_unit, urgency_level, status, requested_by_username, requested_at, notes
            )
            values ($1, $2, 'item', 'High', 'Approved', $3, now(), $4)
            returning id
          `, [
            line.inventory_item_id,
            shortageItemQuantity,
            batch.requested_by_username,
            shortageNote
          ]);
          shortageRequestId = shortageInsert.rows[0]?.id || null;
        }
      } else if (shortageRequestId) {
        await client.query(`delete from driver_sheet_lines where order_request_id = $1`, [shortageRequestId]);
        await client.query(`delete from order_requests where id = $1`, [shortageRequestId]);
        shortageRequestId = null;
      }

      autoMinRequestId = await pgUpsertAutoMinimumRequestTx(client, {
        ...line,
        auto_min_request_id: autoMinRequestId,
        current_quantity: currentQuantityAfterEdit
      }, batch, batchId);

      let nextStatus = "requested";
      if (safePicked > 0 && shortageItemQuantity > 0) nextStatus = "partial";
      else if (safePicked > 0 && shortageItemQuantity === 0) nextStatus = "ready";

      await client.query(`
        update internal_order_lines
        set requested_item_quantity = $2,
            picked_item_quantity = $3,
            shortage_item_quantity = $4,
            shortage_request_id = $5,
            auto_min_request_id = $6,
            status = $7,
            updated_at = now()
        where id = $1
      `, [
        lineId,
        requestedItemQuantity,
        safePicked,
        shortageItemQuantity,
        shortageRequestId,
        autoMinRequestId,
        nextStatus
      ]);
    }

    await pgRefreshInternalOrderBatchStatusTx(client, batchId, actorName);
    await client.query("commit");
    cache.items.expiresAt = 0;
    cache.requests.expiresAt = 0;
    const batches = await pgListInternalOrders({ name: ownsBatch ? batch.requested_by_username : actorName, role: ownsBatch ? "staff" : actorRole });
    const saved = batches.find((entry) => entry.id === batchId) || null;
    await pgRecordAuditEntry({
      actionType: "change",
      entityType: "internal-order",
      entityId: batchId,
      entityName: `Internal order ${batch.requested_by_username}`,
      actorUsername: actorName || batch.requested_by_username,
      reasonCode: "internal-order-update",
      after: saved
    });
    return saved;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgCreateStockCount(payload, userName) {
  const itemId = String(payload.itemId || "").trim();
  const countedQuantity = Number(payload.countedQuantity);
  const notes = String(payload.notes || "");
  if (!isValidId(itemId)) throw new Error("Choose an item.");
  if (!Number.isFinite(countedQuantity) || countedQuantity < 0) throw new Error("Counted quantity must be zero or greater.");
  const client = await db().connect();
  try {
    await client.query("begin");
    const itemResult = await client.query(`
      select i.id,
             i.name,
             i.current_quantity,
             (
               select u.name
               from units_of_measure u
               where u.id = i.unit_of_measure_id
             ) as unit
      from inventory_items i
      where i.id = $1
      for update
    `, [itemId]);
    const item = itemResult.rows[0];
    if (!item) throw new Error("Item not found.");
    await client.query(`
      insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
      values ($1, $2, $3, $4, now(), $5)
    `, [itemId, countedQuantity, item.current_quantity || 0, userName, notes]);
    const updated = await client.query(`
      update inventory_items
      set current_quantity = $2, updated_at = now()
      where id = $1
      returning id, name, current_quantity, $3::text as unit
    `, [itemId, countedQuantity, item.unit || "item"]);
    await client.query("commit");
    cache.items.expiresAt = 0;
    const saved = {
      count: { id: "", fields: {} },
      item: {
        id: updated.rows[0].id,
        name: updated.rows[0].name,
        quantity: pgNumber(updated.rows[0].current_quantity),
        unit: updated.rows[0].unit || "item"
      }
    };
    await pgRecordAuditEntry({
      actionType: "change",
      entityType: "stock-count",
      entityId: itemId,
      entityName: item.name || "",
      actorUsername: userName,
      reasonCode: "stock-count",
      note: notes || "Manual stock count saved.",
      before: { quantity: pgNumber(item.current_quantity || 0), unit: item.unit || "item" },
      after: { quantity: saved.item.quantity, unit: saved.item.unit }
    });
    return saved;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgDeliverRequest(recordId, userName, options = {}) {
  if (!isValidId(recordId)) throw new Error("Invalid request record.");
  const client = await db().connect();
  try {
    await client.query("begin");
    const requestResult = await client.query(`
      select r.id,
             r.request_number,
             r.inventory_item_id,
             r.quantity_needed,
             r.requested_by_username,
             r.delivered,
             r.status,
             r.notes,
             r.standing_order_run_line_id,
             i.name as item_name,
             i.current_quantity,
             (
               select u.name
               from units_of_measure u
               where u.id = i.unit_of_measure_id
             ) as unit
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      where r.id = $1
      for update of r, i
    `, [recordId]);
    const request = requestResult.rows[0];
    if (!request) throw new Error("Request not found.");
    const before = {
      id: request.id,
      itemName: request.item_name || "",
      quantityNeeded: Number(request.quantity_needed || 0),
      requestedBy: request.requested_by_username || "",
      delivered: Boolean(request.delivered),
      status: request.status || "",
      notes: request.notes || "",
      unit: request.unit || ""
    };
    if (request.delivered || request.status === "Fulfilled") {
      await client.query("commit");
      const requests = await pgListRequests(200);
      return requests.find((entry) => entry.id === recordId) || { id: recordId };
    }
    const orderedQty = Number(request.quantity_needed || 0);
    const receivedQty = Number(
      options.quantityReceived === undefined || options.quantityReceived === null || options.quantityReceived === ""
        ? orderedQty
        : options.quantityReceived
    );
    if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
      throw new Error("Received quantity must be greater than zero.");
    }
    if (receivedQty > orderedQty) {
      throw new Error("Received quantity cannot be higher than the ordered quantity.");
    }
    const isFullReceipt = receivedQty >= orderedQty;
    const remainingQty = isFullReceipt ? 0 : Math.max(0, orderedQty - receivedQty);
    const newQty = Number(request.current_quantity || 0) + receivedQty;
    await client.query(`
      insert into stock_counts (inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes)
      values ($1, $2, $3, $4, now(), $5)
    `, [request.inventory_item_id, newQty, request.current_quantity || 0, userName, `${isFullReceipt ? "Delivered" : "Partially delivered"} from order request ${request.request_number}: added ${receivedQty} ${request.unit || ""}.${remainingQty > 0 ? ` Remaining open: ${remainingQty} ${request.unit || ""}.` : ""}`]);
    await client.query(`
      update inventory_items
      set current_quantity = $2, updated_at = now()
      where id = $1
    `, [request.inventory_item_id, newQty]);

    if (isFullReceipt) {
      await client.query(`
        update order_requests
        set delivered = true,
            delivered_at = now(),
            delivered_by_username = $2,
            partial_receipt = false,
            status = 'Fulfilled',
            updated_at = now()
        where id = $1
      `, [recordId, userName]);

      const standingLineUpdate = await client.query(`
        update standing_order_run_lines
        set received = true,
            received_at = now(),
            received_by_username = $2,
            status = 'Received'
        where order_request_id = $1
        returning standing_order_run_id
      `, [recordId, userName]);
      for (const row of standingLineUpdate.rows) {
        await pgCloseStandingOrderRunIfCompleteTx(client, row.standing_order_run_id, userName);
      }
    } else {
      await client.query(`
        update order_requests
        set quantity_needed = $2,
            delivered = false,
            delivered_at = null,
            delivered_by_username = '',
            partial_receipt = true,
            status = 'Approved',
            updated_at = now()
        where id = $1
      `, [recordId, remainingQty]);
      if (request.standing_order_run_line_id && isValidId(request.standing_order_run_line_id)) {
        await client.query(`
          update standing_order_run_lines
          set quantity = $2,
              received = false,
              received_at = null,
              received_by_username = '',
              status = 'Scheduled'
          where id = $1
        `, [request.standing_order_run_line_id, remainingQty]);
      }
    }
    await client.query("commit");
    cache.items.expiresAt = 0;
    cache.requests.expiresAt = 0;
    const notifyUser = String(request.requested_by_username || "").trim();
    if (isFullReceipt && notifyUser && !notifyUser.toLowerCase().includes("standing order")) {
      const deliveryUsers = await pgNotificationUsers("delivery");
      const optedIn = deliveryUsers.find((name) => String(name || "").trim().toLowerCase() === notifyUser.toLowerCase());
      if (optedIn) {
        await pgCreateNotificationsForUsers([notifyUser], {
          type: "delivery",
          title: `${request.item_name || "Item"} delivered`,
          body: `${receivedQty} ${request.unit || ""} received and added to stock by ${presentUserName(userName)}.`,
          relatedRequestId: recordId,
          url: "/"
        });
      }
    }
    const requests = await pgListRequests(200);
    const latest = requests.find((entry) => entry.id === recordId) || { id: recordId, delivered: isFullReceipt };
    await pgRecordAuditEntry({
      actionType: "change",
      entityType: "order-request",
      entityId: recordId,
      entityName: request.item_name || "",
      actorUsername: userName,
      reasonCode: isFullReceipt ? "delivery-complete" : "delivery-partial",
      note: isFullReceipt
        ? `Order fully received. ${receivedQty} ${request.unit || ""} added to stock.`
        : `Order partially received. ${receivedQty} ${request.unit || ""} added, ${remainingQty} ${request.unit || ""} still open.`,
      before,
      after: latest
    });
    return { ...latest, receivedQuantity: receivedQty, remainingQuantity: remainingQty, fullyDelivered: isFullReceipt };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function pgDeleteRequest(recordId, actorUsername = "") {
  const requests = await pgListRequests(200);
  const before = requests.find((request) => request.id === recordId) || null;
  const result = await db().query(`delete from order_requests where id = $1 returning id`, [recordId]);
  cache.requests.expiresAt = 0;
  if (before) {
    await pgRecordAuditEntry({
      actionType: "delete",
      entityType: "order-request",
      entityId: recordId,
      entityName: before.itemName || before.requestId || "",
      actorUsername,
      reasonCode: "order-delete",
      before
    });
  }
  return { id: result.rows[0]?.id || recordId, deleted: Boolean(result.rowCount) };
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

function normalizeAppUser(record) {
  const fields = record.fields || {};
  const name = String(fields.Name || fields.Username || "").trim();
  return {
    id: record.id,
    name,
    password: String(fields.Password || "").trim(),
    role: name.toLowerCase() === "enno" ? "god" : normalizeRole(fields.Role || "user"),
    theme: String(fields.Theme || "dark").trim().toLowerCase() === "light" ? "light" : "dark",
    active: fields.Active !== false,
    mustChangePassword: Boolean(fields["Force Password Change"]),
    source: "airtable"
  };
}

function envUsersList() {
  return [...users.values()].map((user) => ({
    id: `env-${user.name.toLowerCase()}`,
    name: user.name,
    password: user.password,
    role: normalizeRole(user.role),
    theme: user.theme === "light" ? "light" : "dark",
    active: user.active !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    source: "env"
  }));
}

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

function appUserFields(payload, schema = null) {
  const name = String(payload.name || "").trim();
  const password = String(payload.password || "").trim();
  const role = normalizeRole(payload.role);
  const theme = String(payload.theme || "dark").trim().toLowerCase() === "light" ? "Light" : "Dark";
  const active = payload.active !== false;
  const mustChangePassword = Boolean(payload.mustChangePassword);

  if (!name) throw new Error("User name is required.");
  if (!password) throw new Error("Password is required.");
  const fields = {
    Name: name,
    Password: password,
    Role: role === "god"
      ? "God"
      : role === "admin"
        ? "Admin"
        : role === "power-user"
          ? "Power User"
          : role === "staff"
            ? "Staff"
            : "User"
  };
  if (!schema || schema.appUsers.hasTheme) fields.Theme = theme;
  if (!schema || schema.appUsers.hasActive) fields.Active = active;
  if (!schema || schema.appUsers.hasForcePasswordChange) fields["Force Password Change"] = mustChangePassword;
  return fields;
}

function appUserUpdateFields(payload, currentUser, schema = null) {
  const name = String(payload.name || currentUser?.name || "").trim();
  const role = normalizeRole(payload.role || currentUser?.role || "user");
  const theme = String(payload.theme || currentUser?.theme || "dark").trim().toLowerCase() === "light" ? "Light" : "Dark";
  const active = payload.active !== false;
  const mustChangePassword = Boolean(payload.mustChangePassword);
  const password = String(payload.password || "").trim();

  if (!name) throw new Error("User name is required.");
  const fields = {
    Name: name,
    Role: role === "god"
      ? "God"
      : role === "admin"
        ? "Admin"
        : role === "power-user"
          ? "Power User"
          : role === "staff"
            ? "Staff"
            : "User"
  };
  if (password) fields.Password = password;
  if (!schema || schema.appUsers.hasTheme) fields.Theme = theme;
  if (!schema || schema.appUsers.hasActive) fields.Active = active;
  if (!schema || schema.appUsers.hasForcePasswordChange) fields["Force Password Change"] = mustChangePassword;
  return fields;
}

function canChangeAppUser(actor, target, nextRole) {
  const actorRole = normalizeRole(actor?.role);
  const targetRole = normalizeRole(target?.role);
  const wantedRole = normalizeRole(nextRole);
  const actorIsGod = actorRole === "god";
  const actorIsAdmin = actorRole === "admin";
  if (actorIsGod) return true;
  if (!actorIsAdmin) return false;
  if (targetRole === "admin" || targetRole === "god") return false;
  if (wantedRole === "admin" || wantedRole === "god") return false;
  return true;
}

function canDeleteAppUser(actor, target) {
  const actorRole = normalizeRole(actor?.role);
  const targetRole = normalizeRole(target?.role);
  if (actorRole === "god") return true;
  if (actorRole !== "admin") return false;
  return targetRole === "power-user" || targetRole === "staff" || targetRole === "user";
}

async function findAppUserById(recordId) {
  const appUsers = await getAppUsers();
  return appUsers.find((user) => user.id === recordId);
}

async function createAppUser(payload, actorUsername = "") {
  return pgCreateAppUser(payload, actorUsername);
}

async function changeOwnPassword(userName, currentPassword, newPassword, options = {}) {
  return pgChangeOwnPassword(userName, currentPassword, newPassword, options);
}

async function itemFormOptions() {
  const [suppliers, lookups, shelfCodes] = await Promise.all([getSuppliers(), getLookups(), listShelfCodesAdmin()]);
  return {
    suppliers,
    categories: lookups.categories.records,
    storageLocations: lookups.storageLocations.records,
    inventoryAreas: lookups.inventoryAreas.records,
    inventorySubgroups: lookups.categories.records,
    shelfCodes: shelfCodes.map((shelf) => ({
      id: shelf.id,
      name: shelf.name,
      storageLocation: shelf.storageLocation || "",
      displayName: [shelf.storageLocation, shelf.name].filter(Boolean).join(" / ") || shelf.name
    })),
    units: lookups.unitOfMeasurement.records.length
      ? lookups.unitOfMeasurement.records
      : [...allowedUnits].map((name) => ({ id: name, name }))
  };
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeStandingOrder(record) {
  const fields = record.fields || {};
  let items = [];
  try {
    const parsed = fields["Items JSON"] ? JSON.parse(fields["Items JSON"]) : [];
    if (Array.isArray(parsed)) {
      items = parsed
        .map((item) => ({
          itemId: String(item.itemId || "").trim(),
          itemName: String(item.itemName || "").trim(),
          quantity: Number(item.quantity || item.quantityNeeded || 0)
        }))
        .filter((item) => item.itemId && Number.isFinite(item.quantity) && item.quantity > 0);
    }
  } catch {
    items = [];
  }

  if (!items.length && (fields["Inventory Item"]?.[0] || fields["Inventory Item Record ID"])) {
    items = [{
      itemId: fields["Inventory Item"]?.[0] || fields["Inventory Item Record ID"] || "",
      itemName: fields["Item Name"] || "",
      quantity: Number(fields.Quantity ?? 1)
    }];
  }

  const firstItem = items[0] || {};
  return {
    id: record.id,
    name: fields["Standing Order"] || fields.Name || "",
    itemId: firstItem.itemId || "",
    itemName: firstItem.itemName || "",
    items,
    supplierName: fields["Supplier Name"] || "",
    quantity: firstItem.quantity ?? fields.Quantity ?? 1,
    expectedDate: fields["Expected Arrival Date"] || "",
    schedule: fields.Schedule || "Weekly",
    otherSchedule: fields["Other Schedule"] || "",
    active: fields.Active !== false,
    lastGeneratedDate: fields["Last Generated Date"] || "",
    notes: fields.Notes || ""
  };
}

async function getStandingOrdersTableId() {
  const schema = await getSchema();
  return schema.tables.standingOrders || "";
}

async function listStandingOrders() {
  return pgListStandingOrders();
}

function nextStandingOrderDate(order, generatedDate) {
  if (order.schedule === "Daily") return addDays(generatedDate, 1);
  if (order.schedule === "Weekly") return addDays(generatedDate, 7);
  if (order.schedule === "Other") {
    const detail = String(order.otherSchedule || "").trim().toLowerCase();
    const numericDays = Number(detail.replace(/[^0-9]/g, ""));
    if (Number.isFinite(numericDays) && numericDays > 0) return addDays(generatedDate, numericDays);
    if (detail.includes("biweek")) return addDays(generatedDate, 14);
    if (detail.includes("fortnight")) return addDays(generatedDate, 14);
    if (detail.includes("month")) return addDays(generatedDate, 30);
    if (detail.includes("day")) return addDays(generatedDate, 1);
    if (detail.includes("week")) return addDays(generatedDate, 7);
  }
  return "";
}

function normalizeDailyGuestCount(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    date: fields.Date || fields["Guest Date"] || fields["Report Date"] || "",
    guests: fields["Guest Count"] ?? fields.Guests ?? fields["Guest Total"] ?? fields["Daily Guests"] ?? null,
    notes: fields.Notes || fields["Guest Notes"] || "",
    enteredBy: fields["Entered By"] || fields["Created By"] || fields.User || "",
    enteredAt: fields["Entered At"] || fields["Created At"] || fields.Timestamp || ""
  };
}

async function getDailyGuestCountsTableId() {
  const schema = await getSchema();
  return schema.tables.dailyGuestCounts || "";
}

async function resolveDailyGuestCountsSchema() {
  const schema = await getSchema();
  if (schema.tables.dailyGuestCounts) {
    return {
      tableId: schema.tables.dailyGuestCounts,
      tableName: schema.dailyGuestCounts?.tableName || "",
      dateField: schema.dailyGuestCounts?.dateField || "Date",
      guestField: schema.dailyGuestCounts?.guestField || "Guest Count",
      notesField: schema.dailyGuestCounts?.notesField || "Notes",
      enteredByField: schema.dailyGuestCounts?.enteredByField || "Entered By",
      enteredAtField: schema.dailyGuestCounts?.enteredAtField || "Entered At"
    };
  }

  const data = await airtable("tables", { meta: true });
  const normalizeName = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const findField = (table, ...candidates) => {
    const fields = table?.fields || [];
    for (const candidate of candidates) {
      const expected = normalizeName(candidate);
      const match = fields.find((field) => normalizeName(field.name) === expected);
      if (match) return match.name;
    }
    return "";
  };

  const table = data.tables.find((entry) => {
    const name = normalizeName(entry.name);
    return name.includes("dailyguest") || name.includes("guestcount") || name.includes("guestcounts");
  });

  if (!table) {
    return {
      tableId: "",
      tableName: "",
      dateField: "Date",
      guestField: "Guest Count",
      notesField: "Notes",
      enteredByField: "Entered By",
      enteredAtField: "Entered At"
    };
  }

  return {
    tableId: table.id,
    tableName: table.name,
    dateField: findField(table, "Date", "Guest Date", "Report Date") || "Date",
    guestField: findField(table, "Guest Count", "Guests", "Guest Total", "Daily Guests") || "Guest Count",
    notesField: findField(table, "Notes", "Guest Notes") || "Notes",
    enteredByField: findField(table, "Entered By", "Created By", "User") || "Entered By",
    enteredAtField: findField(table, "Entered At", "Created At", "Timestamp") || "Entered At"
  };
}

async function getDailyGuestCount(date) {
  return pgGetDailyGuestCount(date);
}

async function saveDailyGuestCount(payload, user) {
  return pgSaveDailyGuestCount(payload, user);
}

function isStandingOrderDue(order, selectedDate) {
  if (!order.active || !order.expectedDate) return false;
  if (order.lastGeneratedDate === selectedDate) return false;
  return order.expectedDate <= selectedDate;
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

function normalizeStandingOrderRun(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    name: fields["Run Name"] || "",
    standingOrderId: fields["Standing Order Record ID"] || "",
    standingOrderName: fields["Standing Order Name"] || "",
    supplierName: fields["Supplier Name"] || "",
    expectedDate: fields["Expected Delivery Date"] || "",
    schedule: fields.Schedule || "",
    status: fields.Status || "",
    generatedAt: fields["Generated At"] || "",
    generatedBy: fields["Generated By"] || "",
    closedAt: fields["Closed At"] || "",
    closedBy: fields["Closed By"] || "",
    notes: fields.Notes || ""
  };
}

function normalizeStandingOrderRunLine(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    runId: fields["Standing Order Run ID"] || "",
    standingOrderId: fields["Standing Order Record ID"] || "",
    requestRecordId: fields["Request Record ID"] || "",
    driverLineRecordId: fields["Driver Line Record ID"] || "",
    itemRecordId: fields["Inventory Item Record ID"] || "",
    itemName: fields["Item Name"] || "",
    quantity: fields.Quantity ?? null,
    unit: fields.Unit || "",
    supplierName: fields["Supplier Name"] || "",
    received: Boolean(fields.Received),
    receivedAt: fields["Received At"] || "",
    receivedBy: fields["Received By"] || "",
    status: fields.Status || "",
    notes: fields.Notes || ""
  };
}

async function getStandingOrderRunTables() {
  const schema = await getSchema();
  return {
    runsTableId: schema.tables.standingOrderRuns || "",
    linesTableId: schema.tables.standingOrderRunLines || ""
  };
}

async function findStandingOrderRun(orderId, expectedDate) {
  const { runsTableId } = await getStandingOrderRunTables();
  if (!runsTableId) return null;
  const records = await listAirtableRecords(runsTableId, {
    filterByFormula: `AND({Standing Order Record ID}='${airtableFormulaText(orderId)}', IS_SAME({Expected Delivery Date}, '${expectedDate}', 'day'))`,
    pageSize: "1"
  });
  return records[0] ? normalizeStandingOrderRun(records[0]) : null;
}

async function ensureStandingOrderRun(order, selectedDate, userName) {
  const { runsTableId } = await getStandingOrderRunTables();
  if (!runsTableId) return null;

  const existing = await findStandingOrderRun(order.id, selectedDate);
  if (existing) return { ...existing, existing: true };

  const generatedAt = new Date().toISOString();
  const record = await airtable(runsTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Run Name": `${order.name || order.supplierName || "Standing Order"} - ${selectedDate}`,
        "Standing Order Record ID": order.id,
        "Standing Order Name": order.name || "",
        "Supplier Name": order.supplierName || "",
        "Expected Delivery Date": selectedDate,
        Schedule: order.schedule || "",
        Status: "Open",
        "Generated At": generatedAt,
        "Generated By": userName,
        Notes: order.notes || ""
      }
    })
  });

  return { ...normalizeStandingOrderRun(record), existing: false };
}

async function createStandingOrderRunLine(run, order, item, quantity, request, notes = "") {
  const { linesTableId } = await getStandingOrderRunTables();
  if (!linesTableId || !run?.id) return null;

  const record = await airtable(linesTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Run Line": `${run.expectedDate || ""} - ${item.name || request.itemName || "Item"}`,
        "Standing Order Run ID": run.id,
        "Standing Order Record ID": order.id,
        "Request Record ID": request.id,
        "Inventory Item Record ID": item.id,
        "Item Name": item.name || "",
        Quantity: quantity,
        Unit: item.unit || "",
        "Supplier Name": run.supplierName || order.supplierName || "",
        Received: false,
        Status: "Open",
        Notes: notes
      }
    })
  });

  return normalizeStandingOrderRunLine(record);
}

async function hasStandingOrderRunLines(runId) {
  const { linesTableId } = await getStandingOrderRunTables();
  if (!linesTableId || !/^rec[a-zA-Z0-9]+$/.test(runId || "")) return false;
  const records = await listAirtableRecords(linesTableId, {
    filterByFormula: `{Standing Order Run ID}='${airtableFormulaText(runId)}'`,
    pageSize: "1"
  });
  return records.length > 0;
}

async function patchStandingOrderRunLine(recordId, fields) {
  const { linesTableId } = await getStandingOrderRunTables();
  if (!linesTableId || !/^rec[a-zA-Z0-9]+$/.test(recordId || "")) return null;
  const record = await airtable(`${linesTableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  return normalizeStandingOrderRunLine(record);
}

async function closeStandingOrderRunIfComplete(runId, userName) {
  const { runsTableId, linesTableId } = await getStandingOrderRunTables();
  if (!runsTableId || !linesTableId || !/^rec[a-zA-Z0-9]+$/.test(runId || "")) return null;

  const lines = await listAirtableRecords(linesTableId, {
    filterByFormula: `{Standing Order Run ID}='${airtableFormulaText(runId)}'`,
    pageSize: "100"
  });
  if (!lines.length) return null;

  const allReceived = lines.every((record) => Boolean(record.fields?.Received));
  if (!allReceived) return null;

  const closedAt = new Date().toISOString();
  const record = await airtable(`${runsTableId}/${runId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Status: "Closed",
        "Closed At": closedAt,
        "Closed By": userName
      }
    })
  });
  return normalizeStandingOrderRun(record);
}

async function listStandingOrderRuns(limit = 50) {
  if (hasPostgres()) {
    return pgListStandingOrderRuns(limit);
  }
  const { runsTableId, linesTableId } = await getStandingOrderRunTables();
  if (!runsTableId) return [];

  const records = await listAirtableRecords(runsTableId, {
    pageSize: String(Math.min(Math.max(Number(limit) || 50, 1), 100)),
    "sort[0][field]": "Expected Delivery Date",
    "sort[0][direction]": "desc",
    "sort[1][field]": "Generated At",
    "sort[1][direction]": "desc"
  });
  const runs = records.map(normalizeStandingOrderRun);

  if (!linesTableId || !runs.length) {
    return runs.map((run) => ({ ...run, lines: [], totalLines: 0, receivedLines: 0, openLines: 0 }));
  }

  const linesByRunId = new Map(runs.map((run) => [run.id, []]));
  const runIds = runs.map((run) => run.id);
  for (let index = 0; index < runIds.length; index += 20) {
    const chunk = runIds.slice(index, index + 20);
    const formula = `OR(${chunk.map((id) => `{Standing Order Run ID}='${airtableFormulaText(id)}'`).join(",")})`;
    const lineRecords = await listAirtableRecords(linesTableId, { filterByFormula: formula, pageSize: "100" });
    for (const record of lineRecords) {
      const line = normalizeStandingOrderRunLine(record);
      if (!linesByRunId.has(line.runId)) linesByRunId.set(line.runId, []);
      linesByRunId.get(line.runId).push(line);
    }
  }

  return runs.map((run) => {
    const lines = (linesByRunId.get(run.id) || [])
      .sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || "")));
    return {
      ...run,
      lines,
      totalLines: lines.length,
      receivedLines: lines.filter((line) => line.received).length,
      openLines: lines.filter((line) => !line.received).length
    };
  });
}

async function updateStandingOrderRecord(recordId, payload, user) {
  if (hasPostgres()) {
    return pgUpdateStandingOrderRecord(recordId, payload, user);
  }
  const tableId = await getStandingOrdersTableId();
  if (!tableId) throw new Error("Standing Orders table is not configured.");
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) throw new Error("Invalid standing order record.");

  const fields = await standingOrderFields(payload);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  return normalizeStandingOrder(record);
}

async function standingOrderFields(payload) {
  const schema = await getSchema();
  const rawItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{
      itemId: payload.itemId,
      itemName: payload.itemName,
      quantity: payload.quantityNeeded || payload.quantity
    }];
  const supplierName = String(payload.supplierName || "").trim();
  const standingName = String(payload.name || payload.standingOrderName || "").trim();
  const expectedDate = String(payload.expectedDate || "").trim();
  const schedule = ["Daily", "Weekly", "Other", "One Time"].includes(payload.schedule) ? payload.schedule : "Weekly";
  const otherSchedule = String(payload.otherSchedule || payload.recurrence || "").trim();
  const active = payload.active !== false;
  const items = rawItems.map((item) => ({
    itemId: String(item.itemId || "").trim(),
    itemName: String(item.itemName || "").trim(),
    quantity: Number(item.quantityNeeded || item.quantity || 0)
  }));

  if (!items.length) throw new Error("Add at least one inventory item.");
  if (!supplierName) throw new Error("Choose one supplier for this standing order.");
  for (const item of items) {
    if (!/^rec[a-zA-Z0-9]+$/.test(item.itemId)) throw new Error("Choose valid inventory items.");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error("Each standing-order item needs a quantity greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw new Error("Choose the expected arrival date.");
  if (items.length > 1 && !schema.standingOrders.hasItemsJson) {
    throw new Error("Add a long text field named Items JSON to the Standing Orders table before saving multi-item standing orders.");
  }

  const firstItem = items[0];
  const name = standingName || `${supplierName || "Standing order"} - ${schedule} - ${expectedDate}`;

  const fields = {
    "Standing Order": name,
    "Supplier Name": supplierName,
    "Expected Arrival Date": expectedDate,
    Schedule: schedule,
    "Other Schedule": otherSchedule,
    Active: active,
    Notes: String(payload.notes || "")
  };

  if (schema.standingOrders.hasInventoryItem) fields["Inventory Item"] = [firstItem.itemId];
  if (schema.standingOrders.hasInventoryItemRecordId) fields["Inventory Item Record ID"] = firstItem.itemId;
  if (schema.standingOrders.hasItemName) fields["Item Name"] = firstItem.itemName;
  if (schema.standingOrders.hasQuantity) fields.Quantity = firstItem.quantity;
  if (schema.standingOrders.hasItemsJson) fields["Items JSON"] = JSON.stringify(items);

  return fields;
}

async function saveStandingOrderDefinition(payload, user) {
  if (hasPostgres()) {
    return pgSaveStandingOrderDefinition(payload, user);
  }
  if (!user.permissions?.canAddInventoryItems) throw new Error("Only admins and power users can save standing orders.");
  const tableId = await getStandingOrdersTableId();
  if (!tableId) throw new Error("Standing Orders table is not configured. Add an Airtable table named Standing Orders.");

  const inventoryItems = await getItems();
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const rawItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{ itemId: payload.itemId, quantity: payload.quantityNeeded || payload.quantity }];
  const standingItems = rawItems.map((line) => {
    const item = itemById.get(String(line.itemId || ""));
    if (!item) throw new Error("Inventory item was not found.");
    return {
      itemId: item.id,
      itemName: item.name,
      quantity: Number(line.quantityNeeded || line.quantity || 0)
    };
  });

  const fields = await standingOrderFields({
    ...payload,
    items: standingItems,
    supplierName: payload.supplierName || standingItems[0]?.supplierName || ""
  });

  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({ fields })
  });
  return normalizeStandingOrder(record);
}

async function generateStandingOrdersForDate(selectedDate, userName = "System") {
  if (hasPostgres()) {
    return pgGenerateStandingOrdersForDate(selectedDate, userName);
  }
  const tableId = await getStandingOrdersTableId();
  if (!tableId) return [];

  const orders = (await listStandingOrders()).filter((order) => isStandingOrderDue(order, selectedDate));
  const generated = [];
  const items = await getItems();
  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const order of orders) {
    const run = await ensureStandingOrderRun(order, selectedDate, userName);
    const alreadyGenerated = run?.existing && await hasStandingOrderRunLines(run.id);
    if (alreadyGenerated) {
      const nextDate = nextStandingOrderDate(order, selectedDate);
      await airtable(`${tableId}/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fields: {
            "Last Generated Date": selectedDate,
            "Expected Arrival Date": nextDate || selectedDate,
            Active: order.schedule === "One Time" ? false : order.active
          }
        })
      });
      continue;
    }
    for (const line of order.items || []) {
      const item = itemById.get(line.itemId);
      if (!item) continue;
      const notes = [
        `Standing order: ${order.schedule}.`,
        order.name ? `Standing order name: ${order.name}.` : "",
        order.supplierName ? `Standing supplier: ${order.supplierName}.` : "",
        run?.id ? `Standing run id: ${run.id}.` : "",
        order.otherSchedule ? `Schedule detail: ${order.otherSchedule}.` : "",
        `Expected arrival: ${selectedDate}.`,
        order.notes
      ].filter(Boolean).join("\n");
      const request = await createRequest({
        itemId: item.id,
        quantityNeeded: line.quantity,
        urgencyLevel: "Low",
        storageLocation: item.storageLocation || "",
        inventoryArea: item.inventoryArea || "",
        shelfCode: item.shelfCode || "",
        notes
      }, `Standing Order - ${userName}`);

      const runLine = await createStandingOrderRunLine(run, order, item, line.quantity, request, notes);
      if (runLine?.id) {
        const updatedNotes = `${notes}\nStanding run line id: ${runLine.id}.`;
        await airtable(`${requestsTableId}/${request.id}`, {
          method: "PATCH",
          body: JSON.stringify({ fields: { Notes: updatedNotes } })
        });
        request.notes = updatedNotes;
      }
      generated.push(request);
    }
    const nextDate = nextStandingOrderDate(order, selectedDate);
    await airtable(`${tableId}/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          "Last Generated Date": selectedDate,
          "Expected Arrival Date": nextDate || selectedDate,
          Active: order.schedule === "One Time" ? false : order.active
        }
      })
    });
  }

  return generated;
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
  const fields = appUserUpdateFields(payload, currentUser, schema);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true })
  });
  cache.appUsers.expiresAt = 0;
  return normalizeAppUser(record);
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
  return cached("schema", 10 * 60 * 1000, listSchema);
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

async function listLookupRecords() {
  const schema = await getSchema();
  const result = {};

  for (const [key, config] of Object.entries(lookupConfigs)) {
    const tableId = schema.tables[key];
    const records = tableId ? await listAirtableRecords(tableId) : [];
    const values = records
      .map((record) => ({
        id: record.id,
        name: String(record.fields[config.primaryField] || "").trim()
      }))
      .filter((record) => record.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    result[key] = {
      tableId,
      primaryField: config.primaryField,
      records: values,
      byId: new Map(values.map((record) => [record.id, record])),
      byName: new Map(values.map((record) => [record.name.toLowerCase(), record]))
    };
  }

  return result;
}

async function getLookups() {
  return pgListLookups();
}

async function findOrCreateLookupRecord(lookupKey, value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";

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

function normalizeStorageLocation(record) {
  return {
    id: record.id,
    name: String(record.fields["Storage Location"] || "").trim(),
    active: record.fields.Active !== false
  };
}

function normalizeCategory(record) {
  return {
    id: record.id,
    name: String(record.fields.Category || "").trim()
  };
}

function normalizeShelfCode(record) {
  return {
    id: record.id,
    name: String(record.fields["Shelf Code"] || "").trim(),
    storageLocation: String(record.fields["Storage Location"] || record.fields["Storage Locations"] || "").trim(),
    storageLocationId: record.fields["Storage Location Link"]?.[0] || record.fields["Storage Locations Link"]?.[0] || record.fields["Storage Location Links"]?.[0] || "",
    active: record.fields.Active !== false
  };
}

async function listStorageLocationsAdmin() {
  return pgListStorageLocationsAdmin();
}

async function listCategoriesAdmin() {
  return pgListCategoriesAdmin();
}

async function listShelfCodesAdmin() {
  return pgListShelfCodesAdmin();
}

async function findExistingShelfCodeRecordId(name, storageLocation, excludeRecordId = "") {
  let schema = await getSchema();
  schema = await ensureShelfCodeStorageLocationField(schema);
  const tableId = schema.tables.shelfCodes;
  if (!tableId) return "";

  const wantedName = String(name || "").trim().toLowerCase();
  const wantedLocation = String(storageLocation || "").trim().toLowerCase();
  if (!wantedName) return "";

  const records = await listAirtableRecords(tableId, {
    "sort[0][field]": "Shelf Code",
    "sort[0][direction]": "asc"
  });
  const locations = await listStorageLocationsAdmin();
  const locationById = new Map(locations.map((location) => [location.id, location.name]));
  const match = records
    .map(normalizeShelfCode)
    .map((shelf) => ({
      ...shelf,
      storageLocation: shelf.storageLocation || locationById.get(shelf.storageLocationId) || ""
    }))
    .find((shelf) =>
      shelf.id !== excludeRecordId &&
      String(shelf.name || "").trim().toLowerCase() === wantedName &&
      String(shelf.storageLocation || "").trim().toLowerCase() === wantedLocation
    );
  return match?.id || "";
}

async function findExistingCategoryRecordId(name, excludeRecordId = "") {
  if (hasPostgres()) return "";
  const wantedName = String(name || "").trim().toLowerCase();
  if (!wantedName) return "";
  const categories = await listCategoriesAdmin();
  const match = categories.find((category) =>
    category.id !== excludeRecordId &&
    String(category.name || "").trim().toLowerCase() === wantedName
  );
  return match?.id || "";
}

async function resolveShelfCodeRecord(name, storageLocation) {
  if (hasPostgres()) {
    return pgResolveShelfCodeRecord(name, storageLocation);
  }
  const shelfName = String(name || "").trim();
  const locationName = String(storageLocation || "").trim();
  if (!shelfName) return "";

  const shelves = await listShelfCodesAdmin();
  const match = shelves.find((shelf) =>
    shelf.name.toLowerCase() === shelfName.toLowerCase() &&
    (!locationName || String(shelf.storageLocation || "").toLowerCase() === locationName.toLowerCase())
  );
  if (match) return match.id;

  const created = await saveShelfCode({
    name: shelfName,
    storageLocation: locationName,
    active: true
  });
  return created.id;
}

async function saveStorageLocation(payload, recordId = "", actorUsername = "") {
  if (hasPostgres()) {
    return pgSaveStorageLocation(payload, recordId, actorUsername);
  }
  const schema = await getSchema();
  const tableId = schema.tables.storageLocations;
  if (!tableId) throw new Error("Storage Locations table was not found.");
  const name = String(payload.name || payload.storageLocation || "").trim();
  const active = payload.active !== false;
  if (!name) throw new Error("Storage location name is required.");
  const fields = { "Storage Location": name };
  if (schema.lookupFields.storageLocations.hasActive) fields.Active = active;

  const record = recordId
    ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return normalizeStorageLocation(record);
}

async function saveCategory(payload, recordId = "", actorUsername = "") {
  if (hasPostgres()) {
    return pgSaveCategory(payload, recordId, actorUsername);
  }
  const schema = await getSchema();
  const tableId = schema.tables.categories;
  if (!tableId) throw new Error("Categories table was not found.");
  const name = String(payload.name || payload.category || "").trim();
  if (!name) throw new Error("Category name is required.");

  const duplicateId = await findExistingCategoryRecordId(name, recordId);
  if (duplicateId && !recordId) {
    recordId = duplicateId;
  } else if (duplicateId && recordId && duplicateId !== recordId) {
    throw new Error(`Category "${name}" already exists.`);
  }

  const fields = { Category: name };
  const record = recordId
    ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return normalizeCategory(record);
}

async function deleteCategory(recordId, actorUsername = "") {
  if (hasPostgres()) {
    return pgDeleteCategory(recordId, actorUsername);
  }
  const schema = await getSchema();
  const tableId = schema.tables.categories;
  if (!tableId) throw new Error("Categories table was not found.");
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid category record.");
  }
  await airtable(`${tableId}/${recordId}`, { method: "DELETE" });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return { ok: true, recordId };
}

async function saveShelfCode(payload, recordId = "", actorUsername = "") {
  if (hasPostgres()) {
    return pgSaveShelfCode(payload, recordId, actorUsername);
  }
  let schema = await getSchema();
  schema = await ensureShelfCodeStorageLocationField(schema);
  const tableId = schema.tables.shelfCodes;
  if (!tableId) throw new Error("Shelf Codes table was not found.");
  const name = String(payload.name || payload.shelfCode || "").trim();
  const storageLocation = String(payload.storageLocation || "").trim();
  const active = payload.active !== false;
  if (!name) throw new Error("Shelf code is required.");
  const duplicateId = await findExistingShelfCodeRecordId(name, storageLocation, recordId);
  if (duplicateId && !recordId) {
    recordId = duplicateId;
  } else if (duplicateId && recordId && duplicateId !== recordId) {
    throw new Error(`Shelf code "${name}" already exists for ${storageLocation}.`);
  }
  const fields = { "Shelf Code": name };
  if (schema.lookupFields.shelfCodes.hasActive) fields.Active = active;
  if (storageLocation) {
    if (schema.lookupFields.shelfCodes.hasStorageLocationLink) {
      const locationId = await findOrCreateLookupRecord("storageLocations", storageLocation);
      fields[schema.lookupFields.shelfCodes.storageLocationLinkFieldName || "Storage Location Link"] = locationId ? [locationId] : [];
    } else if (schema.lookupFields.shelfCodes.hasStorageLocation) {
      fields[schema.lookupFields.shelfCodes.storageLocationFieldName || "Storage Location"] = storageLocation;
    } else {
      throw new Error("Add Storage Location or Storage Location Link to the Shelf Codes table first.");
    }
  }

  const record = recordId
    ? await airtable(`${tableId}/${recordId}`, { method: "PATCH", body: JSON.stringify({ fields }) })
    : await airtable(tableId, { method: "POST", body: JSON.stringify({ fields }) });
  cache.lookups.expiresAt = 0;
  cache.items.expiresAt = 0;
  return normalizeShelfCode(record);
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
  if (!user.permissions?.canAdminUsers) {
    throw new Error("Only admins can assign a driver.");
  }

  const schema = await getSchema();
  const tableId = schema.tables.driverSheetLines;
  if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");
  if (!schema.driverLines.hasDriver) throw new Error("Add a Driver field to the Driver Sheet Lines table first.");

  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
  await listDriverSheet(selectedDate);
  const lines = await listDriverSheetLines(tableId, selectedDate);
  const cleanedDriver = String(driverName || "").trim();
  if (!cleanedDriver) throw new Error("Driver name is required.");

  for (const line of lines) {
    await airtable(`${tableId}/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { Driver: cleanedDriver } })
    });
  }

  return {
    date: selectedDate,
    driverName: cleanedDriver,
    updated: lines.length
  };
}

async function persistDriverSheetLines(tableId, sheetDate, requests) {
  const schema = await getSchema();
  const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
  const existing = { records: await listAirtableRecords(tableId, { filterByFormula: formula }) };
  const existingKeys = new Set(
    existing.records.map((record) => `${record.fields["Item Request Record ID"] || ""}|${record.fields["Sheet Date"] || ""}`)
  );
  const inheritedDriver = existing.records.find((record) => record.fields.Driver)?.fields.Driver || "";

  for (const request of requests) {
    const key = `${request.id}|${sheetDate}`;
    if (existingKeys.has(key)) continue;

    const isStanding = String(request.requestedBy || "").includes("Standing Order") || String(request.notes || "").includes("Standing order:");
    const standingSupplier = standingSupplierFromNotes(request.notes);
    const standingRunId = standingRunIdFromNotes(request.notes);
    const standingRunLineId = standingRunLineIdFromNotes(request.notes);
    const fields = {
      "Sheet Line": `${sheetDate} - ${request.requestId || request.id}`,
      "Sheet Date": sheetDate,
      "Item Request Record ID": request.id,
      "Request ID": request.requestId || 0,
      "Inventory Item Record ID": request.itemId,
      "Item Name": request.itemName,
      Category: request.category || undefined,
      "Supplier Name": standingSupplier || request.supplierName,
      "Supplier Contact": request.supplierContact,
      Quantity: request.quantity || 0,
      Unit: request.unit,
      "Inventory Area": request.inventoryArea || undefined,
      "Storage Location": request.storageLocation || undefined,
      "Inventory Subgroup": request.category || "",
      "Shelf Code": request.shelfCode || "",
      "Request Status": request.status,
      Received: Boolean(request.received),
      "2Deliver": isStanding,
      Notes: request.notes || ""
    };
    if (schema.driverLines.hasDriver && inheritedDriver) fields.Driver = inheritedDriver;
    if (isStanding && schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = sheetDate;
    if (isStanding && schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = sheetDate;
    if (standingRunId && schema.driverLines.hasStandingRunId) fields["Standing Order Run ID"] = standingRunId;
    if (standingRunLineId && schema.driverLines.hasStandingRunLineId) fields["Standing Order Run Line ID"] = standingRunLineId;

    const created = await airtable(tableId, {
      method: "POST",
      body: JSON.stringify({ fields })
    });
    if (standingRunLineId) {
      await patchStandingOrderRunLine(standingRunLineId, { "Driver Line Record ID": created.id });
    }
  }
}

async function listDriverSheetLines(tableId, sheetDate) {
  const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
  const records = await listAirtableRecords(tableId, { filterByFormula: formula });
  return records.map(normalizeDriverLine);
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

async function createInvoiceCapture(payload, userName) {
  if (hasPostgres()) {
    const supplier = await pgFindOrCreateSupplierByName(payload.supplierName);
    const invoiceNumber = String(payload.invoiceNumber || "").trim();
    const invoiceTotal = String(payload.invoiceTotal || "").trim() === "" ? null : Number(payload.invoiceTotal);
    if (invoiceTotal !== null && !Number.isFinite(invoiceTotal)) {
      throw new Error("Invoice total must be a number.");
    }
    const result = await db().query(`
      insert into invoice_captures (
        supplier_id, invoice_number, invoice_total, captured_by_username,
        image_name, image_url, ocr_text, notes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id, $9::text as supplier_name, invoice_number, invoice_total,
                image_url, ocr_text, notes, captured_by_username, captured_at
    `, [
      supplier?.id || null,
      invoiceNumber,
      invoiceTotal,
      userName,
      "",
      String(payload.photoUrl || ""),
      String(payload.extractedText || ""),
      String(payload.notes || ""),
      supplier?.name || String(payload.supplierName || "")
    ]);
    return pgInvoiceCaptureFromRow(result.rows[0]);
  }
  const schema = await getSchema();
  const tableId = schema.tables.invoiceCaptures;
  if (!tableId) throw new Error("Invoice Captures table was not found.");

  const supplierName = String(payload.supplierName || "");
  const invoiceNumber = String(payload.invoiceNumber || "");
  const invoiceTotal = payload.invoiceTotal === "" ? null : Number(payload.invoiceTotal);
  const photoUrl = String(payload.photoUrl || "");
  const extractedText = String(payload.extractedText || "");
  const notes = String(payload.notes || "");

  if (invoiceTotal !== null && !Number.isFinite(invoiceTotal)) {
    throw new Error("Invoice total must be a number.");
  }

  const capturedAt = new Date().toISOString();
  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Invoice Capture": `${supplierName || "Invoice"} - ${capturedAt.slice(0, 10)}`,
        "Capture Date/Time": capturedAt,
        "Supplier Name": supplierName,
        "Invoice Number": invoiceNumber,
        ...(invoiceTotal === null ? {} : { "Invoice Total": invoiceTotal }),
        "Photo URL": photoUrl,
        "Extracted Text": extractedText,
        "Entered By": userName,
        Status: "Captured",
        Notes: notes
      }
    })
  });

  return { id: record.id, fields: record.fields };
}

async function createInvoiceLine(payload, userName) {
  if (hasPostgres()) {
    const invoiceCaptureId = String(payload.invoiceCaptureId || "").trim();
    const itemId = String(payload.itemId || "").trim();
    const supplier = await pgFindOrCreateSupplierByName(payload.supplierName);
    const itemName = String(payload.itemName || "").trim();
    const quantity = Number(payload.quantityReceived || 0);
    const unitPrice = payload.unitPrice === "" || payload.unitPrice === null ? null : Number(payload.unitPrice);
    const lineTotal = unitPrice === null ? null : quantity * unitPrice;
    if (!isValidId(invoiceCaptureId)) throw new Error("Invoice capture was not found.");
    if (!itemName) throw new Error("Invoice line needs an item name.");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invoice line quantity must be greater than zero.");
    if (unitPrice !== null && !Number.isFinite(unitPrice)) throw new Error("Invoice line price must be a number.");
    const result = await db().query(`
      insert into invoice_lines (
        invoice_capture_id, inventory_item_id, supplier_id, invoice_number, item_name,
        raw_description, quantity, unit, unit_price, total_price, matched, notes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning id
    `, [
      invoiceCaptureId,
      isValidId(itemId) ? itemId : null,
      supplier?.id || null,
      String(payload.invoiceNumber || ""),
      itemName,
      String(payload.ocrLineText || ""),
      quantity,
      String(payload.unit || ""),
      unitPrice,
      lineTotal,
      isValidId(itemId),
      `Applied by ${userName}`
    ]);
    return { id: result.rows[0]?.id || "" };
  }
  const schema = await getSchema();
  const tableId = schema.tables.invoiceLines;
  if (!tableId) throw new Error("Invoice Lines table was not found.");

  const itemName = String(payload.itemName || "");
  const invoiceNumber = String(payload.invoiceNumber || "");
  const supplierName = String(payload.supplierName || "");
  const quantity = Number(payload.quantityReceived || 0);
  const unitPrice = payload.unitPrice === "" || payload.unitPrice === null ? null : Number(payload.unitPrice);
  const lineTotal = unitPrice === null ? null : quantity * unitPrice;
  const appliedAt = new Date().toISOString();

  if (!itemName) throw new Error("Invoice line needs an item name.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invoice line quantity must be greater than zero.");
  if (unitPrice !== null && !Number.isFinite(unitPrice)) throw new Error("Invoice line price must be a number.");

  const record = await airtable(tableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Invoice Line": `${invoiceNumber || "Invoice"} - ${itemName} - ${appliedAt.slice(0, 10)}`,
        "Invoice Capture Record ID": String(payload.invoiceCaptureId || ""),
        "Invoice Number": invoiceNumber,
        "Supplier Name": supplierName,
        "Inventory Item Record ID": String(payload.itemId || ""),
        "Item Name": itemName,
        "OCR Line Text": String(payload.ocrLineText || ""),
        "Quantity Received": quantity,
        Unit: String(payload.unit || ""),
        ...(unitPrice === null ? {} : { "Unit Price": unitPrice, "Line Total": lineTotal }),
        "Applied Date/Time": appliedAt,
        "Applied By": userName
      }
    })
  });

  return { id: record.id, fields: record.fields };
}

function normalizeOcrRule(record) {
  return {
    id: record.id,
    supplierName: record.fields["Supplier Name"] || "",
    ruleType: record.fields["Rule Type"] || "",
    ocrMatchText: record.fields["OCR Match Text"] || "",
    targetField: record.fields["Target Field"] || "",
    inventoryItemId: record.fields["Inventory Item Record ID"] || "",
    inventoryItemName: record.fields["Inventory Item Name"] || "",
    active: Boolean(record.fields.Active),
    notes: record.fields.Notes || ""
  };
}

function airtableFormulaText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listOcrRules(supplierName) {
  if (hasPostgres()) {
    const supplier = String(supplierName || "").trim();
    const result = supplier
      ? await db().query(`
          select id, supplier_name, rule_type, ocr_match_text, target_field,
                 inventory_item_id, inventory_item_name, active, notes
          from invoice_ocr_rules
          where active = true and lower(supplier_name) = lower($1)
          order by supplier_name, rule_type, ocr_match_text
        `, [supplier])
      : await db().query(`
          select id, supplier_name, rule_type, ocr_match_text, target_field,
                 inventory_item_id, inventory_item_name, active, notes
          from invoice_ocr_rules
          where active = true
          order by supplier_name, rule_type, ocr_match_text
        `);
    return result.rows.map(pgInvoiceRuleFromRow);
  }
  const supplier = String(supplierName || "").trim().toLowerCase();
  const formula = supplier
    ? `AND({Active}=1, LOWER({Supplier Name})='${airtableFormulaText(supplier)}')`
    : "{Active}=1";
  const query = new URLSearchParams({
    pageSize: "100",
    filterByFormula: formula,
    "sort[0][field]": "Supplier Name",
    "sort[0][direction]": "asc"
  });
  const data = await airtable(`${invoiceOcrRulesTableId}?${query}`);
  return data.records.map(normalizeOcrRule);
}

async function createOcrRule(payload, userName) {
  if (hasPostgres()) {
    const supplierName = String(payload.supplierName || "").trim();
    const ruleType = String(payload.ruleType || "").trim();
    const ocrMatchText = String(payload.ocrMatchText || "").replace(/\s+/g, " ").trim();
    const targetField = String(payload.targetField || "").trim();
    const inventoryItemId = String(payload.inventoryItemId || "").trim();
    const inventoryItemName = String(payload.inventoryItemName || "").trim();
    const notes = String(payload.notes || "").trim();
    if (!supplierName) throw new Error("Enter the supplier before teaching OCR.");
    if (!["Header Field", "Line Item"].includes(ruleType)) throw new Error("Invalid OCR rule type.");
    if (!ocrMatchText || ocrMatchText.length < 3) throw new Error("OCR match text is too short.");
    if (!["Supplier", "Invoice Number", "Invoice Total", "Inventory Item"].includes(targetField)) {
      throw new Error("Invalid OCR target field.");
    }
    if (ruleType === "Line Item" && !isValidId(inventoryItemId)) throw new Error("Choose an inventory item for line-item rules.");

    const supplier = await pgFindOrCreateSupplierByName(supplierName);
    const existing = await db().query(`
      select id, supplier_name, rule_type, ocr_match_text, target_field,
             inventory_item_id, inventory_item_name, active, notes
      from invoice_ocr_rules
      where lower(supplier_name) = lower($1)
        and lower(rule_type) = lower($2)
        and lower(ocr_match_text) = lower($3)
        and coalesce(inventory_item_id::text, '') = coalesce($4, '')
      limit 1
    `, [supplierName, ruleType, ocrMatchText, isValidId(inventoryItemId) ? inventoryItemId : ""]);
    if (existing.rows[0]) {
      return pgInvoiceRuleFromRow(existing.rows[0]);
    }

    const record = await db().query(`
      insert into invoice_ocr_rules (
        supplier_id, supplier_name, rule_type, ocr_match_text, target_field,
        inventory_item_id, inventory_item_name, active, notes, created_by_username
      )
      values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
      returning id, supplier_name, rule_type, ocr_match_text, target_field,
                inventory_item_id, inventory_item_name, active, notes
    `, [
      supplier?.id || null,
      supplierName,
      ruleType,
      ocrMatchText,
      targetField,
      isValidId(inventoryItemId) ? inventoryItemId : null,
      inventoryItemName,
      [notes, `Created from web app by ${userName}`].filter(Boolean).join("\n"),
      userName
    ]);
    return pgInvoiceRuleFromRow(record.rows[0]);
  }
  const supplierName = String(payload.supplierName || "").trim();
  const ruleType = String(payload.ruleType || "").trim();
  const ocrMatchText = String(payload.ocrMatchText || "").replace(/\s+/g, " ").trim();
  const targetField = String(payload.targetField || "").trim();
  const inventoryItemId = String(payload.inventoryItemId || "").trim();
  const inventoryItemName = String(payload.inventoryItemName || "").trim();
  const notes = String(payload.notes || "").trim();

  if (!supplierName) throw new Error("Enter the supplier before teaching OCR.");
  if (!["Header Field", "Line Item"].includes(ruleType)) throw new Error("Invalid OCR rule type.");
  if (!ocrMatchText || ocrMatchText.length < 3) throw new Error("OCR match text is too short.");
  if (!["Supplier", "Invoice Number", "Invoice Total", "Inventory Item"].includes(targetField)) {
    throw new Error("Invalid OCR target field.");
  }
  if (ruleType === "Line Item" && !inventoryItemId) throw new Error("Choose an inventory item for line-item rules.");

  const existing = await listOcrRules(supplierName);
  const duplicate = existing.find((rule) =>
    rule.ruleType === ruleType
    && rule.targetField === targetField
    && rule.inventoryItemId === inventoryItemId
    && rule.ocrMatchText.toLowerCase() === ocrMatchText.toLowerCase()
  );
  if (duplicate) return duplicate;

  const record = await airtable(invoiceOcrRulesTableId, {
    method: "POST",
    body: JSON.stringify({
      fields: {
        "Rule Name": `${supplierName} - ${targetField} - ${ocrMatchText.slice(0, 40)}`,
        "Supplier Name": supplierName,
        "Rule Type": ruleType,
        "OCR Match Text": ocrMatchText,
        "Target Field": targetField,
        "Inventory Item Record ID": inventoryItemId,
        "Inventory Item Name": inventoryItemName,
        Active: true,
        Notes: [notes, `Created from web app by ${userName}`].filter(Boolean).join("\n")
      }
    })
  });

  return normalizeOcrRule(record);
}

async function emailInvoicePicture(payload, userName) {
  requireEmailConfig();

  const attachment = attachmentFromDataUrl(payload.dataUrl, payload.fileName);
  const supplier = String(payload.supplierName || "").trim();
  const invoiceNumber = String(payload.invoiceNumber || "").trim();
  const notes = String(payload.notes || "").trim();
  const subjectParts = ["Invoice"];
  if (supplier) subjectParts.push(supplier);
  if (invoiceNumber) subjectParts.push(`#${invoiceNumber}`);

  const text = [
    "Invoice photo sent from Kitchen Stock.",
    "",
    `Sent by: ${userName}`,
    `Supplier: ${supplier || "(not entered)"}`,
    `Invoice number: ${invoiceNumber || "(not entered)"}`,
    notes ? `Notes: ${notes}` : ""
  ].filter(Boolean).join("\n");

  if (brevoApiKey) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: "Kitchen Stock",
          email: mailFrom
        },
        to: [{ email: accountingInbox }],
        subject: subjectParts.join(" - "),
        textContent: text,
        attachment: [{
          name: attachment.filename,
          content: attachment.content.toString("base64")
        }]
      })
    });

    const responseText = await response.text();
    const responseData = responseText ? JSON.parse(responseText) : {};
    if (!response.ok) {
      throw new Error(`Brevo email failed: ${responseData.message || response.statusText}`);
    }

    return {
      to: accountingInbox,
      messageId: responseData.messageId || "",
      provider: "Brevo API"
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const info = await transporter.sendMail({
    from: mailFrom,
    to: accountingInbox,
    subject: subjectParts.join(" - "),
    text,
    attachments: [attachment]
  });

  return {
    to: accountingInbox,
    messageId: info.messageId || "",
    provider: "SMTP"
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
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid driver line record.");
  }

  const schema = await getSchema();
  const tableId = schema.tables.driverSheetLines;
  if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");

  const fields = {};

  if (Object.prototype.hasOwnProperty.call(payload, "ordered")) {
    const ordered = Boolean(payload.ordered);
    fields.Ordered = ordered;
    fields["Ordered Date/Time"] = ordered ? new Date().toISOString() : null;
    fields["Ordered By"] = ordered ? userName : "";
  }

  if (Object.prototype.hasOwnProperty.call(payload, "toDeliver")) {
    const toDeliver = Boolean(payload.toDeliver);
    fields["2Deliver"] = toDeliver;
    if (toDeliver) {
      const deliveryDay = String(payload.deliveryDay || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDay)) {
        throw new Error("Choose the delivery day for 2Deliver items.");
      }
      if (schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = deliveryDay;
      else if (schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = deliveryDay;
      else throw new Error("Add a Delivery Day field to the Driver Sheet Lines table first.");
    } else {
      if (schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = null;
      if (schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "supplierName")) {
    const supplierName = String(payload.supplierName || "").trim();
    const suppliers = await getSuppliers();
    const supplier = suppliers.find((entry) => entry.name.toLowerCase() === supplierName.toLowerCase());
    fields["Supplier Name"] = supplierName || "Unassigned Supplier";
    fields["Supplier Contact"] = supplier?.contact || "";

    if (payload.updatePrimarySupplier) {
      if (!supplier) throw new Error("Choose a known supplier before changing the primary supplier.");
      const currentLine = normalizeDriverLine(await airtable(`${tableId}/${recordId}`));
      await updateItemPrimarySupplier(currentLine.itemRecordId, supplier);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "unit")) {
    const unit = String(payload.unit || "").trim().toLowerCase();
    const allowedUnits = new Set(["box", "bag", "item", "bottle"]);
    if (!allowedUnits.has(unit)) {
      throw new Error("Unit must be box, bag, item, or bottle.");
    }
    fields.Unit = unit;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "quantity")) {
    const quantity = Number(payload.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantity must be greater than zero.");
    }
    fields.Quantity = quantity;
  }

  if (!Object.keys(fields).length) {
    throw new Error("Nothing to update.");
  }

  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });

  return normalizeDriverLine(record);
}

async function deliverDriverLine(recordId, requestRecordId, userName) {
  if (hasPostgres()) {
    return pgDeliverDriverLine(recordId, requestRecordId, userName);
  }
  if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
    throw new Error("Invalid driver line record.");
  }
  if (!/^rec[a-zA-Z0-9]+$/.test(requestRecordId || "")) {
    throw new Error("Invalid request record.");
  }

  const schema = await getSchema();
  const tableId = schema.tables.driverSheetLines;
  if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");

  const existingLineRecord = await airtable(`${tableId}/${recordId}`);
  const existingLine = normalizeDriverLine(existingLineRecord);
  const request = await deliverRequest(requestRecordId, userName);
  const receivedAt = new Date().toISOString();
  const runId = existingLine.standingRunId || standingRunIdFromNotes(existingLine.notes) || standingRunIdFromNotes(request.notes);
  const runLineId = existingLine.standingRunLineId || standingRunLineIdFromNotes(existingLine.notes) || standingRunLineIdFromNotes(request.notes);
  const record = await airtable(`${tableId}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        Received: true,
        "Received Date/Time": receivedAt,
        "Received By": userName,
        "Request Status": "Fulfilled"
      }
    })
  });

  if (runLineId) {
    await patchStandingOrderRunLine(runLineId, {
      Received: true,
      "Received At": receivedAt,
      "Received By": userName,
      Status: "Received",
      "Driver Line Record ID": recordId,
      "Request Record ID": requestRecordId
    });
  }
  if (runId) {
    await closeStandingOrderRunIfComplete(runId, userName);
  }

  cache.requests.expiresAt = 0;
  return {
    request,
    line: normalizeDriverLine(record)
  };
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
      if (!canChangeAppUser(user, { role: "user" }, payload.role)) {
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
      if (!canChangeAppUser(user, target, payload.role)) {
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
      if (!canDeleteAppUser(user, target)) {
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
