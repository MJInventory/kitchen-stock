import { authPage } from "/page-auth.js";

const openOrderDaysInput = document.querySelector("#openOrderDays");
const themeSelect = document.querySelector("#themeSelect");
const gotoMenuOptions = document.querySelector("#gotoMenuOptions");
const backofficeMenuOptions = document.querySelector("#backofficeMenuOptions");
const settingsForm = document.querySelector("#settingsForm");
const settingsMessage = document.querySelector("#settingsMessage");
const settingsLogoutButton = document.querySelector("#settingsLogoutButton");

const gotoItems = [
  { href: "/", label: "Front Page" },
  { href: "/ordering.html", label: "Ordering", permission: "canUseSupplierOrdering" },
  { href: "/internal-orders.html", label: "Internal Orders", permission: "canPlaceInternalOrders" },
  { href: "/picker-sheet.html", label: "Picker Board", permission: "canPickInternalOrders" },
  { href: "/receiving-sheet.html", label: "Receiving" },
  { href: "/driver-sheet.html", label: "Driver Sheet" },
  { href: "/stock-count.html", label: "Stock Count" },
  { href: "/order-report.html", label: "Reports" }
];

const backofficeItems = [
  { href: "/settings.html", label: "Settings", fixed: true },
  { href: "/standing-orders.html", label: "Standing Orders", permission: "canAddInventoryItems" },
  { href: "/inventory-settings.html", label: "Inventory Items", permission: "canAddInventoryItems" },
  { href: "/suppliers.html", label: "Suppliers", permission: "canAddInventoryItems" },
  { href: "/categories.html", label: "Categories", permission: "canAddInventoryItems" },
  { href: "/shelf-codes.html", label: "Storage & Shelves", permission: "canAddInventoryItems" },
  { href: "/user-admin.html", label: "User Admin", permission: "canAdminUsers" }
];

let auth = null;
let currentPermissions = {};

function setMessage(text, isError = false) {
  settingsMessage.textContent = text;
  settingsMessage.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function isAllowed(item) {
  return !item.permission || Boolean(currentPermissions[item.permission]);
}

function renderMenuToggles(host, items, selectedValues = []) {
  const selected = new Set(selectedValues);
  host.innerHTML = items
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
  themeSelect.value = String(me.user.theme || localStorage.getItem("kitchenStockTheme") || "dark").toLowerCase() === "light" ? "light" : "dark";
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
      theme: themeSelect.value,
      openOrderDays: Number(openOrderDaysInput.value || 7),
      hiddenGotoMenu: hiddenValues(gotoItems, checkedValues(gotoMenuOptions)),
      hiddenBackofficeMenu: hiddenValues(backofficeItems, checkedValues(backofficeMenuOptions))
    };
    const data = await auth.api("/api/user-settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    localStorage.setItem("kitchenStockSettings", JSON.stringify(data.settings || {}));
    localStorage.setItem("kitchenStockTheme", themeSelect.value);
    window.applyKitchenTheme?.(themeSelect.value);
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
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
  localStorage.removeItem("kitchenStockRole");
  localStorage.removeItem("kitchenStockPermissions");
  localStorage.removeItem("kitchenStockSettings");
  window.location.href = "/";
});

auth = authPage();
auth.ready(async () => {
  await loadSettings();
});
