import { authPage } from "/page-auth.js";
import { bindAutosaveRows, bindDeleteAction, createStatusPresenter } from "/admin-crud-helpers.js";

const page = authPage({
  permission: "canViewInternalData",
  messageSelector: "#internalDataMessage"
});

const internalDataForm = document.querySelector("#internalDataForm");
const internalDataList = document.querySelector("#internalDataList");
const internalDataMessage = document.querySelector("#internalDataMessage");
let serviceRecords = [];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const setMessage = createStatusPresenter(internalDataMessage);

function renderServices(services) {
  serviceRecords = services || [];
  internalDataList.innerHTML = (services || [])
    .sort((a, b) => String(a.serviceName || "").localeCompare(String(b.serviceName || ""), undefined, { numeric: true }))
    .map((service) => `
      <article class="setting-row internal-data-row" data-service-id="${esc(service.id)}">
        <label>Name of service
          <input class="service-name" type="text" value="${esc(service.serviceName)}">
        </label>
        <label>URL of website
          <input class="service-url" type="url" value="${esc(service.serviceUrl)}">
        </label>
        <label>Username
          <input class="service-username" type="text" value="${esc(service.username || "")}">
        </label>
        <label>Password
          <div class="password-toggle-row">
            <input class="service-password" type="password" value="${esc(service.password || "")}">
            <button class="small-button toggle-password-visibility" type="button">Show</button>
          </div>
        </label>
        <label class="check-label"><input class="service-two-factor-enabled" type="checkbox" ${service.twoFactorEnabled ? "checked" : ""}> 2 step authenticate</label>
        <label>2 step details
          <input class="service-two-factor-details" type="text" value="${esc(service.twoFactorDetails || "")}" ${service.twoFactorEnabled ? "" : "disabled"}>
        </label>
        <label class="wide-field">Memo
          <textarea class="service-memo" rows="3">${esc(service.memo || "")}</textarea>
        </label>
        <div class="internal-data-actions">
          <button class="secondary open-service-link" type="button">Open website</button>
          <button class="danger-button delete-service" type="button">Delete</button>
        </div>
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
  renderServices(data.services || []);
  setMessage("");
}

function getServiceRecord(row) {
  return serviceRecords.find((service) => service.id === row.dataset.serviceId);
}

function syncTwoFactorDetailsState(scope) {
  const enabled = scope?.querySelector(".service-two-factor-enabled, #serviceTwoFactorEnabled");
  const details = scope?.querySelector(".service-two-factor-details, #serviceTwoFactorDetails");
  if (!enabled || !details) return;
  details.disabled = !enabled.checked;
}

function isServiceDirty(row) {
  const record = getServiceRecord(row);
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
  if (!row || row.dataset.saving === "true" || !isServiceDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setMessage("Saving internal data...");
  try {
    await page.api(`/api/internal-data-services/${row.dataset.serviceId}`, {
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
    await loadServices();
    setMessage("Internal data saved.");
  } finally {
    row.dataset.saving = "false";
  }
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
    await loadServices();
    setMessage("Service added.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.querySelector("#serviceTwoFactorEnabled")?.addEventListener("change", () => {
  syncTwoFactorDetailsState(internalDataForm);
});

bindDeleteAction({
  container: internalDataList,
  buttonSelector: ".delete-service",
  rowSelector: ".internal-data-row",
  onDelete: async (row) => {
    const serviceName = row.querySelector(".service-name")?.value.trim() || "this service";
    if (!window.confirm(`Delete service ${serviceName}?`)) return;
    if (!window.confirm("Really delete this internal data record? This cannot be undone.")) return;
    await page.api(`/api/internal-data-services/${row.dataset.serviceId}`, { method: "DELETE" });
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

internalDataList.addEventListener("click", (event) => {
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
    const url = normalizeUrl(row?.querySelector(".service-url")?.value || "");
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }
});

page.ready(async () => {
  syncTwoFactorDetailsState(internalDataForm);
  await loadServices();
});
