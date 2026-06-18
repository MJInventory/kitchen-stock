export function createLookupRuntime({
  airtable,
  cache,
  hasPostgres,
  pgListLookups,
  pgFindOrCreateLookupRecord
}) {
  async function getLookups() {
    return pgListLookups();
  }

  async function findOrCreateLookupRecord(lookupKey, value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) return "";
    if (hasPostgres()) {
      return pgFindOrCreateLookupRecord(lookupKey, cleaned);
    }

    const lookups = await getLookups();
    const lookup = lookups[lookupKey];
    if (!lookup?.tableId) return "";

    const existing = lookup.byName.get(cleaned.toLowerCase());
    if (existing) return existing.id;

    const record = await airtable(lookup.tableId, {
      method: "POST",
      body: JSON.stringify({ fields: { [lookup.primaryField]: cleaned } })
    });

    cache.lookups.expiresAt = 0;
    cache.schema.expiresAt = 0;
    return record.id;
  }

  return {
    getLookups,
    findOrCreateLookupRecord
  };
}

export function createHttpServer({
  http,
  send,
  renderView,
  serveStatic,
  buildPageRoute,
  handleAppUserApi,
  handleSetupAdminApi,
  handleOperationsApi,
  handleMutationApi,
  handleWorkflowApi
}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/storage-locations.html") {
        res.writeHead(302, { Location: "/shelf-codes.html" });
        res.end();
        return;
      }

      if (req.method === "GET") {
        const pageRoute = await buildPageRoute(req.url);
        if (pageRoute) {
          await renderView(res, pageRoute.view, pageRoute.options);
          return;
        }
      }

      if (await handleAppUserApi(req, res)) return;
      if (await handleSetupAdminApi(req, res)) return;
      if (await handleOperationsApi(req, res)) return;
      if (await handleMutationApi(req, res)) return;
      if (await handleWorkflowApi(req, res)) return;

      await serveStatic(req, res);
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });
}
