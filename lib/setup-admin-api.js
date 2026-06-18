export function createSetupAdminApi({
  requireUser,
  requireRole,
  readJson,
  send,
  itemFormOptions,
  listStorageLocationsAdmin,
  listCategoriesAdmin,
  listSuppliersAdmin,
  listShelfCodesAdmin,
  saveStorageLocation,
  saveCategory,
  deleteCategory,
  saveShelfCode,
  saveSupplier,
  deleteSupplier
}) {
  const setupGuard = "Only admins and power users can manage setup.";
  const itemGuard = "Only admins and power users can add inventory items.";

  return async function handleSetupAdminApi(req, res) {
    if (req.method === "GET" && req.url.startsWith("/api/item-form-options")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, itemGuard)) return true;
      send(res, 200, await itemFormOptions());
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/storage-locations")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      send(res, 200, { storageLocations: await listStorageLocationsAdmin() });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/categories")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      send(res, 200, { categories: await listCategoriesAdmin() });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/suppliers")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      send(res, 200, { suppliers: await listSuppliersAdmin() });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/setup/categories") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const category = await saveCategory(await readJson(req), "", user.name);
      send(res, 201, { category });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/setup/suppliers") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const supplier = await saveSupplier(await readJson(req), "", user.name);
      send(res, 201, { supplier });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/categories/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const recordId = req.url.split("/")[4];
      const category = await saveCategory(await readJson(req), recordId, user.name);
      send(res, 200, { category });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/suppliers/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const recordId = req.url.split("/")[4];
      const supplier = await saveSupplier(await readJson(req), recordId, user.name);
      send(res, 200, { supplier });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/setup/suppliers/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const recordId = req.url.split("/")[4];
      const result = await deleteSupplier(recordId, user.name);
      send(res, 200, { result });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/setup/categories/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const recordId = req.url.split("/")[4];
      const result = await deleteCategory(recordId, user.name);
      send(res, 200, { result });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/setup/storage-locations") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const storageLocation = await saveStorageLocation(await readJson(req), "", user.name);
      send(res, 201, { storageLocation });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/storage-locations/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const recordId = req.url.split("/")[4];
      const storageLocation = await saveStorageLocation(await readJson(req), recordId, user.name);
      send(res, 200, { storageLocation });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/setup/shelf-codes")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      send(res, 200, {
        shelfCodes: await listShelfCodesAdmin(),
        storageLocations: await listStorageLocationsAdmin()
      });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/setup/shelf-codes") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const shelfCode = await saveShelfCode(await readJson(req), "", user.name);
      send(res, 201, { shelfCode });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/setup/shelf-codes/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, setupGuard)) return true;
      const recordId = req.url.split("/")[4];
      const shelfCode = await saveShelfCode(await readJson(req), recordId, user.name);
      send(res, 200, { shelfCode });
      return true;
    }

    return false;
  };
}
