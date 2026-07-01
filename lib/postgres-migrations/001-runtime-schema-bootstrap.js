import { ensureAppUserBootstrap } from "./runtime-bootstrap/ensure-app-user-bootstrap.js";
import { ensureInternalOrderBootstrap } from "./runtime-bootstrap/ensure-internal-order-bootstrap.js";
import { ensureSupportingDomainBootstrap } from "./runtime-bootstrap/ensure-supporting-domain-bootstrap.js";

export async function runLegacySchemaBootstrap(query) {
  await ensureAppUserBootstrap(query);
  await ensureSupportingDomainBootstrap(query);
  await ensureInternalOrderBootstrap(query);
}
