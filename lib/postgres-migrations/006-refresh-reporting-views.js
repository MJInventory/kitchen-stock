import { ensureReportingViews } from "./runtime-bootstrap/ensure-reporting-views.js";

export async function refreshReportingViews(query) {
  await ensureReportingViews(query);
}
