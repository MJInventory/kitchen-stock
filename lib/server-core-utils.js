export function normalizeNotificationAreaName(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "bar") return "bar";
  if (raw === "foh" || raw === "front of house" || raw === "front-house") return "foh";
  if (raw === "kitchen") return "kitchen";
  if (raw === "general") return "general";
  return "";
}

export function clampOpenOrderDays(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, parsed));
}

export function normalizeHiddenMenuItems(values, allowedValues) {
  const allowed = new Set(allowedValues);
  const list = Array.isArray(values)
    ? values
    : String(values || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  return [...new Set(list.filter((entry) => allowed.has(entry)))];
}

export function createServerCoreUtils({ appTimeZone, postgresEnabled, applyPostgresSchemaUpgrades, getPool }) {
  function db() {
    return getPool();
  }

  function hasPostgres() {
    return postgresEnabled();
  }

  async function ensurePostgresSchemaUpgrades() {
    return applyPostgresSchemaUpgrades({ hasPostgres, db });
  }

  function assertPostgresSchemaReady() {
    return applyPostgresSchemaUpgrades.assertReady({ hasPostgres });
  }

  function isValidId(value) {
    return /^[a-z0-9-]+$/i.test(String(value || "").trim());
  }

  function isoDate(value) {
    return String(value || "").slice(0, 10);
  }

  function todayIso() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: appTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  return {
    db,
    hasPostgres,
    ensurePostgresSchemaUpgrades,
    assertPostgresSchemaReady,
    isValidId,
    isoDate,
    todayIso
  };
}
