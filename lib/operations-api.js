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
  setKitchenRosterLocked,
  listKitchenShiftTypesAdmin,
  saveKitchenShiftType,
  listInternalDataServices,
  saveInternalDataService,
  deleteInternalDataService
}) {
  async function loadWithDiagnostics(name, fallbackValue, work) {
    const startedAt = Date.now();
    try {
      const value = await work();
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 1000) {
        console.warn(`[operations-api] ${name} took ${elapsed}ms`);
      }
      return value;
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      console.error(`[operations-api] ${name} failed after ${elapsed}ms:`, error?.message || error);
      return fallbackValue;
    }
  }

  return async function handleOperationsApi(req, res) {
    if (req.method === "GET" && req.url.startsWith("/api/bootstrap")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const url = new URL(req.url, "http://localhost");
      const includeStandingOrders = url.searchParams.get("includeStandingOrders") !== "false";
      const [items, requests, standingOrders, notifications] = await Promise.all([
        loadWithDiagnostics("bootstrap.items", [], () => getItems()),
        loadWithDiagnostics("bootstrap.requests", [], () => listOpenRequests()),
        includeStandingOrders
          ? loadWithDiagnostics("bootstrap.standingOrders", [], () => listStandingOrders({ activeOnly: true }))
          : Promise.resolve([]),
        loadWithDiagnostics("bootstrap.notifications", [], () => pgListNotificationsForUser(user.name))
      ]);
      const summary = await loadWithDiagnostics("bootstrap.summary", {
        dashboard: { today: 0, mine: 0, older: 0, below: 0, standing: 0, unread: 0 },
        ordering: { mine: 0, team: 0, older: 0, below: 0, standing: 0 }
      }, () => getDashboardSummary(user, {
        unreadCount: notifications.filter((note) => !note.isRead).length
      }));
      send(res, 200, {
        items,
        requests,
        notifications,
        summary,
        standingOrders
      });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/bootstrap-standing-orders")) {
      const user = requireUser(req, res);
      if (!user) return true;
      send(res, 200, {
        standingOrders: await loadWithDiagnostics("bootstrap.standingOrdersOnly", [], () => listStandingOrders({ activeOnly: true }))
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
      if (!requireRole(user, res, (candidate) => candidate.permissions.canViewKitchenRoster, "You do not have access to view the kitchen roster.")) return true;
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

    if (req.method === "GET" && req.url === "/api/kitchen-roster/shifts") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canManageKitchenRoster, "Only kitchen admins can manage shifts.")) return true;
      send(res, 200, await listKitchenShiftTypesAdmin());
      return true;
    }

    if (req.method === "POST" && req.url === "/api/kitchen-roster/shifts") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canManageKitchenRoster, "Only kitchen admins can manage shifts.")) return true;
      send(res, 200, await saveKitchenShiftType(await readJson(req), user));
      return true;
    }

    if (req.method === "GET" && req.url === "/api/internal-data-services") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canViewInternalData, "Only Security Admin users can view internal data.")) return true;
      send(res, 200, { services: await listInternalDataServices() });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/internal-data-services") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canViewInternalData, "Only Security Admin users can manage internal data.")) return true;
      send(res, 201, { service: await saveInternalDataService(await readJson(req), "", user.name || "") });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/internal-data-services/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canViewInternalData, "Only Security Admin users can manage internal data.")) return true;
      const recordId = req.url.split("/")[3];
      send(res, 200, { service: await saveInternalDataService(await readJson(req), recordId, user.name || "") });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/internal-data-services/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canViewInternalData, "Only Security Admin users can manage internal data.")) return true;
      const recordId = req.url.split("/")[3];
      send(res, 200, { result: await deleteInternalDataService(recordId) });
      return true;
    }

    return false;
  };
}
