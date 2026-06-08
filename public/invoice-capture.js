const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const invoiceForm = document.querySelector("#invoiceForm");
const supplierName = document.querySelector("#supplierName");
const invoiceNumber = document.querySelector("#invoiceNumber");
const invoiceTotal = document.querySelector("#invoiceTotal");
const photoUrl = document.querySelector("#photoUrl");
const invoicePhoto = document.querySelector("#invoicePhoto");
const extractedText = document.querySelector("#extractedText");
const invoiceNotes = document.querySelector("#invoiceNotes");
const invoiceMessage = document.querySelector("#invoiceMessage");
const ocrButton = document.querySelector("#ocrButton");
const emailInvoiceButton = document.querySelector("#emailInvoiceButton");
const applyLinesButton = document.querySelector("#applyLinesButton");
const invoicePreview = document.querySelector("#invoicePreview");
const ocrCanvas = document.querySelector("#ocrCanvas");
const ocrMode = document.querySelector("#ocrMode");
const ocrRotation = document.querySelector("#ocrRotation");
const ocrTextType = document.querySelector("#ocrTextType");
const buildLinesButton = document.querySelector("#buildLinesButton");
const teachHeaderButton = document.querySelector("#teachHeaderButton");
const teachLinesButton = document.querySelector("#teachLinesButton");
const invoiceLines = document.querySelector("#invoiceLines");
const ocrProgress = document.querySelector("#ocrProgress");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];
let parsedLines = [];
let ocrRules = [];

function message(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = sessionUser;
}

