export function createOperationsApi({
  requireUser,
  requireRole,
  readJson,
  send,
  getItems,
  listOpenRequests,
  listStandingOrders,
  pgListNotificationsForUser,
  pgMarkNotificationsRead,
  listDriverSheet,
  assignDriverToSheet,
  listReceivingSheet,
  pgSaveSupplierDeliveryNote,
  listOrderReport,
  getDailyGuestCount,
  saveDailyGuestCount
}) {
  return async function handleOperationsApi(req, res) {
    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const [items, requests, standingOrders, notifications] = await Promise.all([
        getItems(),
        listOpenRequests(),
        listStandingOrders(),
        pgListNotificationsForUser(user.name)
      ]);
      send(res, 200, {
        items,
        requests,
        notifications,
        standingOrders: standingOrders
          .filter((order) => order.active !== false)
          .sort((a, b) => {
            const dateCompare = String(a.expectedDate || "").localeCompare(String(b.expectedDate || ""));
            if (dateCompare) return dateCompare;
            const supplierCompare = String(a.supplierName || "").localeCompare(String(b.supplierName || ""));
            if (supplierCompare) return supplierCompare;
            return String(a.name || "").localeCompare(String(b.name || ""));
          })
      });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/notifications/read") {
      const user = requireUser(req, res);
      if (!user) return true;
      const payload = await readJson(req);
      const result = await pgMarkNotificationsRead(user.name, payload.ids || []);
      send(res, 200, { result, notifications: await pgListNotificationsForUser(user.name) });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/driver-sheet")) {
      if (!requireUser(req, res)) return true;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listDriverSheet(url.searchParams.get("date")));
      return true;
    }

    if (req.method === "PATCH" && req.url === "/api/driver-sheet/driver") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can assign a driver.")) return true;
      const payload = await readJson(req);
      send(res, 200, await assignDriverToSheet(payload.date, payload.driverName, user));
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/receiving-sheet")) {
      if (!requireUser(req, res)) return true;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listReceivingSheet(url.searchParams.get("date")));
      return true;
    }

    if (req.method === "POST" && req.url === "/api/receiving-notes") {
      const user = requireUser(req, res);
      if (!user) return true;
      const note = await pgSaveSupplierDeliveryNote(await readJson(req), user.name);
      send(res, 200, { note });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/order-report")) {
      if (!requireUser(req, res)) return true;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listOrderReport(url.searchParams.get("date")));
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/daily-guests")) {
      if (!requireUser(req, res)) return true;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, { guestCount: await getDailyGuestCount(url.searchParams.get("date")) });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/daily-guests") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAdminUsers, "Only admins can enter daily guest counts.")) return true;
      const guestCount = await saveDailyGuestCount(await readJson(req), user);
      send(res, 200, { guestCount });
      return true;
    }

    return false;
  };
}
