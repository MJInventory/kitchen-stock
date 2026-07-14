import { openOrderThresholdDays } from "../ordering/shared.js";

export function formatUserDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw !== raw.toLowerCase()) return raw;
  return raw
    .split(/\s+/)
    .map((part) => part
      .split("-")
      .map((piece) => piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece)
      .join("-"))
    .join(" ");
}

export function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function groupBySupplier(rows) {
  const groups = new Map();
  for (const row of rows) {
    const supplier = row.supplierName || "Unassigned Supplier";
    if (!groups.has(supplier)) groups.set(supplier, []);
    groups.get(supplier).push(row);
  }
  return groups;
}

export function logicalRowCompare(a, b) {
  const category = String(a.category || "").localeCompare(String(b.category || ""));
  if (category) return category;
  const item = String(a.itemName || "").localeCompare(String(b.itemName || ""));
  if (item) return item;
  return String(a.status || "").localeCompare(String(b.status || ""));
}

export function reportRowsForFilter(rows = [], filter = "all") {
  if (filter === "picked") return rows.filter((row) => row.ordered);
  if (filter === "deliver") return rows.filter((row) => row.toDeliver);
  if (filter === "delivered") return rows.filter((row) => row.delivered);
  if (filter === "waiting") return rows.filter((row) => row.waiting);
  return rows;
}

function dateOnly(value) {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 10) : "";
}

export function reportRowIsOlderOpen(row, today = todayLocal()) {
  if (!row?.waiting || row?.delivered) return false;

  const scheduledDay = dateOnly(row?.deliveryDay);
  if (scheduledDay && scheduledDay > today) return false;

  const requestedDay = dateOnly(row?.requestedAt);
  if (!requestedDay) return false;

  const created = new Date(`${requestedDay}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);
  if (Number.isNaN(created.getTime()) || Number.isNaN(todayDate.getTime())) return false;

  const ageDays = Math.floor((todayDate - created) / 86400000);
  return ageDays >= openOrderThresholdDays();
}

export function reportRowToneClass(row, today = todayLocal()) {
  if (row?.delivered) return "report-delivered";
  if (row?.partialReceipt || reportRowIsOlderOpen(row, today)) return "report-overdue";
  return "report-waiting";
}

export function labelForActionType(value) {
  if (value === "add") return "Adds";
  if (value === "delete") return "Deletes";
  return "Changes";
}

export function labelForEntityType(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function labelForReasonCode(value) {
  const code = String(value || "").trim();
  const labels = {
    "category-create": "Category added",
    "category-delete": "Category removed",
    "category-update": "Category changed",
    "daily-guests": "Guest count changed",
    "delivery-complete": "Order fully received",
    "delivery-partial": "Order partly received",
    "driver-assign": "Driver assigned",
    "driver-line-change": "Driver sheet changed",
    "delivery-plan-change": "Delivery plan changed",
    "guest-count-create": "Guest count added",
    "guest-count-update": "Guest count changed",
    "inventory-create": "Item added",
    "inventory-delete": "Item removed",
    "inventory-update": "Item changed",
    "internal-data-create": "Internal data added",
    "internal-data-delete": "Internal data removed",
    "internal-data-update": "Internal data changed",
    "kitchen-roster-lock": "Kitchen schedule locked",
    "kitchen-roster-unlock": "Kitchen schedule unlocked",
    "kitchen-roster-update": "Kitchen schedule changed",
    "order-create": "Order added",
    "order-delete": "Order removed",
    "order-update": "Order changed",
    "password-change": "Own password changed",
    "password-reset": "Password reset",
    "picked-change": "Marked picked or unpicked",
    "shelf-code-create": "Shelf code added",
    "shelf-code-update": "Shelf code changed",
    "standing-order-create": "Standing order added",
    "standing-order-delete": "Standing order removed",
    "standing-order-update": "Standing order changed",
    "stock-count": "Stock count saved",
    "storage-location-create": "Storage location added",
    "storage-location-update": "Storage location changed",
    "supplier-create": "Supplier added",
    "supplier-delete": "Supplier removed",
    "supplier-note-create": "Delivery memo added",
    "supplier-note-delete": "Delivery memo removed",
    "supplier-note-update": "Delivery memo changed",
    "supplier-primary-change": "Supplier changed permanently",
    "supplier-temp-change": "Supplier changed one time",
    "supplier-update": "Supplier changed",
    "unit-change": "Order unit changed",
    "user-create": "User added",
    "user-delete": "User removed",
    "user-update": "User changed"
  };
  return labels[code] || labelForEntityType(code);
}
