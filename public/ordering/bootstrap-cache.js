export function loadOrderingBootstrapCache(cacheKey) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey) || "null");
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
      cachedAt: new Date().toISOString()
    }));
  } catch {
    // Ignore cache write problems.
  }
}

export function applyOrderingBootstrapData(data = {}, applyState) {
  applyState({
    items: Array.isArray(data.items) ? data.items : [],
    requests: Array.isArray(data.requests) ? data.requests : [],
    standingOrders: Array.isArray(data.standingOrders) ? data.standingOrders : [],
    notifications: Array.isArray(data.notifications) ? data.notifications : []
  });
}