function showLogin() {
  loginScreen.hidden = false;
  currentUser.textContent = "";
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    ...options
  });
  const data = await response.json();
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function itemLabel(item) {
  return `${item.name} (${item.quantity ?? 0} ${item.unit || ""})`;
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function findBestItem(lineText) {
  const line = normalize(lineText);
  let best = null;
  let bestScore = 0;

  for (const item of items) {
    const name = normalize(item.name);
    const words = name.split(" ").filter((word) => word.length > 2);
    const score = words.reduce((total, word) => total + (line.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore ? best : null;
}

function simplifyMatchText(text) {
  return String(text || "")
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 2)
    .slice(0, 6)
    .join(" ");
}

function findMappedItem(lineText) {
  const line = normalize(lineText);
  const matchingRule = ocrRules
    .filter((rule) => rule.ruleType === "Line Item" && rule.inventoryItemId && rule.ocrMatchText)
    .map((rule) => ({ rule, match: normalize(rule.ocrMatchText) }))
    .filter(({ match }) => match && line.includes(match))
    .sort((a, b) => b.match.length - a.match.length)[0]?.rule;

  if (!matchingRule) return null;
  return items.find((item) => item.id === matchingRule.inventoryItemId) || null;
}

function extractValueAfterMatch(line, matchText, targetField) {
  const lowerLine = String(line || "").toLowerCase();
  const lowerMatch = String(matchText || "").toLowerCase();
  const index = lowerLine.indexOf(lowerMatch);
  if (index < 0) return "";

  let value = String(line || "").slice(index + String(matchText || "").length);
  value = value.replace(/^[\s:;#-]+/, "").trim();

  if (targetField === "Invoice Total") {
    const money = value.match(/\d+(?:[.,]\d{2})?/);
    return money ? money[0].replace(",", ".") : "";
  }

  return value;
}

function applyHeaderRules(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerRules = ocrRules.filter((rule) => rule.ruleType === "Header Field" && rule.ocrMatchText);

  for (const rule of headerRules) {
    const line = lines.find((candidate) => normalize(candidate).includes(normalize(rule.ocrMatchText)));
    if (!line) continue;

    const value = extractValueAfterMatch(line, rule.ocrMatchText, rule.targetField);
    if (!value) continue;

    if (rule.targetField === "Invoice Number" && !invoiceNumber.value) invoiceNumber.value = value;
    if (rule.targetField === "Invoice Total" && !invoiceTotal.value) invoiceTotal.value = value;
  }
}

function parseInvoiceText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4)
    .filter((line) => /[a-zA-Z]/.test(line))
    .filter((line) => !/^[^a-zA-Z0-9]+$/.test(line))
    .map((line, index) => {
      const numbers = line.match(/\d+(?:[.,]\d+)?/g) || [];
      const firstNumber = numbers.length ? Number(numbers[0].replace(",", ".")) : 1;
      const lastNumber = numbers.length ? Number(numbers[numbers.length - 1].replace(",", ".")) : "";
      const matchedItem = findMappedItem(line) || findBestItem(line);
      return {
        id: `line-${Date.now()}-${index}`,
        text: line,
        itemId: matchedItem?.id || "",
        quantity: Number.isFinite(firstNumber) && firstNumber > 0 ? firstNumber : 1,
        unitPrice: Number.isFinite(lastNumber) ? lastNumber : "",
        selected: Boolean(matchedItem)
      };
    });
}

function textLooksGarbled(text) {
  const cleaned = String(text || "").replace(/\s+/g, "");
  if (cleaned.length < 30) return false;

  const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const digits = (cleaned.match(/[0-9]/g) || []).length;
  const useful = letters + digits;
  const symbolRatio = 1 - (useful / cleaned.length);
  const shortWordBursts = (String(text || "").match(/\b[A-Za-z]\b/g) || []).length;
  return symbolRatio > 0.42 || shortWordBursts > 35;
}

async function fileToImage(file) {
  const image = new Image();
  image.decoding = "async";
  image.src = URL.createObjectURL(file);
  await image.decode();
  return image;
}

function canvasToDataUrl(canvas, type = "image/jpeg", quality = 0.86) {
  return canvas.toDataURL(type, quality);
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

async function canvasToSizedDataUrl(sourceCanvas, maxBytes = 920 * 1024) {
  let workingCanvas = sourceCanvas;
  let quality = 0.86;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dataUrl = workingCanvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(dataUrl) <= maxBytes) return dataUrl;

    if (quality > 0.58) {
      quality -= 0.12;
    } else {
      const resized = document.createElement("canvas");
      resized.width = Math.max(480, Math.round(workingCanvas.width * 0.82));
      resized.height = Math.max(480, Math.round(workingCanvas.height * 0.82));
      const context = resized.getContext("2d");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(workingCanvas, 0, 0, resized.width, resized.height);
      workingCanvas = resized;
      quality = 0.72;
    }
  }

  const finalDataUrl = workingCanvas.toDataURL("image/jpeg", 0.55);
  if (dataUrlByteLength(finalDataUrl) > maxBytes) {
    throw new Error("The invoice image is still too large for the free hosted OCR. Retake a closer, cleaner photo.");
  }
  return finalDataUrl;
}

async function fileToEmailDataUrl(file) {
  if (!file.type.startsWith("image/")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, fileName: file.name });
      reader.onerror = () => reject(reader.error || new Error("Could not read invoice file."));
      reader.readAsDataURL(file);
    });
  }

  const image = await fileToImage(file);
  const maxSide = 1600;
  const scale = Math.min(maxSide / Math.max(image.width, image.height), 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  const baseName = file.name.replace(/\.[^.]+$/, "") || "invoice";
  return { dataUrl: await canvasToSizedDataUrl(canvas, 1250 * 1024), fileName: `${baseName}.jpg` };
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read invoice file."));
    reader.readAsDataURL(file);
  });
}

async function prepareImageForOcr(file) {
  const image = await fileToImage(file);
  const maxWidth = ocrTextType.value === "dense" ? 2200 : 1800;
  const scale = Math.min(maxWidth / image.width, 1.8);
  const sourceWidth = Math.max(1, Math.round(image.width * scale));
  const sourceHeight = Math.max(1, Math.round(image.height * scale));
  const rotation = Number(ocrRotation.value || 0);
  const isQuarterTurn = rotation === 90 || rotation === 270;
  const width = isQuarterTurn ? sourceHeight : sourceWidth;
  const height = isQuarterTurn ? sourceWidth : sourceHeight;
  const canvas = ocrCanvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.save();
  if (rotation === 90) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(width, height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, height);
    context.rotate((3 * Math.PI) / 2);
  }
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  context.restore();

  if (ocrMode.value === "original") {
    canvas.hidden = false;
    return canvas;
  }

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = new Uint8ClampedArray(width * height);
  let sum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = (0.299 * data[i]) + (0.587 * data[i + 1]) + (0.114 * data[i + 2]);
    gray[p] = value;
    sum += value;
  }

  const average = sum / gray.length;
  const contrast = ocrMode.value === "contrast" ? 1.85 : 1.45;
  const threshold = Math.max(115, Math.min(180, average * 0.92));

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let value = (gray[p] - average) * contrast + average;

    if (ocrMode.value === "threshold") {
      value = value < threshold ? 0 : 255;
    } else if (ocrMode.value === "auto") {
      value = value < threshold - 18 ? value * 0.72 : Math.min(255, value * 1.08 + 8);
    }

    value = Math.max(0, Math.min(255, value));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  context.putImageData(imageData, 0, 0);
  canvas.hidden = false;
  return canvas;
}

