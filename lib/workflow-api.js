export function createWorkflowApi({
  requireUser,
  requireRole,
  readJson,
  send,
  getItems,
  getRequests,
  hasPostgres,
  brevoApiKey,
  mailFrom,
  accountingInbox,
  smtpHost,
  smtpUser,
  smtpPass,
  isRender,
  metrics,
  cache,
  createRequest,
  createRequestsBatch,
  pgListInternalOrders,
  pgCreateInternalOrder,
  pgUpdateInternalOrderRequest,
  pgUpdateInternalOrderPicking,
  createStandingOrder,
  listStandingOrders,
  listStandingOrderRuns,
  updateStandingOrderRecord,
  pgDeleteStandingOrder
}) {
  return async function handleWorkflowApi(req, res) {
    if (req.method === "GET" && req.url.startsWith("/api/items")) {
      if (!requireUser(req, res)) return true;
      send(res, 200, { items: await getItems() });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/requests")) {
      if (!requireUser(req, res)) return true;
      send(res, 200, { requests: await getRequests() });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/health")) {
      send(res, 200, {
        ok: true,
        backend: hasPostgres() ? "postgres" : "airtable",
        email: {
          provider: brevoApiKey ? "Brevo API" : "SMTP",
          hasBrevoApiKey: Boolean(brevoApiKey),
          hasMailFrom: Boolean(mailFrom),
          hasAccountingInbox: Boolean(accountingInbox),
          smtpConfigured: Boolean(smtpHost && smtpUser && smtpPass),
          render: isRender
        },
        metrics,
        cache: {
          itemsCached: Boolean(cache.items.value),
          requestsCached: Boolean(cache.requests.value),
          suppliersCached: Boolean(cache.suppliers.value),
          lookupsCached: Boolean(cache.lookups.value),
          schemaCached: Boolean(cache.schema.value)
        }
      });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/requests") {
      const user = requireUser(req, res);
      if (!user) return true;
      const request = await createRequest(await readJson(req), user.name);
      send(res, 201, { request });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/requests/batch") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseSupplierOrdering, "This user can only create internal requests.")) return true;
      const requests = await createRequestsBatch(await readJson(req), user.name);
      send(res, 201, { requests });
      return true;
    }

    if (req.method === "GET" && req.url === "/api/internal-orders") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPlaceInternalOrders || candidate.permissions.canPickInternalOrders, "This user cannot open internal requests.")) return true;
      send(res, 200, { internalOrders: await pgListInternalOrders(user) });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/internal-orders") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPlaceInternalOrders, "This user cannot create internal requests.")) return true;
      const internalOrder = await pgCreateInternalOrder(await readJson(req), user.name);
      send(res, 201, { internalOrder });
      return true;
    }

    if (req.method === "PATCH" && /^\/api\/internal-orders\/[0-9a-f-]+$/i.test(req.url || "")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPlaceInternalOrders, "This user cannot change internal requests.")) return true;
      const batchId = req.url.split("/")[3];
      const internalOrder = await pgUpdateInternalOrderRequest(batchId, await readJson(req), user);
      send(res, 200, { internalOrder });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/internal-orders/") && req.url.endsWith("/pick")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canPickInternalOrders, "Only pickers can prepare internal requests.")) return true;
      const batchId = req.url.split("/")[3];
      const internalOrder = await pgUpdateInternalOrderPicking(batchId, await readJson(req), user.name);
      send(res, 200, { internalOrder });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/standing-orders") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can create standing orders.")) return true;
      const result = await createStandingOrder(await readJson(req), user);
      send(res, 201, result);
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/standing-orders")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can view standing orders.")) return true;
      send(res, 200, { standingOrders: await listStandingOrders() });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/standing-order-runs")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can view standing order runs.")) return true;
      send(res, 200, { runs: await listStandingOrderRuns() });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/standing-orders/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can update standing orders.")) return true;
      const recordId = req.url.split("/")[3];
      const standingOrder = await updateStandingOrderRecord(recordId, await readJson(req), user);
      send(res, 200, { standingOrder });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/standing-orders/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can delete standing orders.")) return true;
      const recordId = req.url.split("/")[3];
      const result = await pgDeleteStandingOrder(recordId, user);
      send(res, 200, { result });
      return true;
    }

    return false;
  };
}
