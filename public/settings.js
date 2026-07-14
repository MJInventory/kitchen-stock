import { authPage } from "/page-auth.js";
import { clearKitchenSession } from "/session-shell.js";

const openOrderDaysInput = document.querySelector("#openOrderDays");
const gotoMenuOptions = document.querySelector("#gotoMenuOptions");
const backofficeMenuOptions = document.querySelector("#backofficeMenuOptions");
const settingsForm = document.querySelector("#settingsForm");
const settingsMessage = document.querySelector("#settingsMessage");
const settingsLogoutButton = document.querySelector("#settingsLogoutButton");

const menuConfig = window.MJ_STOCK_MENU_ITEMS || {};
const gotoItems = menuConfig.gotoItems || [];
const backofficeItems = menuConfig.backofficeItems || [];

let auth = null;
let currentPermissions = {};
let currentSettings = {};

function setMessage(text, isError = false) {
  settingsMessage.textContent = text;
  settingsMessage.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function sortMenuItems(items) {
  return [...items].sort((left, right) => String(left?.label || "").localeCompare(String(right?.label || ""), undefined, { sensitivity: "base" }));
}

function isAllowed(item) {
  const section = gotoItems.includes(item) ? "goto" : "backoffice";
  const settingsWithoutSelfHidden = {
    ...currentSettings,
    hiddenGotoMenu: [],
    hiddenBackofficeMenu: []
  };
  return window.MJScreenAccess?.isItemAllowed(item, section, currentPermissions, settingsWithoutSelfHidden) ?? true;
}

function renderMenuToggles(host, items, selectedValues = []) {
  const selected = new Set(selectedValues);
  host.innerHTML = sortMenuItems(items)
    .filter(isAllowed)
    .map((item) => `
      <label class="check-label">
        <input type="checkbox" value="${escapeHtml(item.href)}" ${selected.has(item.href) ? "checked" : ""} ${item.fixed ? "disabled checked" : ""}>
        ${escapeHtml(item.label)}
      </label>
    `)
    .join("");
}

function checkedValues(host) {
  return [...host.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)')].map((input) => input.value);
}

function hiddenValues(items, visibleValues) {
  const visible = new Set(visibleValues);
  return items
    .filter(isAllowed)
    .filter((item) => !item.fixed)
    .filter((item) => !visible.has(item.href))
    .map((item) => item.href);
}

async function loadSettings() {
  setMessage("Loading settings...");
  const me = await auth.api("/api/me");
  currentPermissions = me.user.permissions || {};
  const data = await auth.api("/api/user-settings");
  const settings = data.settings || {};
  currentSettings = settings;
  openOrderDaysInput.value = Number(settings.openOrderDays || 7);
  renderMenuToggles(gotoMenuOptions, gotoItems, gotoItems.filter((item) => !((settings.hiddenGotoMenu || []).includes(item.href))).map((item) => item.href));
  renderMenuToggles(backofficeMenuOptions, backofficeItems, backofficeItems.filter((item) => !((settings.hiddenBackofficeMenu || []).includes(item.href))).map((item) => item.href));
  setMessage("");
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Saving settings...");
  try {
    const payload = {
      theme: "light",
      openOrderDays: Number(openOrderDaysInput.value || 7),
      hiddenGotoMenu: hiddenValues(gotoItems, checkedValues(gotoMenuOptions)),
      hiddenBackofficeMenu: hiddenValues(backofficeItems, checkedValues(backofficeMenuOptions))
    };
    const data = await auth.api("/api/user-settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    localStorage.setItem("kitchenStockSettings", JSON.stringify(data.settings || {}));
    localStorage.setItem("kitchenStockTheme", "light");
    window.applyKitchenTheme?.("light");
    window.refreshKitchenMenus?.();
    setMessage("Settings saved.");
    await loadSettings();
  } catch (error) {
    setMessage(error.message || "Could not save settings.", true);
  }
});

settingsLogoutButton?.addEventListener("click", () => {
  const logoutButton = document.querySelector("#logoutButton");
  if (logoutButton) {
    logoutButton.click();
    return;
  }
  clearKitchenSession();
  window.location.href = "/";
});

auth = authPage();
auth.ready(async () => {
  await loadSettings();
});
