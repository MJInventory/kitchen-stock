import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { POSTGRES_MIGRATIONS } from "../lib/postgres-migrations.js";
import { createViewHelpers } from "../lib/view-helpers.js";
import { buildPageRouteDefinitions } from "../lib/page-route-definitions.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changedOnly = process.argv.includes("--changed");
const failures = [];
const notes = [];

const flowRules = [
  { name: "dashboard", patterns: [/^public\/dashboard(?:\.js|\/)/, /^lib\/dashboard-domain\.js$/, /^lib\/operations-api\.js$/], test: "tests/frontend-session-helpers.test.mjs" },
  { name: "ordering", patterns: [/^public\/ordering(?:\.js|\/)/, /^public\/app\.js$/, /^lib\/(request-domain|request-item-service|mutation-api)\.js$/], test: "tests/ordering-workflow-regressions.test.mjs" },
  { name: "receiving", patterns: [/^public\/receiving-sheet(?:\.js|\/)/, /^lib\/(sheet-domain|mutation-api)\.js$/], test: "tests/standing-order-receiving-regressions.test.mjs" },
  { name: "standing orders", patterns: [/^public\/standing-orders(?:\.js|\/)/, /^lib\/(standing-order-domain|standing-order-helpers|workflow-api)\.js$/], test: "tests/standing-order-receiving-regressions.test.mjs" },
  { name: "users and permissions", patterns: [/^public\/(user-admin|menus|settings|page-auth|session)/, /^lib\/(app-user|user-helpers|http-helpers)/, /^views\/pages\/user-admin\.ejs$/], test: "tests/security-admin-internal-data.test.mjs" },
  { name: "database schema", patterns: [/^database\//, /^lib\/postgres-(?:schema|migrations)/], test: "npm run db:baseline:audit" }
];

function normalize(target) {
  return target.split(path.sep).join("/");
}

function fail(message) {
  failures.push(message);
}

async function walk(directory, extensions) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "backups"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(target, extensions));
    else if (extensions.has(path.extname(entry.name))) found.push(target);
  }
  return found;
}

async function existingModule(importer, specifier) {
  if (!specifier.startsWith(".")) return true;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return true;
    } catch {}
  }
  return false;
}

async function checkJavaScript(files) {
  const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const file of files) {
    const relative = normalize(path.relative(repoRoot, file));
    const syntax = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (syntax.status !== 0) fail(`${relative}: JavaScript syntax check failed: ${String(syntax.stderr || syntax.stdout).trim()}`);

    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] || match[2];
      if (!await existingModule(file, specifier)) fail(`${relative}: missing relative import ${specifier}`);
    }
  }
}

async function checkFrontendBoundary(frontendFiles) {
  const forbidden = [
    { pattern: /\b(?:getPool|DATABASE_URL|postgresEnabled)\b/, label: "backend database helper" },
    { pattern: /\b(?:client|pool|db)\.query\s*\(/, label: "direct database query" },
    { pattern: /\b(?:select\s+.+\s+from|insert\s+into|alter\s+table|create\s+(?:table|view)|delete\s+from)\b/i, label: "SQL statement" }
  ];
  for (const file of frontendFiles) {
    const source = await fs.readFile(file, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) {
        fail(`${normalize(path.relative(repoRoot, file))}: ${rule.label} found in frontend code`);
      }
    }
  }
}

function checkMigrations() {
  const versions = POSTGRES_MIGRATIONS.map((migration) => migration.version);
  if (new Set(versions).size !== versions.length) fail("Duplicate Postgres migration version detected.");
  versions.forEach((version, index) => {
    const expected = String(index + 1).padStart(3, "0");
    if (!version.startsWith(`${expected}_`)) fail(`Migration ${version} is out of sequence; expected prefix ${expected}.`);
  });
}

async function checkRoutesAndMenus() {
  const routeDefinitions = await buildPageRouteDefinitions(createViewHelpers(path.join(repoRoot, "views")));
  const routePaths = new Set(routeDefinitions.flatMap((route) => [route.path, ...(route.aliases || [])]));
  const menuSource = await fs.readFile(path.join(repoRoot, "public", "menu-config.js"), "utf8");
  const menuPaths = [...menuSource.matchAll(/href:\s*["']([^"']+)["']/g)].map((match) => match[1]);
  for (const menuPath of menuPaths) {
    if (menuPath !== "__logout__" && !routePaths.has(menuPath)) fail(`Menu points to an undefined page route: ${menuPath}`);
  }
}

function gitChangedFiles() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((entry) => entry.slice(3).trim())
    .filter(Boolean)
    .map((entry) => entry.includes(" -> ") ? entry.split(" -> ").at(-1) : entry)
    .map(normalize);
}

function reportChangedImpact(files) {
  if (!files.length) {
    notes.push("No uncommitted files to map.");
    return;
  }
  const impacts = flowRules.filter((flow) => files.some((file) => flow.patterns.some((pattern) => pattern.test(file))));
  notes.push(`Changed files: ${files.length}`);
  if (!impacts.length) notes.push("No fragile product flow matched the changed files.");
  for (const impact of impacts) notes.push(`Impact: ${impact.name}; verify with ${impact.test}`);
}

async function main() {
  const allCode = await walk(repoRoot, new Set([".js", ".mjs"]));
  const frontend = allCode.filter((file) => {
    const relative = normalize(path.relative(repoRoot, file));
    return relative.startsWith("public/");
  });
  const templates = await walk(path.join(repoRoot, "views"), new Set([".ejs"]));

  if (!changedOnly) {
    await checkJavaScript(allCode);
    await checkFrontendBoundary([...frontend, ...templates]);
    checkMigrations();
    await checkRoutesAndMenus();
  }
  reportChangedImpact(gitChangedFiles());

  if (failures.length) {
    console.error("Codebase inspection failed:");
    failures.forEach((message) => console.error(`- ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log(changedOnly ? "Change impact inspection passed." : "Codebase inspection passed.");
  notes.forEach((message) => console.log(`- ${message}`));
}

await main();
