import fs from "node:fs";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || "";
const dataBackend = String(process.env.DATA_BACKEND || "").trim().toLowerCase();

let pool = null;

function shouldUseSsl() {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.PGSSLMODE === "require") return true;
  if (!databaseUrl || !databaseUrl.startsWith("postgres")) return false;
  if (/sslmode=require/i.test(databaseUrl)) return true;
  try {
    const parsed = new URL(databaseUrl);
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
  if (!databaseUrl) return false;
  return dataBackend !== "airtable-only";
}

export function getPool() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
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
