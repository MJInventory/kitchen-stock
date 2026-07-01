import { ensureInternalOrderBootstrap } from "./runtime-bootstrap/ensure-internal-order-bootstrap.js";

export async function refreshInternalOrderSchema(query) {
  await ensureInternalOrderBootstrap(query);
}
