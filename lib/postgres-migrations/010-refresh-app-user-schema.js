import { ensureAppUserBootstrap } from "./runtime-bootstrap/ensure-app-user-bootstrap.js";

export async function refreshAppUserSchema(query) {
  await ensureAppUserBootstrap(query);
}
