export function createPostgresRuntimeDataHelpers({
  metrics,
  cache,
  itemCacheMs,
  requestCacheMs,
  pgListItems,
  pgListSuppliers,
  pgListRequests,
  pgListOpenRequests
}) {
  async function listItems() {
    return pgListItems();
  }

  async function listSuppliers() {
    return pgListSuppliers();
  }

  async function listRequests() {
    return pgListRequests();
  }

  async function listOpenRequests() {
    return pgListOpenRequests();
  }

  async function cached(key, ttlMs, loader) {
    const entry = cache[key];
    const now = Date.now();

    if (entry.value && entry.expiresAt > now) {
      metrics.cacheHits[key] += 1;
      return entry.value;
    }

    if (!entry.pending) {
      entry.pending = loader()
        .then((value) => {
          entry.value = value;
          entry.expiresAt = Date.now() + ttlMs;
          return value;
        })
        .finally(() => {
          entry.pending = null;
        });
    }

    return entry.pending;
  }

  async function getItems() {
    return cached("items", itemCacheMs, listItems);
  }

  async function getSuppliers() {
    return cached("suppliers", Math.min(itemCacheMs, 60000), listSuppliers);
  }

  async function getRequests() {
    return cached("requests", requestCacheMs, listRequests);
  }

  return {
    listItems,
    listSuppliers,
    listRequests,
    listOpenRequests,
    cached,
    getItems,
    getSuppliers,
    getRequests
  };
}
