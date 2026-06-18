export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function todayLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function sortByLabel(records, getLabel) {
  return [...(records || [])].sort((left, right) =>
    String(getLabel(left) || "").localeCompare(String(getLabel(right) || ""), undefined, { numeric: true })
  );
}

export function scheduleOptions(selectedSchedule) {
  return ["Daily", "Weekly", "One Time", "Other"]
    .map((value) => `<option${value === selectedSchedule ? " selected" : ""}>${value}</option>`)
    .join("");
}
