import { closePool, sql } from "../lib/postgres.js";

try {
  const result = await sql`select current_database() as database_name, current_user as database_user, now() as checked_at`;
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await closePool();
}
