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
const ocrTextType = document.querySelector("#ocrTextType");
const invoiceLines = document.querySelector("#invoiceLines");
const ocrProgress = document.querySelector("#ocrProgress");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";
let items = [];
let parsedLines = [];
let ocrLibraryPromise = null;

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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ocr-src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.ocrSrc = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureOcrLibrary() {
  if (window.Tesseract) return window.Tesseract;

  if (!ocrLibraryPromise) {
    const sources = [
      "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
      "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js"
    ];

    ocrLibraryPromise = (async () => {
      const failures = [];
      for (const source of sources) {
        try {
          ocrProgress.textContent = "loading OCR...";
          await loadScript(source);
          if (window.Tesseract) return window.Tesseract;
          failures.push(`${source}: loaded but no OCR object`);
        } catch (error) {
          failures.push(error.message);
        }
      }

      throw new Error(`OCR could not load from the available sources. Last errors: ${failures.slice(-2).join(" | ")}`);
    })();
  }

  return ocrLibraryPromise;
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
      const matchedItem = findBestItem(line);
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
  const maxSide = 2200;
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
  return { dataUrl: canvasToDataUrl(canvas), fileName: `${baseName}.jpg` };
}

async function prepareImageForOcr(file) {
  const image = await fileToImage(file);
  const maxWidth = ocrTextType.value === "dense" ? 2200 : 1800;
  const scale = Math.min(maxWidth / image.width, 1.8);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = ocrCanvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

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

function renderInvoiceLines() {
  applyLinesButton.disabled = !parsedLines.length;

  if (!parsedLines.length) {
    invoiceLines.innerHTML = '<p class="empty-sheet">OCR a photo to build invoice lines.</p>';
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
    message(invoiceMessage, "Choose or take an invoice photo first.", true);
    return;
  }

  if (!file.type.startsWith("image/")) {
    message(invoiceMessage, "For this first OCR version, use a photo/image file instead of a PDF.", true);
    return;
  }

  ocrButton.disabled = true;
  applyLinesButton.disabled = true;
  message(invoiceMessage, "Loading OCR...");

  try {
    const tesseract = await ensureOcrLibrary();
    const imageForOcr = await prepareImageForOcr(file);
    message(invoiceMessage, "Reading invoice...");
    const result = await tesseract.recognize(imageForOcr, "eng", {
      workerBlobURL: false,
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (event) => {
        if (event.status) {
          const pct = event.progress ? ` ${Math.round(event.progress * 100)}%` : "";
          ocrProgress.textContent = `${event.status}${pct}`;
        }
      },
      tessedit_pageseg_mode: ocrTextType.value === "dense" ? "6" : "4",
      preserve_interword_spaces: "1",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:/#- $%&()+"
    });

    if (!result.data.text.trim() && ocrMode.value !== "original") {
      message(invoiceMessage, "No clear text found. Trying original image...");
      ocrMode.value = "original";
      const fallbackImage = await prepareImageForOcr(file);
      const fallback = await tesseract.recognize(fallbackImage, "eng", {
        workerBlobURL: false,
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        logger: (event) => {
          if (event.status) {
            const pct = event.progress ? ` ${Math.round(event.progress * 100)}%` : "";
            ocrProgress.textContent = `${event.status}${pct}`;
          }
        },
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1"
      });
      result.data.text = fallback.data.text;
    }

    extractedText.value = result.data.text.trim();
    parsedLines = parseInvoiceText(extractedText.value);
    renderInvoiceLines();
    message(invoiceMessage, `OCR finished. Review ${parsedLines.length} detected lines before applying stock.`);
  } catch (error) {
    message(invoiceMessage, error.message, true);
  } finally {
    ocrProgress.textContent = "";
    ocrButton.disabled = false;
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
    await api("/api/email-invoice", {
      method: "POST",
      body: JSON.stringify({
        ...attachment,
        supplierName: supplierName.value,
        invoiceNumber: invoiceNumber.value,
        notes: invoiceNotes.value
      })
    });

    message(invoiceMessage, "Invoice picture sent to accounting.");
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
