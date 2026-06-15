import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "../lib/postgres.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const schemaPath = join(__dirname, "..", "database", "schema.sql");
const schemaSql = await readFile(schemaPath, "utf8");

try {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(schemaSql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  console.log("Postgres schema applied successfully.");
} finally {
  await closePool();
}