async function runCloudOcr(file) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    if (file.size > 1024 * 1024) {
      throw new Error("PDF is too large for the free OCR limit. Use a PDF under 1 MB or split/compress it first.");
    }

    const dataUrl = await fileToDataUrl(file);
    const data = await api("/api/ocr-invoice", {
      method: "POST",
      body: JSON.stringify({
        dataUrl,
        engine: ocrTextType.value === "dense" ? "3" : "2"
      })
    });

    return data.result.text || "";
  }

  const canvas = await prepareImageForOcr(file);
  const dataUrl = await canvasToSizedDataUrl(canvas);
  const data = await api("/api/ocr-invoice", {
    method: "POST",
    body: JSON.stringify({
      dataUrl,
      engine: ocrTextType.value === "dense" ? "3" : "2"
    })
  });

  return data.result.text || "";
}

function renderInvoiceLines() {
  applyLinesButton.disabled = !parsedLines.length;

  if (!parsedLines.length) {
    invoiceLines.innerHTML = '<p class="empty-sheet">OCR a photo or PDF to build invoice lines.</p>';
    return;
  }

  const options = [
    '<option value="">Choose item</option>',
    ...items.map((item) => `<option value="${item.id}">${itemLabel(item)}</option>`)
  ].join("");

  invoiceLines.innerHTML = parsedLines
    .map((line) => `
      <article class="invoice-line" data-line-id="${line.id}">
        <label class="check-label">
          <input class="line-selected" type="checkbox"${line.selected ? " checked" : ""}>
          Use
        </label>
        <label>
          Inventory item
          <select class="line-item">${options}</select>
        </label>
        <label>
          Qty received
          <input class="line-qty" type="number" min="0" step="0.01" value="${line.quantity}">
        </label>
        <label>
          Unit price
          <input class="line-price" type="number" min="0" step="0.01" value="${line.unitPrice}">
        </label>
        <p>${escapeHtml(line.text)}</p>
      </article>
    `)
    .join("");

  for (const line of parsedLines) {
    const article = invoiceLines.querySelector(`[data-line-id="${line.id}"]`);
    article.querySelector(".line-item").value = line.itemId;
  }
}

function syncLineFromArticle(article) {
  const line = parsedLines.find((candidate) => candidate.id === article.dataset.lineId);
  if (!line) return;

  line.selected = article.querySelector(".line-selected").checked;
  line.itemId = article.querySelector(".line-item").value;
  line.quantity = Number(article.querySelector(".line-qty").value || 0);
  line.unitPrice = article.querySelector(".line-price").value;
}

async function loadItems() {
  message(invoiceMessage, "Loading inventory...");
  const data = await api("/api/items");
  items = data.items;
  message(invoiceMessage, "");
}

async function loadOcrRules() {
  const supplier = supplierName.value.trim();
  if (!supplier) {
    ocrRules = [];
    return;
  }

  const query = new URLSearchParams({ supplier });
  const data = await api(`/api/ocr-rules?${query}`);
  ocrRules = data.rules || [];
}

async function saveOcrRule(rule) {
  const data = await api("/api/ocr-rules", {
    method: "POST",
    body: JSON.stringify({
      supplierName: supplierName.value.trim(),
      ...rule
    })
  });
  return data.rule;
}

function findLineContaining(value) {
  const needle = normalize(value);
  if (!needle) return "";
  return String(extractedText.value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => normalize(line).includes(needle)) || "";
}

