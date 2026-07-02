import { ensureReportingViews } from "./runtime-bootstrap/ensure-reporting-views.js";

export async function refreshReportingViews(query) {
  // This remains the only extracted helper because the reporting/view rebuild
  // block is still large and dependency-sensitive. It is already tracked by
  // an explicit migration, so the remaining risk is documentation/clarity
  // rather than hidden startup schema behavior.
  await ensureReportingViews(query);
}
