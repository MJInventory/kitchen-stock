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
  appReleaseLabel,
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
  token,
  userConfig,
  vapidPrivateKey,
  vapidPublicKey,
  vapidSubject
} from "./lib/app-config.js";
import { createViewHelpers } from "./lib/view-helpers.js";
import { createPageRouteBuilder } from "./lib/page-routes.js";
import { createRenderer } from "./lib/rendering.js";
import { createHttpServer } from "./lib/server-runtime.js";
import {
  clampOpenOrderDays,
  normalizeHiddenMenuItems,
  normalizeNotificationAreaName
} from "./lib/server-core-utils.js";
import { createServerComposition } from "./lib/server-composition.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const viewsDir = join(__dirname, "views");

const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);
if (pushEnabled) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const {
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
} = createServerComposition({
  config: {
    accountingInbox,
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
    ocrSpaceApiKey,
    requestCacheMs,
    requestsTableId,
    sessionMaxAgeMs,
    smtpHost,
    smtpPass,
    smtpPort,
    smtpSecure,
    smtpUser,
    token,
    userConfig,
    vapidPublicKey,
    allowedUnits,
    appTimeZone,
    appUsersTableIdFromEnv,
    clampOpenOrderDays,
    normalizeHiddenMenuItems,
    normalizeNotificationAreaName
  },
  bcrypt,
  nodemailer,
  webpush,
  pushEnabled
});

const viewHelpers = createViewHelpers(viewsDir);
const buildPageRoute = createPageRouteBuilder(viewHelpers);
const { renderView, serveStatic } = createRenderer({
  publicDir,
  viewsDir,
  appVersion,
  appReleaseLabel,
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
