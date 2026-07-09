import { authPage } from "/page-auth.js";
import { bindAutosaveRows, bindDeleteAction, createStatusPresenter } from "/admin-crud-helpers.js";
import { readKitchenSession } from "/session-shell.js";

const page = authPage({
  permission: "canViewInternalData",
  messageSelector: "#internalDataMessage"
});

const internalDataForm = document.querySelector("#internalDataForm");
const internalDataList = document.querySelector("#internalDataList");
const internalDataMessage = document.querySelector("#internalDataMessage");
const exportInternalDataButton = document.querySelector("#exportInternalDataButton");
const setMessage = createStatusPresenter(internalDataMessage);

let serviceRecords = [];
const unlockedServices = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function serviceSummary(service) {
  return {
    id: service.id,
    serviceName: String(service.serviceName || ""),
    serviceUrl: normalizeUrl(service.serviceUrl || "")
  };
}

function currentUserName() {
  return String(readKitchenSession().user || "").trim();
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function exportFileName() {
  const today = new Date().toISOString().slice(0, 10);
  return `internal-data-${today}.csv`;
}

function downloadCsvFile(rows) {
  const headers = [
    "Name of service",
    "URL of website",
    "Username",
    "Password",
    "2 step authenticate",
    "2 step details",
    "Memo",
    "Created by",
    "Updated by",
    "Created at",
    "Updated at"
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((service) => [
      service.serviceName,
      service.serviceUrl,
      service.username,
      service.password,
      service.twoFactorEnabled ? "Yes" : "No",
      service.twoFactorDetails,
      service.memo,
      service.createdBy,
      service.updatedBy,
      service.createdAt,
      service.updatedAt
    ].map(csvCell).join(","))
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = exportFileName();
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function renderDetailSection(serviceId) {
  const detail = unlockedServices.get(serviceId);
  if (!detail) return "";
  return `
    <section class="internal-data-detail-panel">
      <label>Name of service
        <input class="service-name" type="text" value="${esc(detail.serviceName)}">
      </label>
      <label>URL of website
        <input class="service-url" type="url" value="${esc(detail.serviceUrl)}">
      </label>
      <label>Username
        <input class="service-username" type="text" value="${esc(detail.username || "")}">
      </label>
      <label>Password
        <div class="password-toggle-row">
          <input class="service-password" type="password" value="${esc(detail.password || "")}">
          <button class="small-button toggle-password-visibility" type="button">Show</button>
        </div>
      </label>
      <label class="check-label"><input class="service-two-factor-enabled" type="checkbox" ${detail.twoFactorEnabled ? "checked" : ""}> 2 step authenticate</label>
      <label>2 step details
        <input class="service-two-factor-details" type="text" value="${esc(detail.twoFactorDetails || "")}" ${detail.twoFactorEnabled ? "" : "disabled"}>
      </label>
      <label class="wide-field">Memo
        <textarea class="service-memo" rows="3">${esc(detail.memo || "")}</textarea>
      </label>
      <div class="internal-data-actions">
        <button class="danger-button delete-service" type="button">Delete</button>
      </div>
    </section>
  `;
}

function renderServices(services) {
  serviceRecords = (services || []).map(serviceSummary);
  internalDataList.innerHTML = serviceRecords
    .sort((a, b) => String(a.serviceName || "").localeCompare(String(b.serviceName || ""), undefined, { numeric: true }))
    .map((service) => `
      <article class="setting-row internal-data-row" data-service-id="${esc(service.id)}">
        <div class="internal-data-summary">
          <div>
            <div class="field-label">Name of service</div>
            <div class="internal-data-summary-value">${esc(service.serviceName)}</div>
          </div>
          <div>
            <div class="field-label">URL of website</div>
            <div class="internal-data-summary-value internal-data-url">${esc(service.serviceUrl)}</div>
          </div>
          <div class="internal-data-actions">
            <button class="secondary open-service-link" type="button">Open website</button>
            <button class="secondary service-detail-toggle" type="button">${unlockedServices.has(service.id) ? "Hide details" : "Details"}</button>
          </div>
        </div>
        ${renderDetailSection(service.id)}
      </article>
    `)
    .join("");

  if (!internalDataList.innerHTML) {
    internalDataList.innerHTML = '<p class="empty-sheet">No internal services saved yet.</p>';
  }
}

async function loadServices() {
  setMessage("Loading internal data...");
  const data = await page.api("/api/internal-data-services");
  for (const serviceId of [...unlockedServices.keys()]) {
    if (!(data.services || []).some((entry) => entry.id === serviceId)) {
      unlockedServices.delete(serviceId);
    }
  }
  renderServices(data.services || []);
  setMessage("");
}

function getUnlockedService(row) {
  return unlockedServices.get(row.dataset.serviceId);
}

function syncTwoFactorDetailsState(scope) {
  const enabled = scope?.querySelector(".service-two-factor-enabled, #serviceTwoFactorEnabled");
  const details = scope?.querySelector(".service-two-factor-details, #serviceTwoFactorDetails");
  if (!enabled || !details) return;
  details.disabled = !enabled.checked;
}

function isServiceDirty(row) {
  const record = getUnlockedService(row);
  if (!record) return false;
  return (row.querySelector(".service-name")?.value || "") !== String(record.serviceName || "")
    || normalizeUrl(row.querySelector(".service-url")?.value || "") !== String(record.serviceUrl || "")
    || (row.querySelector(".service-username")?.value || "") !== String(record.username || "")
    || (row.querySelector(".service-password")?.value || "") !== String(record.password || "")
    || Boolean(row.querySelector(".service-two-factor-enabled")?.checked) !== Boolean(record.twoFactorEnabled)
    || (row.querySelector(".service-two-factor-details")?.value || "") !== String(record.twoFactorDetails || "")
    || (row.querySelector(".service-memo")?.value || "") !== String(record.memo || "");
}

async function saveServiceRow(row) {
  const record = getUnlockedService(row);
  if (!row || !record || row.dataset.saving === "true" || !isServiceDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setMessage("Saving internal data...");
  try {
    const data = await page.api(`/api/internal-data-services/${row.dataset.serviceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        serviceName: row.querySelector(".service-name").value,
        serviceUrl: row.querySelector(".service-url").value,
        username: row.querySelector(".service-username").value,
        password: row.querySelector(".service-password").value,
        twoFactorEnabled: row.querySelector(".service-two-factor-enabled").checked,
        twoFactorDetails: row.querySelector(".service-two-factor-details").value,
        memo: row.querySelector(".service-memo").value
      })
    });
    unlockedServices.set(row.dataset.serviceId, data.service || record);
    await loadServices();
    setMessage("Internal data saved.");
  } finally {
    row.dataset.saving = "false";
  }
}

async function unlockServiceDetails(row) {
  const serviceId = row.dataset.serviceId;
  const password = window.prompt(`Enter the password for ${currentUserName() || "your user"} to open these details.`);
  if (password == null) return;
  const data = await page.api(`/api/internal-data-services/${serviceId}/details`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
  unlockedServices.set(serviceId, data.service);
  renderServices(serviceRecords);
}

async function exportInternalData() {
  const password = window.prompt(`Enter the password for ${currentUserName() || "your user"} to export the full list.`);
  if (password == null) return;
  setMessage("Preparing Excel export...");
  const data = await page.api("/api/internal-data-services/export", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  downloadCsvFile(data.services || []);
  setMessage("Export downloaded.");
}

internalDataForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Adding service...");
  try {
    await page.api("/api/internal-data-services", {
      method: "POST",
      body: JSON.stringify({
        serviceName: document.querySelector("#serviceName").value,
        serviceUrl: document.querySelector("#serviceUrl").value,
        username: document.querySelector("#serviceUsername").value,
        password: document.querySelector("#servicePassword").value,
        twoFactorEnabled: document.querySelector("#serviceTwoFactorEnabled").checked,
        twoFactorDetails: document.querySelector("#serviceTwoFactorDetails").value,
        memo: document.querySelector("#serviceMemo").value
      })
    });
    internalDataForm.reset();
    syncTwoFactorDetailsState(internalDataForm);
    await loadServices();
    setMessage("Service added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.querySelector("#serviceTwoFactorEnabled")?.addEventListener("change", () => {
  syncTwoFactorDetailsState(internalDataForm);
});

exportInternalDataButton?.addEventListener("click", async () => {
  try {
    await exportInternalData();
  } catch (error) {
    setMessage(error.message, true);
  }
});

bindDeleteAction({
  container: internalDataList,
  buttonSelector: ".delete-service",
  rowSelector: ".internal-data-row",
  onDelete: async (row) => {
    const record = getUnlockedService(row);
    const serviceName = record?.serviceName || "this service";
    if (!window.confirm(`Delete service ${serviceName}?`)) return;
    if (!window.confirm("Really delete this internal data record? This cannot be undone.")) return;
    await page.api(`/api/internal-data-services/${row.dataset.serviceId}`, { method: "DELETE" });
    unlockedServices.delete(row.dataset.serviceId);
    await loadServices();
    setMessage("Service deleted.");
  },
  onError: (error) => setMessage(error.message, true)
});

bindAutosaveRows({
  container: internalDataList,
  rowSelector: ".internal-data-row",
  isDirty: isServiceDirty,
  saveRow: saveServiceRow,
  onError: (error) => setMessage(error.message, true)
});

internalDataList.addEventListener("change", (event) => {
  const row = event.target.closest(".internal-data-row");
  if (!row) return;
  if (event.target.closest(".service-two-factor-enabled")) {
    syncTwoFactorDetailsState(row);
  }
});

internalDataList.addEventListener("click", async (event) => {
  const toggleButton = event.target.closest(".toggle-password-visibility");
  if (toggleButton) {
    const row = toggleButton.closest(".internal-data-row");
    const input = row?.querySelector(".service-password");
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggleButton.textContent = showing ? "Show" : "Hide";
    return;
  }

  const openButton = event.target.closest(".open-service-link");
  if (openButton) {
    const row = openButton.closest(".internal-data-row");
    const summary = serviceRecords.find((entry) => entry.id === row?.dataset.serviceId);
    const url = normalizeUrl(summary?.serviceUrl || "");
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const detailButton = event.target.closest(".service-detail-toggle");
  if (detailButton) {
    const row = detailButton.closest(".internal-data-row");
    if (!row) return;
    const serviceId = row.dataset.serviceId;
    if (unlockedServices.has(serviceId)) {
      unlockedServices.delete(serviceId);
      renderServices(serviceRecords);
      setMessage("");
      return;
    }
    try {
      setMessage("Checking login details...");
      await unlockServiceDetails(row);
      setMessage("Details unlocked.");
    } catch (error) {
      setMessage(error.message, true);
    }
  }
});

page.ready(async () => {
  syncTwoFactorDetailsState(internalDataForm);
  await loadServices();
});
