import { ensureKitchenRosterBootstrap } from "./runtime-bootstrap/ensure-kitchen-roster-bootstrap.js";

export async function refreshKitchenRosterSchema(query) {
  await ensureKitchenRosterBootstrap(query);
}
