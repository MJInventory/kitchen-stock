export const appVersion = "3.023";
export const appReleaseLabel = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "local")
  .trim()
  .slice(0, 7);

export const baseId = "appAFvMwWZb2PPWUz";
export const inventoryTableId = "tblEuIXG6gxEiD5oU";
export const requestsTableId = "tblUHh1jWhqMFEfjd";
export const suppliersTableId = "tbl2YP7EpUpk3Ug6f";

export const invoiceOcrRulesTableId = process.env.INVOICE_OCR_RULES_TABLE_ID || "tblW611UMHnm9LUeb";
export const appUsersTableIdFromEnv = process.env.APP_USERS_TABLE_ID || "";
export const token = process.env.AIRTABLE_TOKEN;
export const port = Number(process.env.PORT || 3000);
export const itemCacheMs = Number(process.env.ITEM_CACHE_MS || 10 * 60 * 1000);
export const requestCacheMs = Number(process.env.REQUEST_CACHE_MS || 20 * 1000);
export const authSecret = process.env.AUTH_SECRET || "change-this-secret-in-render";
export const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
export const userConfig = process.env.APP_USERS || "";
export const accountingInbox = process.env.ACCOUNTING_INBOX || "bills.madameja.23d9599b@billfiles.com";
export const smtpHost = process.env.SMTP_HOST || "";
export const smtpPort = Number(process.env.SMTP_PORT || 587);
export const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
export const smtpUser = process.env.SMTP_USER || "";
export const smtpPass = process.env.SMTP_PASS || "";
export const mailFrom = process.env.MAIL_FROM || smtpUser;
export const brevoApiKey = process.env.BREVO_API_KEY || "";
export const ocrSpaceApiKey = process.env.OCR_SPACE_API_KEY || "helloworld";
export const isRender = Boolean(process.env.RENDER);
export const appTimeZone = process.env.APP_TIMEZONE || "America/La_Paz";
export const vapidSubject = process.env.WEB_PUSH_SUBJECT || "mailto:admin@madamejanette.com";
export const vapidPublicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
export const vapidPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";

export const allowedUnits = new Set(["box", "bag", "item", "bottle"]);
export const editableUserSources = new Set(["postgres"]);

export const lookupConfigs = {
  categories: { tableName: "Categories", primaryField: "Category" },
  storageLocations: { tableName: "Storage Locations", primaryField: "Storage Location" },
  inventorySubgroups: { tableName: "Inventory Subgroups", primaryField: "Inventory Subgroup" },
  shelfCodes: { tableName: "Shelf Codes", primaryField: "Shelf Code" },
  inventoryAreas: { tableName: "Inventory Areas", primaryField: "Inventory Area" },
  unitOfMeasurement: { tableName: "Unit Of Measurement", primaryField: "Unit" }
};

export const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

export const gotoMenuOptions = [
  "/",
  "/ordering.html",
  "/internal-orders.html",
  "/picker-sheet.html",
  "/kitchen-roster.html",
  "/receiving-sheet.html",
  "/driver-sheet.html",
  "/stock-count.html",
  "/order-report.html"
];

export const backofficeMenuOptions = [
  "/settings.html",
  "/management-report.html",
  "/standing-orders.html",
  "/inventory-settings.html",
  "/suppliers.html",
  "/categories.html",
  "/units-of-measure.html",
  "/shelf-codes.html",
  "/user-admin.html"
];