function labelBeforeValue(line, value) {
  const lowerLine = String(line || "").toLowerCase();
  const lowerValue = String(value || "").toLowerCase();
  const index = lowerLine.indexOf(lowerValue);
  if (index <= 0) return "";
  return String(line || "").slice(0, index).replace(/[:;#-]+$/g, "").trim();
}

async function saveInvoiceCapture(statusNote = "") {
  const data = await api("/api/invoice-captures", {
    method: "POST",
    body: JSON.stringify({
      supplierName: supplierName.value,
      invoiceNumber: invoiceNumber.value,
      invoiceTotal: invoiceTotal.value,
      photoUrl: photoUrl.value,
      extractedText: extractedText.value,
      notes: [invoiceNotes.value, statusNote].filter(Boolean).join("\n")
    })
  });
  return data.invoice;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(loginMessage, "Logging in...");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not log in.");
    sessionToken = data.token;
    sessionUser = data.user.name;
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
    window.applyKitchenTheme?.(data.user.theme || "dark");
    passwordInput.value = "";
    showApp();
    await loadItems();
  } catch (error) {
    message(loginMessage, error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
invoicePhoto.addEventListener("change", () => {
  if (invoicePhoto.files.length) {
    const file = invoicePhoto.files[0];
    if (file.type.startsWith("image/")) {
      invoicePreview.src = URL.createObjectURL(file);
      invoicePreview.hidden = false;
    } else {
      invoicePreview.hidden = true;
    }
    message(invoiceMessage, `Selected file: ${file.name}.`);
  }
});

ocrButton.addEventListener("click", async () => {
  const file = invoicePhoto.files[0];
  if (!file) {
    message(invoiceMessage, "Choose or take an invoice file first.", true);
    return;
  }

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!file.type.startsWith("image/") && !isPdf) {
    message(invoiceMessage, "Use a photo/image file or PDF for OCR.", true);
    return;
  }

  ocrButton.disabled = true;
  applyLinesButton.disabled = true;
  message(invoiceMessage, `Sending ${isPdf ? "PDF" : "photo"} to hosted OCR...`);

  try {
    ocrProgress.textContent = "hosted OCR";
    await loadOcrRules();
    const text = await runCloudOcr(file);

    extractedText.value = text.trim();
    applyHeaderRules(extractedText.value);
    parsedLines = parseInvoiceText(extractedText.value);
    renderInvoiceLines();
    if (textLooksGarbled(extractedText.value)) {
      message(invoiceMessage, "OCR result looks garbled. Try another rotation or paste/correct the text, then tap Build Lines From Text.", true);
    } else {
      message(invoiceMessage, `OCR finished. Review ${parsedLines.length} detected lines before applying stock.`);
    }
  } catch (error) {
    message(invoiceMessage, error.message, true);
  } finally {
    ocrProgress.textContent = "";
    ocrButton.disabled = false;
  }
});

buildLinesButton.addEventListener("click", () => {
  loadOcrRules()
    .catch(() => {})
    .finally(() => {
  parsedLines = parseInvoiceText(extractedText.value);
  renderInvoiceLines();
  message(invoiceMessage, `Built ${parsedLines.length} line(s) from the text box.`);
    });
});

teachHeaderButton.addEventListener("click", async () => {
  if (!supplierName.value.trim()) {
    message(invoiceMessage, "Enter the supplier before teaching OCR.", true);
    return;
  }

  const candidates = [
    { value: invoiceNumber.value.trim(), targetField: "Invoice Number" },
    { value: invoiceTotal.value.trim(), targetField: "Invoice Total" }
  ].filter((candidate) => candidate.value);

  if (!candidates.length) {
    message(invoiceMessage, "Enter an invoice number or total first.", true);
    return;
  }

  teachHeaderButton.disabled = true;
  try {
    let saved = 0;
    for (const candidate of candidates) {
      const line = findLineContaining(candidate.value);
      const matchText = labelBeforeValue(line, candidate.value);
      if (!matchText || matchText.length < 3) continue;
      await saveOcrRule({
        ruleType: "Header Field",
        ocrMatchText: matchText,
        targetField: candidate.targetField,
        notes: `Learned from OCR line: ${line}`
      });
      saved += 1;
    }

    await loadOcrRules();
    message(invoiceMessage, saved ? `Saved ${saved} header OCR rule(s).` : "Could not find those values in the OCR text.", !saved);
  } catch (error) {
    message(invoiceMessage, error.message, true);
  } finally {
    teachHeaderButton.disabled = false;
  }
});

teachLinesButton.addEventListener("click", async () => {
  const articles = [...invoiceLines.querySelectorAll(".invoice-line")];
  articles.forEach(syncLineFromArticle);

  if (!supplierName.value.trim()) {
    message(invoiceMessage, "Enter the supplier before teaching OCR.", true);
    return;
  }

  const selected = parsedLines.filter((line) => line.selected && line.itemId);
  if (!selected.length) {
    message(invoiceMessage, "Select corrected lines with inventory items first.", true);
    return;
  }

  teachLinesButton.disabled = true;
  try {
    let saved = 0;
    for (const line of selected) {
      const item = items.find((candidate) => candidate.id === line.itemId);
      const matchText = simplifyMatchText(line.text);
      if (!item || matchText.length < 3) continue;
      await saveOcrRule({
        ruleType: "Line Item",
        ocrMatchText: matchText,
        targetField: "Inventory Item",
        inventoryItemId: item.id,
        inventoryItemName: item.name,
        notes: `Learned from OCR line: ${line.text}`
      });
      saved += 1;
    }

    await loadOcrRules();
    message(invoiceMessage, saved ? `Saved ${saved} line OCR rule(s).` : "No usable line rules were saved.", !saved);
  } catch (error) {
    message(invoiceMessage, error.message, true);
  } finally {
    teachLinesButton.disabled = false;
  }
});

emailInvoiceButton.addEventListener("click", async () => {
  const file = invoicePhoto.files[0];
  if (!file) {
    message(invoiceMessage, "Choose or take an invoice photo first.", true);
    return;
  }

  emailInvoiceButton.disabled = true;
  message(invoiceMessage, "Sending invoice picture to accounting...");

  try {
    const attachment = await fileToEmailDataUrl(file);
    const response = await api("/api/email-invoice", {
      method: "POST",
      body: JSON.stringify({
        ...attachment,
        supplierName: supplierName.value,
        invoiceNumber: invoiceNumber.value,
        notes: invoiceNotes.value
      })
    });

    const sent = response.result || {};
    const details = [
      "Invoice picture accepted by email service.",
      sent.to ? `To: ${sent.to}` : "",
      sent.provider ? `Via: ${sent.provider}` : "",
      sent.messageId ? `ID: ${sent.messageId}` : ""
    ].filter(Boolean).join(" ");
    message(invoiceMessage, details);
  } catch (error) {
    message(invoiceMessage, error.message, true);
  } finally {
    emailInvoiceButton.disabled = false;
  }
});

invoiceLines.addEventListener("change", (event) => {
  const article = event.target.closest(".invoice-line");
  if (article) syncLineFromArticle(article);
});

applyLinesButton.addEventListener("click", async () => {
  const articles = [...invoiceLines.querySelectorAll(".invoice-line")];
  articles.forEach(syncLineFromArticle);

  const selected = parsedLines.filter((line) => line.selected && line.itemId && Number(line.quantity) > 0);
  if (!selected.length) {
    message(invoiceMessage, "Select at least one line with an item and quantity.", true);
    return;
  }

  applyLinesButton.disabled = true;
  message(invoiceMessage, "Saving invoice and updating stock...");

  try {
    const invoice = await saveInvoiceCapture(`Applied ${selected.length} invoice line(s) to stock.`);

    for (const line of selected) {
      const item = items.find((candidate) => candidate.id === line.itemId);
      if (!item) continue;

      const newQuantity = Number(item.quantity || 0) + Number(line.quantity || 0);
      const priceText = line.unitPrice !== "" ? `; unit price ${line.unitPrice}` : "";
      await api("/api/invoice-lines", {
        method: "POST",
        body: JSON.stringify({
          invoiceCaptureId: invoice.id,
          invoiceNumber: invoiceNumber.value,
          supplierName: supplierName.value,
          itemId: item.id,
          itemName: item.name,
          ocrLineText: line.text,
          quantityReceived: line.quantity,
          unit: item.unit || "",
          unitPrice: line.unitPrice
        })
      });

      await api("/api/stock-counts", {
        method: "POST",
        body: JSON.stringify({
          itemId: item.id,
          countedQuantity: newQuantity,
          notes: `Invoice ${invoiceNumber.value || "(no number)"} from ${supplierName.value || "(no supplier)"}: received ${line.quantity} ${item.unit || ""}${priceText}. OCR line: ${line.text}`
        })
      });

      item.quantity = newQuantity;
    }

    renderInvoiceLines();
    message(invoiceMessage, `Updated stock for ${selected.length} invoice line(s).`);
  } catch (error) {
    message(invoiceMessage, error.message, true);
  } finally {
    applyLinesButton.disabled = false;
  }
});

invoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(invoiceMessage, "Saving...");
  try {
    await saveInvoiceCapture();
    invoiceForm.reset();
    parsedLines = [];
    renderInvoiceLines();
    invoicePreview.hidden = true;
    message(invoiceMessage, "Invoice capture saved.");
  } catch (error) {
    message(invoiceMessage, error.message, true);
  }
});

if (sessionToken && sessionUser) {
  showApp();
  loadItems().catch((error) => message(invoiceMessage, error.message, true));
} else {
  showLogin();
}







