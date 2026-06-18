export function standingSupplierFromNotes(notes) {
  const match = String(notes || "").match(/^Standing supplier:\s*(.+?)\.?$/im);
  return match ? match[1].trim().replace(/\.$/, "") : "";
}

export function standingRunIdFromNotes(notes) {
  const match = String(notes || "").match(/^Standing run id:\s*(rec[a-zA-Z0-9]+)\.?$/im);
  return match ? match[1].trim() : "";
}

export function standingRunLineIdFromNotes(notes) {
  const match = String(notes || "").match(/^Standing run line id:\s*(rec[a-zA-Z0-9]+)\.?$/im);
  return match ? match[1].trim() : "";
}

export function isStandingOrderRequestRow(row) {
  return Boolean(String(row?.standingRunId || "").trim())
    || Boolean(String(row?.standingRunLineId || "").trim())
    || String(row?.requestedBy || "").toLowerCase().includes("standing order")
    || String(row?.notes || "").toLowerCase().includes("standing order");
}
