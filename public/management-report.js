import { authPage } from "/page-auth.js";

const modeSelect = document.querySelector("#managementMode");
const anchorDateInput = document.querySelector("#managementDate");
const customRange = document.querySelector("#managementCustomRange");
const fromInput = document.querySelector("#managementFrom");
const toInput = document.querySelector("#managementTo");
const loadButton = document.querySelector("#loadManagementButton");
const printButton = document.querySelector("#printManagementButton");
const message = document.querySelector("#managementMessage");
const printLabel = document.querySelector("#managementPrintLabel");
const summaryHost = document.querySelector("#managementSummary");
const listHost = document.querySelector("#managementList");

const auth = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#managementMessage"
});

function isoTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", Boolean(isError));
}

function formatPeriodLabel(data = {}) {
  const from = String(data.from || "").trim();
  const to = String(data.to || "").trim();
  if (from && to && from !== to) return `${from} to ${to}`;
  return from || to || data.label || "";
}

function toggleCustomRange() {
  customRange.hidden = modeSelect.value !== "custom";
}

function buildQuery() {
  const params = new URLSearchParams();
  params.set("mode", modeSelect.value || "day");
  params.set("date", anchorDateInput.value || isoTodayLocal());
  if (modeSelect.value === "custom") {
    params.set("from", fromInput.value || anchorDateInput.value || isoTodayLocal());
    params.set("to", toInput.value || fromInput.value || anchorDateInput.value || isoTodayLocal());
  }
  return params;
}

function renderSummary(summary = {}) {
  const cards = [
    { label: "Total quantity", value: Number(summary.totalQuantity || 0) },
    { label: "Total lines", value: Number(summary.totalLines || 0) },
    { label: "Distinct items", value: Number(summary.distinctItems || 0) },
    { label: "Distinct suppliers", value: Number(summary.distinctSuppliers || 0) }
  ];
  summaryHost.innerHTML = cards.map((card) => `
    <article>
      <strong>${escapeHtml(card.value)}</strong>
      <span>${escapeHtml(card.label)}</span>
    </article>
  `).join("");
}

function renderGroups(groups = []) {
  if (!groups.length) {
    listHost.innerHTML = '<p class="empty-sheet">No ordered items found for this period.</p>';
    return;
  }
  listHost.innerHTML = groups.map((group) => `
    <section class="sheet-group">
      <h2>${escapeHtml(group.categoryName)} <span>${group.rows.length} item(s)</span></h2>
      <table class="order-report-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Supplier</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Avg lead time</th>
          </tr>
        </thead>
        <tbody>
          ${group.rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.itemName)}</td>
              <td>${escapeHtml(row.supplierName)}</td>
              <td>${escapeHtml(row.totalQuantity)}</td>
              <td>${escapeHtml(row.unit)}</td>
              <td>${row.avgLeadTimeDays == null ? "-" : `${escapeHtml(row.avgLeadTimeDays)} day(s)`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `).join("");
}

async function loadReport() {
  setMessage("Loading management totals...");
  try {
    const data = await auth.api(`/api/management-report?${buildQuery().toString()}`);
    renderSummary(data.summary || {});
    renderGroups(data.groups || []);
    printLabel.textContent = formatPeriodLabel(data);
    setMessage(`Showing ${data.label || "selected period"}.`);
  } catch (error) {
    renderSummary({});
    renderGroups([]);
    printLabel.textContent = "";
    setMessage(error.message || "Could not load management report.", true);
  }
}

modeSelect.addEventListener("change", () => {
  toggleCustomRange();
  if (modeSelect.value !== "custom") {
    fromInput.value = "";
    toInput.value = "";
  }
});

loadButton.addEventListener("click", () => {
  loadReport().catch((error) => setMessage(error.message || "Could not load management report.", true));
});

printButton.addEventListener("click", () => {
  window.print();
});

auth.ready(async () => {
  const today = isoTodayLocal();
  anchorDateInput.value = today;
  fromInput.value = today;
  toInput.value = today;
  toggleCustomRange();
  await loadReport();
});
