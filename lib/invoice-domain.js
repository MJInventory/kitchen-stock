export function createInvoiceDomain({
  nodemailer,
  accountingInbox,
  brevoApiKey,
  db,
  getItems,
  getSchema,
  hasPostgres,
  inventoryTableId,
  invoiceOcrRulesTableId,
  isRender,
  isValidId,
  mailFrom,
  ocrSpaceApiKey,
  pgFindOrCreateSupplierByName,
  pgNumber,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpSecure,
  smtpUser,
  airtable
}) {
  function requireEmailConfig() {
    if (brevoApiKey) {
      if (!mailFrom) throw new Error("Email is not configured yet. Add MAIL_FROM in Render.");
      return;
    }

    if (isRender) {
      throw new Error("Email is not configured for Render. Add BREVO_API_KEY and MAIL_FROM in Render environment variables. SMTP ports time out on Render.");
    }

    const missing = [];
    if (!smtpHost) missing.push("SMTP_HOST");
    if (!smtpUser) missing.push("SMTP_USER");
    if (!smtpPass) missing.push("SMTP_PASS");
    if (!mailFrom) missing.push("MAIL_FROM");
    if (missing.length) {
      throw new Error(`Email is not configured yet. Add BREVO_API_KEY and MAIL_FROM, or add SMTP settings: ${missing.join(", ")}.`);
    }
  }

  function attachmentFromDataUrl(dataUrl, fileName) {
    const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invoice image data was not valid.");

    const content = Buffer.from(match[2], "base64");
    if (!content.length) throw new Error("Invoice image was empty.");
    if (content.length > 12 * 1024 * 1024) throw new Error("Invoice image is too large to email. Retake a smaller photo.");

    return {
      filename: String(fileName || "invoice.jpg").replace(/[^\w.\- ]+/g, "_"),
      contentType: match[1],
      content
    };
  }

  async function ocrSpaceParseImage(payload) {
    const dataUrl = String(payload.dataUrl || "");
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("OCR file data was not valid.");

    const mimeType = match[1].toLowerCase();
    const fileBytes = Buffer.from(match[2], "base64");
    if (!fileBytes.length) throw new Error("OCR file was empty.");
    if (fileBytes.length > 1024 * 1024) {
      throw new Error("OCR.space free API accepts files up to 1 MB. Use a smaller PDF/photo or split the invoice.");
    }

    const form = new FormData();
    form.set("base64Image", dataUrl);
    form.set("language", "eng");
    form.set("isOverlayRequired", "false");
    form.set("detectOrientation", "true");
    form.set("scale", "true");
    form.set("isTable", "true");
    form.set("OCREngine", String(payload.engine || "2"));
    if (mimeType === "application/pdf") {
      form.set("filetype", "PDF");
    }

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: ocrSpaceApiKey
      },
      body: form
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OCR.space request failed with status ${response.status}.`);
    }

    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("OCR.space returned an unreadable response.");
    }

    if (data.IsErroredOnProcessing) {
      const detail = Array.isArray(data.ErrorMessage)
        ? data.ErrorMessage.join(" ")
        : data.ErrorMessage || data.ErrorDetails || "OCR failed.";
      throw new Error(detail);
    }

    const parsed = Array.isArray(data.ParsedResults) ? data.ParsedResults : [];
    const lines = parsed.flatMap((result) => String(result.ParsedText || "").split(/\r?\n/));
    const text = lines.map((line) => line.trimEnd()).join("\n").trim();
    if (!text) {
      throw new Error("OCR did not find readable text in that file.");
    }

    return {
      text,
      provider: "ocr.space",
      parsedResults: parsed,
      fileType: mimeType
    };
  }

  function pgInvoiceCaptureFromRow(row) {
    return {
      id: row.id,
      supplierName: row.supplier_name || "",
      invoiceNumber: row.invoice_number || "",
      invoiceTotal: row.invoice_total == null ? "" : pgNumber(row.invoice_total),
      photoUrl: row.image_url || "",
      extractedText: row.ocr_text || "",
      notes: row.notes || "",
      capturedBy: row.captured_by_username || "",
      capturedAt: row.captured_at || ""
    };
  }

  function pgInvoiceRuleFromRow(row) {
    return {
      id: row.id,
      supplierName: row.supplier_name || "",
      ruleType: row.rule_type || "",
      ocrMatchText: row.ocr_match_text || "",
      targetField: row.target_field || "",
      inventoryItemId: row.inventory_item_id || "",
      inventoryItemName: row.inventory_item_name || "",
      notes: row.notes || "",
      active: row.active !== false
    };
  }

  async function createInvoiceCapture(payload, userName) {
    if (hasPostgres()) {
      const supplier = await pgFindOrCreateSupplierByName(payload.supplierName);
      const invoiceNumber = String(payload.invoiceNumber || "").trim();
      const invoiceTotal = String(payload.invoiceTotal || "").trim() === "" ? null : Number(payload.invoiceTotal);
      if (invoiceTotal !== null && !Number.isFinite(invoiceTotal)) {
        throw new Error("Invoice total must be a number.");
      }
      const result = await db().query(`
        insert into invoice_captures (
          supplier_id, invoice_number, invoice_total, captured_by_username,
          image_name, image_url, ocr_text, notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id, $9::text as supplier_name, invoice_number, invoice_total,
                  image_url, ocr_text, notes, captured_by_username, captured_at
      `, [
        supplier?.id || null,
        invoiceNumber,
        invoiceTotal,
        userName,
        "",
        String(payload.photoUrl || ""),
        String(payload.extractedText || ""),
        String(payload.notes || ""),
        supplier?.name || String(payload.supplierName || "")
      ]);
      return pgInvoiceCaptureFromRow(result.rows[0]);
    }
    const schema = await getSchema();
    const tableId = schema.tables.invoiceCaptures;
    if (!tableId) throw new Error("Invoice Captures table was not found.");

    const supplierName = String(payload.supplierName || "");
    const invoiceNumber = String(payload.invoiceNumber || "");
    const invoiceTotal = payload.invoiceTotal === "" ? null : Number(payload.invoiceTotal);
    const photoUrl = String(payload.photoUrl || "");
    const extractedText = String(payload.extractedText || "");
    const notes = String(payload.notes || "");

    if (invoiceTotal !== null && !Number.isFinite(invoiceTotal)) {
      throw new Error("Invoice total must be a number.");
    }

    const capturedAt = new Date().toISOString();
    const record = await airtable(tableId, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Invoice Capture": `${supplierName || "Invoice"} - ${capturedAt.slice(0, 10)}`,
          "Capture Date/Time": capturedAt,
          "Supplier Name": supplierName,
          "Invoice Number": invoiceNumber,
          ...(invoiceTotal === null ? {} : { "Invoice Total": invoiceTotal }),
          "Photo URL": photoUrl,
          "Extracted Text": extractedText,
          "Entered By": userName,
          Status: "Captured",
          Notes: notes
        }
      })
    });

    return { id: record.id, fields: record.fields };
  }

  async function createInvoiceLine(payload, userName) {
    if (hasPostgres()) {
      const invoiceCaptureId = String(payload.invoiceCaptureId || "").trim();
      const itemId = String(payload.itemId || "").trim();
      const supplier = await pgFindOrCreateSupplierByName(payload.supplierName);
      const itemName = String(payload.itemName || "").trim();
      const quantity = Number(payload.quantityReceived || 0);
      const unitPrice = payload.unitPrice === "" || payload.unitPrice === null ? null : Number(payload.unitPrice);
      const lineTotal = unitPrice === null ? null : quantity * unitPrice;
      if (!isValidId(invoiceCaptureId)) throw new Error("Invoice capture was not found.");
      if (!itemName) throw new Error("Invoice line needs an item name.");
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invoice line quantity must be greater than zero.");
      if (unitPrice !== null && !Number.isFinite(unitPrice)) throw new Error("Invoice line price must be a number.");
      const result = await db().query(`
        insert into invoice_lines (
          invoice_capture_id, inventory_item_id, supplier_id, invoice_number, item_name,
          raw_description, quantity, unit, unit_price, total_price, matched, notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        returning id
      `, [
        invoiceCaptureId,
        isValidId(itemId) ? itemId : null,
        supplier?.id || null,
        String(payload.invoiceNumber || ""),
        itemName,
        String(payload.ocrLineText || ""),
        quantity,
        String(payload.unit || ""),
        unitPrice,
        lineTotal,
        isValidId(itemId),
        `Applied by ${userName}`
      ]);
      return { id: result.rows[0]?.id || "" };
    }
    const schema = await getSchema();
    const tableId = schema.tables.invoiceLines;
    if (!tableId) throw new Error("Invoice Lines table was not found.");

    const itemName = String(payload.itemName || "");
    const invoiceNumber = String(payload.invoiceNumber || "");
    const supplierName = String(payload.supplierName || "");
    const quantity = Number(payload.quantityReceived || 0);
    const unitPrice = payload.unitPrice === "" || payload.unitPrice === null ? null : Number(payload.unitPrice);
    const lineTotal = unitPrice === null ? null : quantity * unitPrice;
    const appliedAt = new Date().toISOString();

    if (!itemName) throw new Error("Invoice line needs an item name.");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invoice line quantity must be greater than zero.");
    if (unitPrice !== null && !Number.isFinite(unitPrice)) throw new Error("Invoice line price must be a number.");

    const record = await airtable(tableId, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Invoice Line": `${invoiceNumber || "Invoice"} - ${itemName} - ${appliedAt.slice(0, 10)}`,
          "Invoice Capture Record ID": String(payload.invoiceCaptureId || ""),
          "Invoice Number": invoiceNumber,
          "Supplier Name": supplierName,
          "Inventory Item Record ID": String(payload.itemId || ""),
          "Item Name": itemName,
          "OCR Line Text": String(payload.ocrLineText || ""),
          "Quantity Received": quantity,
          Unit: String(payload.unit || ""),
          ...(unitPrice === null ? {} : { "Unit Price": unitPrice, "Line Total": lineTotal }),
          "Applied Date/Time": appliedAt,
          "Applied By": userName
        }
      })
    });

    return { id: record.id, fields: record.fields };
  }

  function normalizeOcrRule(record) {
    return {
      id: record.id,
      supplierName: record.fields["Supplier Name"] || "",
      ruleType: record.fields["Rule Type"] || "",
      ocrMatchText: record.fields["OCR Match Text"] || "",
      targetField: record.fields["Target Field"] || "",
      inventoryItemId: record.fields["Inventory Item Record ID"] || "",
      inventoryItemName: record.fields["Inventory Item Name"] || "",
      active: Boolean(record.fields.Active),
      notes: record.fields.Notes || ""
    };
  }

  function airtableFormulaText(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  async function listOcrRules(supplierName) {
    if (hasPostgres()) {
      const supplier = String(supplierName || "").trim();
      const result = supplier
        ? await db().query(`
            select id, supplier_name, rule_type, ocr_match_text, target_field,
                   inventory_item_id, inventory_item_name, active, notes
            from invoice_ocr_rules
            where active = true and lower(supplier_name) = lower($1)
            order by supplier_name, rule_type, ocr_match_text
          `, [supplier])
        : await db().query(`
            select id, supplier_name, rule_type, ocr_match_text, target_field,
                   inventory_item_id, inventory_item_name, active, notes
            from invoice_ocr_rules
            where active = true
            order by supplier_name, rule_type, ocr_match_text
          `);
      return result.rows.map(pgInvoiceRuleFromRow);
    }
    const supplier = String(supplierName || "").trim().toLowerCase();
    const formula = supplier
      ? `AND({Active}=1, LOWER({Supplier Name})='${airtableFormulaText(supplier)}')`
      : "{Active}=1";
    const query = new URLSearchParams({
      pageSize: "100",
      filterByFormula: formula,
      "sort[0][field]": "Supplier Name",
      "sort[0][direction]": "asc"
    });
    const data = await airtable(`${invoiceOcrRulesTableId}?${query}`);
    return data.records.map(normalizeOcrRule);
  }

  async function createOcrRule(payload, userName) {
    if (hasPostgres()) {
      const supplierName = String(payload.supplierName || "").trim();
      const ruleType = String(payload.ruleType || "").trim();
      const ocrMatchText = String(payload.ocrMatchText || "").replace(/\s+/g, " ").trim();
      const targetField = String(payload.targetField || "").trim();
      const inventoryItemId = String(payload.inventoryItemId || "").trim();
      const inventoryItemName = String(payload.inventoryItemName || "").trim();
      const notes = String(payload.notes || "").trim();
      if (!supplierName) throw new Error("Enter the supplier before teaching OCR.");
      if (!["Header Field", "Line Item"].includes(ruleType)) throw new Error("Invalid OCR rule type.");
      if (!ocrMatchText || ocrMatchText.length < 3) throw new Error("OCR match text is too short.");
      if (!["Supplier", "Invoice Number", "Invoice Total", "Inventory Item"].includes(targetField)) {
        throw new Error("Invalid OCR target field.");
      }
      if (ruleType === "Line Item" && !isValidId(inventoryItemId)) throw new Error("Choose an inventory item for line-item rules.");

      const supplier = await pgFindOrCreateSupplierByName(supplierName);
      const existing = await db().query(`
        select id, supplier_name, rule_type, ocr_match_text, target_field,
               inventory_item_id, inventory_item_name, active, notes
        from invoice_ocr_rules
        where lower(supplier_name) = lower($1)
          and lower(rule_type) = lower($2)
          and lower(ocr_match_text) = lower($3)
          and coalesce(inventory_item_id::text, '') = coalesce($4, '')
        limit 1
      `, [supplierName, ruleType, ocrMatchText, isValidId(inventoryItemId) ? inventoryItemId : ""]);
      if (existing.rows[0]) {
        return pgInvoiceRuleFromRow(existing.rows[0]);
      }

      const record = await db().query(`
        insert into invoice_ocr_rules (
          supplier_id, supplier_name, rule_type, ocr_match_text, target_field,
          inventory_item_id, inventory_item_name, active, notes, created_by_username
        )
        values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
        returning id, supplier_name, rule_type, ocr_match_text, target_field,
                  inventory_item_id, inventory_item_name, active, notes
      `, [
        supplier?.id || null,
        supplierName,
        ruleType,
        ocrMatchText,
        targetField,
        isValidId(inventoryItemId) ? inventoryItemId : null,
        inventoryItemName,
        [notes, `Created from web app by ${userName}`].filter(Boolean).join("\n"),
        userName
      ]);
      return pgInvoiceRuleFromRow(record.rows[0]);
    }
    const supplierName = String(payload.supplierName || "").trim();
    const ruleType = String(payload.ruleType || "").trim();
    const ocrMatchText = String(payload.ocrMatchText || "").replace(/\s+/g, " ").trim();
    const targetField = String(payload.targetField || "").trim();
    const inventoryItemId = String(payload.inventoryItemId || "").trim();
    const inventoryItemName = String(payload.inventoryItemName || "").trim();
    const notes = String(payload.notes || "").trim();

    if (!supplierName) throw new Error("Enter the supplier before teaching OCR.");
    if (!["Header Field", "Line Item"].includes(ruleType)) throw new Error("Invalid OCR rule type.");
    if (!ocrMatchText || ocrMatchText.length < 3) throw new Error("OCR match text is too short.");
    if (!["Supplier", "Invoice Number", "Invoice Total", "Inventory Item"].includes(targetField)) {
      throw new Error("Invalid OCR target field.");
    }
    if (ruleType === "Line Item" && !inventoryItemId) throw new Error("Choose an inventory item for line-item rules.");

    const existing = await listOcrRules(supplierName);
    const duplicate = existing.find((rule) =>
      rule.ruleType === ruleType
      && rule.targetField === targetField
      && rule.inventoryItemId === inventoryItemId
      && rule.ocrMatchText.toLowerCase() === ocrMatchText.toLowerCase()
    );
    if (duplicate) return duplicate;

    const record = await airtable(invoiceOcrRulesTableId, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Rule Name": `${supplierName} - ${targetField} - ${ocrMatchText.slice(0, 40)}`,
          "Supplier Name": supplierName,
          "Rule Type": ruleType,
          "OCR Match Text": ocrMatchText,
          "Target Field": targetField,
          "Inventory Item Record ID": inventoryItemId,
          "Inventory Item Name": inventoryItemName,
          Active: true,
          Notes: [notes, `Created from web app by ${userName}`].filter(Boolean).join("\n")
        }
      })
    });

    return normalizeOcrRule(record);
  }

  async function emailInvoicePicture(payload, userName) {
    requireEmailConfig();

    const attachment = attachmentFromDataUrl(payload.dataUrl, payload.fileName);
    const supplier = String(payload.supplierName || "").trim();
    const invoiceNumber = String(payload.invoiceNumber || "").trim();
    const notes = String(payload.notes || "").trim();
    const subjectParts = ["Invoice"];
    if (supplier) subjectParts.push(supplier);
    if (invoiceNumber) subjectParts.push(`#${invoiceNumber}`);

    const text = [
      "Invoice photo sent from Kitchen Stock.",
      "",
      `Sent by: ${userName}`,
      `Supplier: ${supplier || "(not entered)"}`,
      `Invoice number: ${invoiceNumber || "(not entered)"}`,
      notes ? `Notes: ${notes}` : ""
    ].filter(Boolean).join("\n");

    if (brevoApiKey) {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": brevoApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sender: {
            name: "Kitchen Stock",
            email: mailFrom
          },
          to: [{ email: accountingInbox }],
          subject: subjectParts.join(" - "),
          textContent: text,
          attachment: [{
            name: attachment.filename,
            content: attachment.content.toString("base64")
          }]
        })
      });

      const responseText = await response.text();
      const responseData = responseText ? JSON.parse(responseText) : {};
      if (!response.ok) {
        throw new Error(`Brevo email failed: ${responseData.message || response.statusText}`);
      }

      return {
        to: accountingInbox,
        messageId: responseData.messageId || "",
        provider: "Brevo API"
      };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 25000,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const info = await transporter.sendMail({
      from: mailFrom,
      to: accountingInbox,
      subject: subjectParts.join(" - "),
      text,
      attachments: [attachment]
    });

    return {
      to: accountingInbox,
      messageId: info.messageId || "",
      provider: "SMTP"
    };
  }

  return {
    ocrSpaceParseImage,
    createInvoiceCapture,
    createInvoiceLine,
    listOcrRules,
    createOcrRule,
    emailInvoicePicture
  };
}
