export function createMutationApi({
  requireUser,
  requireRole,
  readJson,
  send,
  updateItemSettings,
  deleteInventoryItem,
  createInventoryItem,
  createStockCount,
  createInvoiceCapture,
  createInvoiceLine,
  listOcrRules,
  createOcrRule,
  emailInvoicePicture,
  ocrSpaceParseImage,
  updateRequest,
  deliverRequest,
  deliverStandingOrderRunLine,
  updateStandingOrderRunLine,
  undoDeliveredStandingOrderRunLine,
  undoDeliveredRequest,
  restoreDeletedRequestFromAudit,
  updateDriverLine,
  deliverDriverLine,
  canDeleteRequest,
  deleteRequest,
  deleteStandingOrderRunLine
}) {
  function readReceivedQuantity(payload = {}) {
    return payload?.quantityReceived ?? payload?.receivedQuantity ?? payload?.receiveQuantity ?? payload?.quantity;
  }

  return async function handleMutationApi(req, res) {
    if (req.method === "PATCH" && req.url.startsWith("/api/items/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can edit inventory setup.")) return true;
      const recordId = req.url.split("/")[3];
      const item = await updateItemSettings(recordId, await readJson(req), user.name);
      send(res, 200, { item });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/items/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can delete inventory items.")) return true;
      const recordId = req.url.split("/")[3];
      const result = await deleteInventoryItem(recordId, user.name);
      send(res, 200, { result });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/items") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can add inventory items.")) return true;
      const item = await createInventoryItem(await readJson(req), user.name);
      send(res, 201, { item });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/stock-counts") {
      const user = requireUser(req, res);
      if (!user) return true;
      const result = await createStockCount(await readJson(req), user.name);
      send(res, 201, result);
      return true;
    }

    if (req.method === "POST" && req.url === "/api/invoice-captures") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return true;
      const invoice = await createInvoiceCapture(await readJson(req), user.name);
      send(res, 201, { invoice });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/invoice-lines") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return true;
      const invoiceLine = await createInvoiceLine(await readJson(req), user.name);
      send(res, 201, { invoiceLine });
      return true;
    }

    if (req.method === "GET" && req.url.startsWith("/api/ocr-rules")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return true;
      const url = new URL(req.url, "http://localhost");
      const rules = await listOcrRules(url.searchParams.get("supplier"));
      send(res, 200, { rules });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/ocr-rules") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return true;
      const payload = await readJson(req);
      const rule = await createOcrRule(payload, user.name);
      send(res, 201, { rule });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/email-invoice") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canSendInvoiceToAccounting, "Only admins can send invoices to accounting.")) return true;
      const result = await emailInvoicePicture(await readJson(req), user.name);
      send(res, 200, { result });
      return true;
    }

    if (req.method === "POST" && req.url === "/api/ocr-invoice") {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canUseInvoices, "Only admins and power users can use invoices.")) return true;
      const result = await ocrSpaceParseImage(await readJson(req));
      send(res, 200, { result });
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/receive")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const request = await deliverRequest(recordId, user.name, {
        quantityReceived: readReceivedQuantity(payload)
      });
      send(res, 200, { request });
      return true;
    }

    if (req.method === "PATCH" && /^\/api\/requests\/[^/]+$/i.test(req.url || "")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const recordId = req.url.split("/")[3];
      if (!(await canDeleteRequest(recordId, user))) {
        send(res, 403, { error: "Regular users can only edit order lines they added themselves." });
        return true;
      }
      const request = await updateRequest(recordId, await readJson(req), user.name);
      send(res, 200, { request });
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const request = await deliverRequest(recordId, user.name, {
        quantityReceived: readReceivedQuantity(payload)
      });
      send(res, 200, { request });
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/standing-order-run-lines/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can receive standing-order lines.")) return true;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const request = await deliverStandingOrderRunLine(recordId, user.name, {
        quantityReceived: readReceivedQuantity(payload)
      });
      send(res, 200, { request });
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/standing-order-run-lines/") && req.url.endsWith("/undo-delivery")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can undo received standing-order lines.")) return true;
      const recordId = req.url.split("/")[3];
      const request = await undoDeliveredStandingOrderRunLine(recordId, user.name);
      send(res, 200, { request });
      return true;
    }

    if (req.method === "PATCH" && /^\/api\/standing-order-run-lines\/[0-9a-f-]+$/i.test(req.url || "")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can update standing-order lines.")) return true;
      const recordId = req.url.split("/")[3];
      const line = await updateStandingOrderRunLine(recordId, await readJson(req), user.name);
      send(res, 200, { line });
      return true;
    }

    if (req.method === "PATCH" && req.url.startsWith("/api/driver-lines/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const recordId = req.url.split("/")[3];
      const line = await updateDriverLine(recordId, await readJson(req), user.name);
      send(res, 200, { line });
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/driver-lines/") && req.url.endsWith("/deliver")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const recordId = req.url.split("/")[3];
      const payload = await readJson(req);
      const result = await deliverDriverLine(recordId, String(payload.requestId || ""), user.name, {
        quantityReceived: readReceivedQuantity(payload)
      });
      send(res, 200, result);
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/") && req.url.endsWith("/undo-delivery")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can undo received orders.")) return true;
      const recordId = req.url.split("/")[3];
      const request = await undoDeliveredRequest(recordId, user.name);
      send(res, 200, { request });
      return true;
    }

    if (req.method === "POST" && req.url.startsWith("/api/requests/restore-from-audit/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can restore removed orders.")) return true;
      const auditId = req.url.split("/")[4];
      const request = await restoreDeletedRequestFromAudit(auditId, user.name);
      send(res, 200, { request });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/requests/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      const recordId = req.url.split("/")[3];
      if (!(await canDeleteRequest(recordId, user))) {
        send(res, 403, { error: "Regular users can only remove order lines they added themselves." });
        return true;
      }
      const result = await deleteRequest(recordId, user.name);
      send(res, 200, { result });
      return true;
    }

    if (req.method === "DELETE" && req.url.startsWith("/api/standing-order-run-lines/")) {
      const user = requireUser(req, res);
      if (!user) return true;
      if (!requireRole(user, res, (candidate) => candidate.permissions.canAddInventoryItems, "Only admins and power users can remove standing-order lines.")) return true;
      const recordId = req.url.split("/")[3];
      const result = await deleteStandingOrderRunLine(recordId, user.name);
      send(res, 200, { result });
      return true;
    }

    return false;
  };
}
