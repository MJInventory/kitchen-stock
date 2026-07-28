import fs from "node:fs";
import { Pool } from "pg";

let pool = null;

function databaseUrl() {
  return process.env.DATABASE_URL || "";
}

function dataBackend() {
  return String(process.env.DATA_BACKEND || "").trim().toLowerCase();
}

function databaseSchema() {
  const value = String(process.env.DATABASE_SCHEMA || "").trim();
  if (!value) return "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("DATABASE_SCHEMA must contain only letters, numbers, and underscores.");
  }
  return value;
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
    const schema = databaseSchema();
    const poolOptions = {
      connectionString: currentDatabaseUrl,
      ssl: buildSslConfig(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000),
      application_name: process.env.PG_APP_NAME || "mj-stock-magic"
    };
    if (schema) {
      poolOptions.options = `-c search_path=${schema}`;
    }
    pool = new Pool(poolOptions);
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
