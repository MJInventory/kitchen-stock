const ORDERING_BOOTSTRAP_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

function validItemRecord(item) {
  return Boolean(String(item?.id || "").trim()) && Boolean(String(item?.name || "").trim());
}

function validRequestRecord(request) {
  return Boolean(String(request?.id || "").trim());
}

function cacheFreshEnough(cachedAt, now = Date.now()) {
  const stamp = String(cachedAt || "").trim();
  if (!stamp) return false;
  const parsed = new Date(stamp).getTime();
  if (!Number.isFinite(parsed)) return false;
  return now - parsed <= ORDERING_BOOTSTRAP_CACHE_MAX_AGE_MS;
}

export function loadOrderingBootstrapCache(cacheKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (!parsed || !cacheFreshEnough(parsed.cachedAt)) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    if (!Array.isArray(parsed.items) || parsed.items.some((item) => !validItemRecord(item))) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    if (Array.isArray(parsed.requests) && parsed.requests.some((request) => !validRequestRecord(request))) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveOrderingBootstrapCache(cacheKey, data) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      items: data.items || [],
      requests: data.requests || [],
      standingOrders: data.standingOrders || [],
      notifications: data.notifications || [],
      summary: data.summary || null,
      cachedAt: new Date().toISOString()
    }));
  } catch {
    // Ignore cache write problems.
  }
}

export function applyOrderingBootstrapData(data = {}, applyState) {
  applyState({
    items: Array.isArray(data.items) ? data.items.filter(validItemRecord) : [],
    requests: Array.isArray(data.requests) ? data.requests.filter(validRequestRecord) : [],
    standingOrders: Array.isArray(data.standingOrders) ? data.standingOrders : [],
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    summary: data.summary || null
  });
}
