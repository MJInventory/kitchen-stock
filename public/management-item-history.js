function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function formatNumber(value, decimals = 2) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(decimals) : Number(0).toFixed(decimals);
}

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
}

export function buildManagementPeriodTable(rows = [], period = "day") {
  const label = period === "week" ? "Week starting" : period === "month" ? "Month starting" : "Date";
  if (!rows.length) return '<p class="empty-sheet">No order history found for this period.</p>';
  return `
    <div class="management-history-table-scroll">
      <table class="order-report-table management-history-table">
        <thead>
          <tr>
            <th>${label}</th>
            <th>Orders</th>
            <th>Total qty</th>
            <th>Avg qty / order</th>
            <th>Avg price / unit</th>
            <th>Total value</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.periodStart)}</td>
              <td>${escapeHtml(row.orderCount)}</td>
              <td>${escapeHtml(formatNumber(row.totalQuantity))}</td>
              <td>${escapeHtml(formatNumber(row.averageOrderQuantity))}</td>
              <td>${escapeHtml(formatNumber(row.averageUnitPrice))}</td>
              <td>${escapeHtml(formatNumber(row.totalValue))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function buildManagementHistoryTable(rows = []) {
  if (!rows.length) return '<p class="empty-sheet">No orders found for this item.</p>';
  return `
    <div class="management-history-table-scroll">
      <table class="order-report-table management-history-table">
        <thead>
          <tr>
            <th>Ordered</th>
            <th>Supplier</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Price / unit</th>
            <th>Total value</th>
            <th>Status</th>
            <th>Requested by</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(formatDateTime(row.requestedAt))}</td>
              <td>${escapeHtml(row.supplierName)}</td>
              <td>${escapeHtml(formatNumber(row.quantity))}</td>
              <td>${escapeHtml(row.unit)}</td>
              <td>${escapeHtml(formatNumber(row.unitPrice))}</td>
              <td>${escapeHtml(formatNumber(row.totalValue))}</td>
              <td>${escapeHtml(row.status)}${row.standingOrder ? ' <span class="history-origin-chip">Standing</span>' : ""}</td>
              <td>${escapeHtml(row.requestedBy)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function initManagementItemHistory({ api }) {
  const searchInput = document.querySelector("#managementItemSearch");
  if (!searchInput) return;
  const searchResults = document.querySelector("#managementItemSearchResults");
  const message = document.querySelector("#managementItemHistoryMessage");
  const historyHost = document.querySelector("#managementItemHistory");
  const title = document.querySelector("#managementItemHistoryTitle");
  const summaryHost = document.querySelector("#managementItemHistorySummary");
  const averageTable = document.querySelector("#managementItemAverageTable");
  const historyTable = document.querySelector("#managementItemHistoryTable");
  const periodButtons = [...document.querySelectorAll("[data-history-period]")];
  let searchTimer = 0;
  let searchSequence = 0;
  let currentHistory = null;
  let activePeriod = "day";

  const setMessage = (text, isError = false) => {
    message.textContent = text;
    message.classList.toggle("error", isError);
  };

  const renderPeriod = () => {
    periodButtons.forEach((button) => button.classList.toggle("active", button.dataset.historyPeriod === activePeriod));
    averageTable.innerHTML = buildManagementPeriodTable(currentHistory?.averages?.[activePeriod] || [], activePeriod);
  };

  const renderSummary = (summary = {}) => {
    const cards = [
      ["Orders", Number(summary.orderCount || 0)],
      ["Total quantity", formatNumber(summary.totalQuantity)],
      ["Avg qty / order", formatNumber(summary.averageOrderQuantity)],
      ["Avg price / unit", formatNumber(summary.averageUnitPrice)],
      ["Total value", formatNumber(summary.totalValue)]
    ];
    summaryHost.innerHTML = cards.map(([label, value]) => `
      <article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>
    `).join("");
  };

  const loadHistory = async (item) => {
    searchInput.value = item.name || "";
    searchResults.innerHTML = "";
    setMessage("Loading item history...");
    try {
      currentHistory = await api(`/api/management-item-history?itemId=${encodeURIComponent(item.id)}`);
      title.textContent = currentHistory.item?.name || item.name || "Item history";
      renderSummary(currentHistory.summary || {});
      renderPeriod();
      historyTable.innerHTML = buildManagementHistoryTable(currentHistory.history || []);
      historyHost.hidden = false;
      setMessage(`${currentHistory.history?.length || 0} order record(s) loaded.`);
    } catch (error) {
      currentHistory = null;
      historyHost.hidden = true;
      setMessage(error.message || "Could not load item history.", true);
    }
  };

  const search = async () => {
    const query = searchInput.value.trim();
    const sequence = ++searchSequence;
    if (query.length < 2) {
      searchResults.innerHTML = "";
      setMessage(query ? "Type at least 2 letters." : "");
      return;
    }
    setMessage("Searching inventory items...");
    try {
      const data = await api(`/api/management-item-search?q=${encodeURIComponent(query)}`);
      if (sequence !== searchSequence) return;
      const items = data.items || [];
      searchResults.innerHTML = items.length
        ? items.map((item) => `
            <button type="button" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}" role="option">
              ${escapeHtml(item.name)}
            </button>
          `).join("")
        : '<p class="empty-sheet">No matching inventory items.</p>';
      setMessage(items.length ? "Select an item from the results." : "No matching inventory items.");
    } catch (error) {
      if (sequence !== searchSequence) return;
      searchResults.innerHTML = "";
      setMessage(error.message || "Could not search inventory items.", true);
    }
  };

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(search, 250);
  });
  searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-item-id]");
    if (!button) return;
    loadHistory({ id: button.dataset.itemId, name: button.dataset.itemName });
  });
  periodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activePeriod = button.dataset.historyPeriod || "day";
      renderPeriod();
    });
  });
}
