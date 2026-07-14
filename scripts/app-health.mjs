import "../lib/load-env.js";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createViewHelpers } from "../lib/view-helpers.js";
import { buildPageRouteDefinitions } from "../lib/page-route-definitions.js";
import { createPageRouteBuilder } from "../lib/page-routes.js";
import { createRenderer } from "../lib/rendering.js";
import { createServerComposition } from "../lib/server-composition.js";
import { createServerApiHandlers } from "../lib/server-api-runtime.js";
import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const viewsDir = path.join(repoRoot, "views");
const publicDir = path.join(repoRoot, "public");

const requiredViewNames = [
  "order_request_details_vw",
  "order_request_supply_vw",
  "driver_sheet_request_vw",
  "order_request_attention_vw",
  "standing_order_overview_vw",
  "inventory_below_minimum_vw",
  "standing_order_due_vw",
  "management_order_lines_vw"
];

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeAssetPath(src = "") {
  const raw = typeof src === "string" ? src : src?.src || "";
  return String(raw || "").split("?")[0].trim();
}

function duplicateHtmlIds(html = "") {
  const counts = new Map();
  for (const match of String(html).matchAll(/\bid=["']([^"']+)["']/gi)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function checkRenderedPageContract(route, html) {
  const page = String(html || "");
  assert(/^<!doctype html>/i.test(page), `Rendered page ${route.path} is missing the shared HTML document shell.`);
  assert(/<meta\s+name=["']viewport["']/i.test(page), `Rendered page ${route.path} is missing mobile viewport metadata.`);
  assert(/\/styles\.css(?:\?|["'])/i.test(page), `Rendered page ${route.path} is missing the shared stylesheet.`);
  assert(/\/menu-config\.js(?:\?|["'])/i.test(page), `Rendered page ${route.path} is missing shared menu configuration.`);
  assert(/\/screen-access\.js(?:\?|["'])/i.test(page), `Rendered page ${route.path} is missing shared screen-access behavior.`);
  assert(/\/menus\.js(?:\?|["'])/i.test(page), `Rendered page ${route.path} is missing shared menu behavior.`);
  assert(/\/theme\.js(?:\?|["'])/i.test(page), `Rendered page ${route.path} is missing shared theme behavior.`);
  const duplicateIds = duplicateHtmlIds(page);
  assert(!duplicateIds.length, `Rendered page ${route.path} contains duplicate element ids: ${duplicateIds.join(", ")}`);
  if (route.path === "/ordering.html") {
    assert(/<body[^>]*class=["'][^"']*\bordering-modern-app\b/i.test(page), "Ordering page is missing its shared modern visual mode.");
  }
}

async function checkCriticalExports() {
  assert(typeof createViewHelpers === "function", "createViewHelpers export is missing.");
  assert(typeof buildPageRouteDefinitions === "function", "buildPageRouteDefinitions export is missing.");
  assert(typeof createPageRouteBuilder === "function", "createPageRouteBuilder export is missing.");
  assert(typeof createRenderer === "function", "createRenderer export is missing.");
  assert(typeof createServerComposition === "function", "createServerComposition export is missing.");
  assert(typeof createServerApiHandlers === "function", "createServerApiHandlers export is missing.");
}

async function checkResponsiveStyles() {
  const styles = await fs.readFile(path.join(publicDir, "styles.css"), "utf8");
  assert(/@media\s*\(max-width:\s*560px\)/i.test(styles), "Shared stylesheet is missing the phone layout breakpoint.");
  assert(/min-height:\s*44px/i.test(styles), "Shared phone controls are missing the minimum touch target height.");
  assert(/font-size:\s*16px/i.test(styles), "Shared phone form controls are missing the anti-zoom font size.");
  assert(/\.roster-grid-wrap\s*\{[^}]*overflow-x:\s*auto/is.test(styles), "Kitchen roster is missing its mobile-safe horizontal scroll container.");
  assert(/\.standing-sheet-shell\s*\{[^}]*overflow-x:\s*auto/is.test(styles), "Standing-order tables are missing their mobile-safe horizontal scroll container.");
}

async function checkRouteDefinitionsAndAssets() {
  const helpers = createViewHelpers(viewsDir);
  const routeDefinitions = await buildPageRouteDefinitions(helpers);

  assert(Array.isArray(routeDefinitions) && routeDefinitions.length > 0, "No page route definitions were built.");

  const seenPaths = new Set();
  const allAliases = new Set();

  for (const route of routeDefinitions) {
    assert(route?.path, "Encountered a route definition without a path.");
    assert(route?.view, `Route ${route?.path || "<unknown>"} is missing a view name.`);

    if (!route?.path || !route?.view) continue;

    if (seenPaths.has(route.path)) {
      fail(`Duplicate primary route path detected: ${route.path}`);
    }
    seenPaths.add(route.path);

    const aliasList = [route.path, ...(Array.isArray(route.aliases) ? route.aliases : [])];
    for (const alias of aliasList) {
      if (allAliases.has(alias)) {
        fail(`Duplicate route alias detected: ${alias}`);
      }
      allAliases.add(alias);
    }

    const viewPath = path.join(viewsDir, `${route.view}.ejs`);
    assert(await fileExists(viewPath), `Missing EJS view for route ${route.path}: ${viewPath}`);

    const footerScripts = Array.isArray(route.options?.footerScripts)
      ? route.options.footerScripts
      : [];

    for (const footerScript of footerScripts) {
      const assetPath = normalizeAssetPath(footerScript);
      if (!assetPath) continue;
      const diskPath = path.join(publicDir, assetPath.replace(/^\//, ""));
      assert(await fileExists(diskPath), `Missing footer script asset for route ${route.path}: ${assetPath}`);
    }
  }

  const buildPageRoute = createPageRouteBuilder(helpers);
  for (const alias of allAliases) {
    const built = await buildPageRoute(`http://localhost${alias}`);
    assert(Boolean(built?.view), `Route builder failed to resolve ${alias}`);
  }

  const renderedPages = [];
  const renderer = createRenderer({
    publicDir,
    viewsDir,
    appVersion: "health-check",
    appReleaseLabel: "health-check",
    assetWithVersion: (src = "") => src,
    mimeTypes: {},
    send(_res, _status, body) {
      renderedPages.push(String(body || ""));
    }
  });

  for (const route of routeDefinitions) {
    try {
      const beforeCount = renderedPages.length;
      await renderer.renderView({}, route.view, route.options || {}, 200);
      assert(renderedPages.length === beforeCount + 1, `Renderer did not emit HTML for ${route.path}`);
      if (renderedPages.length === beforeCount + 1) {
        checkRenderedPageContract(route, renderedPages.at(-1));
      }
    } catch (error) {
      fail(`Render failed for ${route.path}: ${error.message}`);
    }
  }
}

async function checkPostgresViews() {
  if (!postgresEnabled()) {
    note("Postgres view checks skipped because DATABASE_URL / DATA_BACKEND do not enable Postgres in this environment.");
    return;
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `
      select viewname
      from pg_views
      where schemaname = 'public'
        and viewname = any($1::text[])
    `,
    [requiredViewNames]
  );

  const present = new Set(rows.map((row) => String(row.viewname || "").trim()));
  const missing = requiredViewNames.filter((viewName) => !present.has(viewName));

  if (missing.length) {
    fail(`Missing required Postgres views: ${missing.join(", ")}`);
  }
}

async function main() {
  try {
    await checkCriticalExports();
    await checkResponsiveStyles();
    await checkRouteDefinitionsAndAssets();
    await checkPostgresViews();
  } finally {
    await closePool().catch(() => {});
  }

  if (failures.length) {
    console.error("App health check failed:");
    for (const message of failures) {
      console.error(`- ${message}`);
    }
    if (notes.length) {
      console.error("");
      for (const message of notes) {
        console.error(`note: ${message}`);
      }
    }
    process.exit(1);
  }

  console.log("App health check passed.");
  if (notes.length) {
    for (const message of notes) {
      console.log(`note: ${message}`);
    }
  }
}

main().catch(async (error) => {
  console.error(`App health check crashed: ${error.message}`);
  await closePool().catch(() => {});
  process.exit(1);
});
