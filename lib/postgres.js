import fs from "node:fs";
import { Pool } from "pg";

let pool = null;

function databaseUrl() {
  return process.env.DATABASE_URL || "";
}

function dataBackend() {
  return String(process.env.DATA_BACKEND || "").trim().toLowerCase();
}

function shouldUseSsl() {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.PGSSLMODE === "require") return true;
  const currentDatabaseUrl = databaseUrl();
  if (!currentDatabaseUrl || !currentDatabaseUrl.startsWith("postgres")) return false;
  if (/sslmode=require/i.test(currentDatabaseUrl)) return true;
  try {
    const parsed = new URL(currentDatabaseUrl);
    return /\.render\.com$/i.test(parsed.hostname || "");
  } catch {
    return false;
  }
}

function buildSslConfig() {
  if (!shouldUseSsl()) return false;
  const caFile = process.env.PGSSLROOTCERT || "";
  if (caFile && fs.existsSync(caFile)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(caFile, "utf8")
    };
  }
  return { rejectUnauthorized: false };
}

export function postgresEnabled() {
  if (!databaseUrl()) return false;
  return dataBackend() !== "airtable-only";
}

export function getPool() {
  const currentDatabaseUrl = databaseUrl();
  if (!currentDatabaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: currentDatabaseUrl,
      ssl: buildSslConfig(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)
    });
  }
  return pool;
}

export async function sql(strings, ...values) {
  const text = strings.reduce((result, chunk, index) => (
    result + chunk + (index < values.length ? `$${index + 1}` : "")
  ), "");
  return getPool().query(text, values);
}

export async function withClient(work) {
  const client = await getPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    const active = pool;
    pool = null;
    await active.end();
  }
}
