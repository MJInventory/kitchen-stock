export function createLegacySheetDomain({
  airtable,
  getSchema,
  listAirtableRecords,
  normalizeDriverLine,
  standingSupplierFromNotes,
  standingRunIdFromNotes,
  standingRunLineIdFromNotes,
  getSuppliers,
  updateItemPrimarySupplier,
  allowedUnits,
  deliverRequest,
  patchStandingOrderRunLine,
  closeStandingOrderRunIfComplete
}) {
  async function assignLegacyDriverToSheet(date, driverName, user, listDriverSheet) {
    if (!user.permissions?.canAdminUsers) {
      throw new Error("Only admins can assign a driver.");
    }

    const schema = await getSchema();
    const tableId = schema.tables.driverSheetLines;
    if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");
    if (!schema.driverLines.hasDriver) throw new Error("Add a Driver field to the Driver Sheet Lines table first.");

    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().slice(0, 10);
    await listDriverSheet(selectedDate);
    const lines = await listLegacyDriverSheetLines(tableId, selectedDate);
    const cleanedDriver = String(driverName || "").trim();
    if (!cleanedDriver) throw new Error("Driver name is required.");

    for (const line of lines) {
      await airtable(`${tableId}/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { Driver: cleanedDriver } })
      });
    }

    return {
      date: selectedDate,
      driverName: cleanedDriver,
      updated: lines.length
    };
  }

  async function persistLegacyDriverSheetLines(tableId, sheetDate, requests) {
    const schema = await getSchema();
    const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
    const existing = { records: await listAirtableRecords(tableId, { filterByFormula: formula }) };
    const existingKeys = new Set(
      existing.records.map((record) => `${record.fields["Item Request Record ID"] || ""}|${record.fields["Sheet Date"] || ""}`)
    );
    const inheritedDriver = existing.records.find((record) => record.fields.Driver)?.fields.Driver || "";

    for (const request of requests) {
      const key = `${request.id}|${sheetDate}`;
      if (existingKeys.has(key)) continue;

      const isStanding = String(request.requestedBy || "").includes("Standing Order") || String(request.notes || "").includes("Standing order:");
      const standingSupplier = standingSupplierFromNotes(request.notes);
      const standingRunId = standingRunIdFromNotes(request.notes);
      const standingRunLineId = standingRunLineIdFromNotes(request.notes);
      const fields = {
        "Sheet Line": `${sheetDate} - ${request.requestId || request.id}`,
        "Sheet Date": sheetDate,
        "Item Request Record ID": request.id,
        "Request ID": request.requestId || 0,
        "Inventory Item Record ID": request.itemId,
        "Item Name": request.itemName,
        Category: request.category || undefined,
        "Supplier Name": standingSupplier || request.supplierName,
        "Supplier Contact": request.supplierContact,
        Quantity: request.quantity || 0,
        Unit: request.unit,
        "Inventory Area": request.inventoryArea || undefined,
        "Storage Location": request.storageLocation || undefined,
        "Inventory Subgroup": request.category || "",
        "Shelf Code": request.shelfCode || "",
        "Request Status": request.status,
        Received: Boolean(request.received),
        "2Deliver": isStanding,
        Notes: request.notes || ""
      };
      if (schema.driverLines.hasDriver && inheritedDriver) fields.Driver = inheritedDriver;
      if (isStanding && schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = sheetDate;
      if (isStanding && schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = sheetDate;
      if (standingRunId && schema.driverLines.hasStandingRunId) fields["Standing Order Run ID"] = standingRunId;
      if (standingRunLineId && schema.driverLines.hasStandingRunLineId) fields["Standing Order Run Line ID"] = standingRunLineId;

      const created = await airtable(tableId, {
        method: "POST",
        body: JSON.stringify({ fields })
      });
      if (standingRunLineId) {
        if (typeof patchStandingOrderRunLine !== "function") {
          throw new Error("Standing order run line patch helper is not available.");
        }
        await patchStandingOrderRunLine(standingRunLineId, { "Driver Line Record ID": created.id });
      }
    }
  }

  async function listLegacyDriverSheetLines(tableId, sheetDate) {
    const formula = `IS_SAME({Sheet Date}, '${sheetDate}', 'day')`;
    const records = await listAirtableRecords(tableId, { filterByFormula: formula });
    return records.map(normalizeDriverLine);
  }

  async function updateLegacyDriverLine(recordId, payload, userName) {
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid driver line record.");
    }

    const schema = await getSchema();
    const tableId = schema.tables.driverSheetLines;
    if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");

    const fields = {};

    if (Object.prototype.hasOwnProperty.call(payload, "ordered")) {
      const ordered = Boolean(payload.ordered);
      fields.Ordered = ordered;
      fields["Ordered Date/Time"] = ordered ? new Date().toISOString() : null;
      fields["Ordered By"] = ordered ? userName : "";
    }

    if (Object.prototype.hasOwnProperty.call(payload, "toDeliver")) {
      const toDeliver = Boolean(payload.toDeliver);
      fields["2Deliver"] = toDeliver;
      if (toDeliver) {
        const deliveryDay = String(payload.deliveryDay || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDay)) {
          throw new Error("Choose the delivery day for 2Deliver items.");
        }
        if (schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = deliveryDay;
        else if (schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = deliveryDay;
        else throw new Error("Add a Delivery Day field to the Driver Sheet Lines table first.");
      } else {
        if (schema.driverLines.hasDeliveryDay) fields["Delivery Day"] = null;
        if (schema.driverLines.hasDeliveryDate) fields["Delivery Date"] = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "supplierName")) {
      const supplierName = String(payload.supplierName || "").trim();
      const suppliers = await getSuppliers();
      const supplier = suppliers.find((entry) => entry.name.toLowerCase() === supplierName.toLowerCase());
      fields["Supplier Name"] = supplierName || "Unassigned Supplier";
      fields["Supplier Contact"] = supplier?.contact || "";

      if (payload.updatePrimarySupplier) {
        if (!supplier) throw new Error("Choose a known supplier before changing the primary supplier.");
        const currentLine = normalizeDriverLine(await airtable(`${tableId}/${recordId}`));
        await updateItemPrimarySupplier(currentLine.itemRecordId, supplier);
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, "unit")) {
      const unit = String(payload.unit || "").trim().toLowerCase();
      if (!unit) throw new Error("Unit is required.");
      fields.Unit = unit;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "quantity")) {
      const quantity = Number(payload.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }
      fields.Quantity = quantity;
    }

    if (!Object.keys(fields).length) {
      throw new Error("Nothing to update.");
    }

    const record = await airtable(`${tableId}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });

    return normalizeDriverLine(record);
  }

  async function deliverLegacyDriverLine(recordId, requestRecordId, userName) {
    if (!/^rec[a-zA-Z0-9]+$/.test(recordId || "")) {
      throw new Error("Invalid driver line record.");
    }
    if (!/^rec[a-zA-Z0-9]+$/.test(requestRecordId || "")) {
      throw new Error("Invalid request record.");
    }

    const schema = await getSchema();
    const tableId = schema.tables.driverSheetLines;
    if (!tableId) throw new Error("Driver Sheet Lines table is not configured.");

    const existingLineRecord = await airtable(`${tableId}/${recordId}`);
    const existingLine = normalizeDriverLine(existingLineRecord);
    const request = await deliverRequest(requestRecordId, userName);
    const receivedAt = new Date().toISOString();
    const runId = existingLine.standingRunId || standingRunIdFromNotes(existingLine.notes) || standingRunIdFromNotes(request.notes);
    const runLineId = existingLine.standingRunLineId || standingRunLineIdFromNotes(existingLine.notes) || standingRunLineIdFromNotes(request.notes);
    const record = await airtable(`${tableId}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          Received: true,
          "Received Date/Time": receivedAt,
          "Received By": userName,
          "Request Status": "Fulfilled"
        }
      })
    });

    if (runLineId) {
      if (typeof patchStandingOrderRunLine !== "function") {
        throw new Error("Standing order run line patch helper is not available.");
      }
      await patchStandingOrderRunLine(runLineId, {
        Received: true,
        "Received At": receivedAt,
        "Received By": userName,
        Status: "Received",
        "Driver Line Record ID": recordId,
        "Request Record ID": requestRecordId
      });
    }
    if (runId) {
      if (typeof closeStandingOrderRunIfComplete !== "function") {
        throw new Error("Standing order completion helper is not available.");
      }
      await closeStandingOrderRunIfComplete(runId, userName);
    }

    return {
      request,
      line: normalizeDriverLine(record)
    };
  }

  return {
    assignLegacyDriverToSheet,
    persistLegacyDriverSheetLines,
    listLegacyDriverSheetLines,
    updateLegacyDriverLine,
    deliverLegacyDriverLine
  };
}
