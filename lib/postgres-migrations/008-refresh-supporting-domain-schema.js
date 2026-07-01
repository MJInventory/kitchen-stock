import { ensureSupportingDomainBootstrap } from "./runtime-bootstrap/ensure-supporting-domain-bootstrap.js";

export async function refreshSupportingDomainSchema(query) {
  await ensureSupportingDomainBootstrap(query);
}
