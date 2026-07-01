import { ensureAppUserBootstrap } from "./runtime-bootstrap/ensure-app-user-bootstrap.js";
import { ensureInternalOrderBootstrap } from "./runtime-bootstrap/ensure-internal-order-bootstrap.js";
import { ensureKitchenRosterBootstrap } from "./runtime-bootstrap/ensure-kitchen-roster-bootstrap.js";
import { ensureReportingViews } from "./runtime-bootstrap/ensure-reporting-views.js";
import { ensureSupportingDomainBootstrap } from "./runtime-bootstrap/ensure-supporting-domain-bootstrap.js";

export async function runLegacySchemaBootstrap(query) {
  await ensureAppUserBootstrap(query);
  await ensureKitchenRosterBootstrap(query);
  await ensureSupportingDomainBootstrap(query);
  await ensureInternalOrderBootstrap(query);
  await ensureReportingViews(query);
}
