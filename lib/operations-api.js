export function createOperationsApi({
  requireUser,
  requireRole,
  readJson,
  send,
  getItems,
  listOpenRequests,
  listStandingOrders,
  getDashboardSummary,
  pgListNotificationsForUser,
  pgMarkNotificationsRead,
  listDriverSheet,
  assignDriverToSheet,
  listReceivingSheet,
  pgSaveSupplierDeliveryNote,
  listOrderReport,
  getDailyGuestCount,
  saveDailyGuestCount,
  getManagementReport,
  listKitchenRoster,
  saveKitchenRoster,
  setKitchenRosterLocked
}) {
  return async function handleOperationsApi(req, res) {
    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const [items, requests, standingOrders, notifications] = await Promise.all([
        getItems(),
        listOpenRequests(),
        listStandingOrders({ activeOnly: true }),
        pgListNotificationsForUser(user.name)
      ]);
      const summary = await getDashboardSummary(user, {
        unreadCount: notifications.filter((note) => !note.isRead).length
      });
      send(res, 200, {
        items,
        requests,
        notifications,
        summary,
        standingOrders
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

    if (req.method === "GET" && req.url.startsWith("/api/management-report")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only inventory admins can use the management report.")) return true;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await getManagementReport({
        mode: url.searchParams.get("mode"),
        date: url.searchParams.get("date"),
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to")
      }));
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/kitchen-roster")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canManageKitchenRoster, "Only kitchen admins can manage the kitchen roster.")) return true;
      const url = new URL(req.url, "http://localhost");
      send(res, 200, await listKitchenRoster(url.searchParams.get("date"), user));
      return true;
    }

    if (req.method === "POST" && req.url === "/api/kitchen-roster") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canManageKitchenRoster, "Only kitchen admins can manage the kitchen roster.")) return true;
      send(res, 200, await saveKitchenRoster(await readJson(req), user));
      return true;
    }

    if (req.method === "POST" && req.url === "/api/kitchen-roster/lock") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canManageKitchenRoster, "Only kitchen admins can lock the kitchen roster.")) return true;
      send(res, 200, await setKitchenRosterLocked(await readJson(req), user));
      return true;
    }

    return false;
  };
}
