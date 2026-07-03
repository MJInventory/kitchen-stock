(function setupGlobalMenus() {
  const currentPath = window.location.pathname || "/";
  let permissions = {};
  let storedRole = "";
  let sessionToken = "";
  let userSettings = {};

  const menuConfig = window.MJ_STOCK_MENU_ITEMS || {};
  const gotoItems = menuConfig.gotoItems || [];
  const backofficeItems = menuConfig.backofficeItems || [];
  const LOGOUT_VALUE = "__logout__";

  function sortMenuItems(items) {
    return [...items].sort((left, right) => {
      const leftHref = String(left?.href || "").trim();
      const rightHref = String(right?.href || "").trim();
      if (leftHref === "/" && rightHref !== "/") return -1;
      if (rightHref === "/" && leftHref !== "/") return 1;
      if (leftHref === LOGOUT_VALUE && rightHref !== LOGOUT_VALUE) return 1;
      if (rightHref === LOGOUT_VALUE && leftHref !== LOGOUT_VALUE) return -1;
      return String(left?.label || "").localeCompare(String(right?.label || ""), undefined, { sensitivity: "base" });
    });
  }

  function syncSessionState() {
    permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
    storedRole = String(localStorage.getItem("kitchenStockRole") || "").trim().toLowerCase();
    sessionToken = localStorage.getItem("kitchenStockToken") || "";
    userSettings = JSON.parse(localStorage.getItem("kitchenStockSettings") || "{}");
  }

  function effectivePermissionSet() {
    if (storedRole === "god" || storedRole === "admin") {
      return {
        ...permissions,
        canAdminUsers: true,
        canAddInventoryItems: true,
        canUseInvoices: true,
        canUseSupplierOrdering: true,
        canPlaceInternalOrders: true,
        canPickInternalOrders: true
      };
    }
    return permissions;
  }

  function allowed(item) {
    const currentPermissions = effectivePermissionSet();
    if (item.permission && !currentPermissions[item.permission]) return false;
    const hiddenGoto = Array.isArray(userSettings.hiddenGotoMenu) ? userSettings.hiddenGotoMenu : [];
    const hiddenBackoffice = Array.isArray(userSettings.hiddenBackofficeMenu) ? userSettings.hiddenBackofficeMenu : [];
    if (item.href === "/settings.html") return true;
    if (gotoItems.includes(item)) return !hiddenGoto.includes(item.href);
    if (backofficeItems.includes(item)) return !hiddenBackoffice.includes(item.href);
    return true;
  }

  function renderSelect(label, selectId, items) {
    const visibleItems = sortMenuItems(items.filter(allowed));
    if (!visibleItems.length) return "";
    const selectedHref = visibleItems.some((item) => item.href === currentPath) ? currentPath : "";
    const defaultLabel = label === "Go to" ? "Choose screen" : "Choose task";
    return `
      <label class="feature-select">
        <span>${label}</span>
        <select id="${selectId}" class="screen-menu" aria-label="${label}">
          <option value="">${defaultLabel}</option>
          ${visibleItems
            .map((item) => `<option value="${item.href}"${item.href === selectedHref ? " selected" : ""}>${item.label}</option>`)
            .join("")}
        </select>
      </label>
    `;
  }

  function buildMenuMarkup() {
    return `
      <div class="menu-duo" data-generated-menus>
        ${renderSelect("Go to", "featureMenu", gotoItems)}
        ${renderSelect("Backoffice", "backofficeMenu", backofficeItems)}
      </div>
    `;
  }

  function performLogout() {
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
  }

  function mountMenus() {
    syncSessionState();
    const orderTopbar = document.querySelector(".order-topbar");
    const genericTopbar = document.querySelector(".topbar");
    const topbar = orderTopbar || genericTopbar;
    if (!topbar) return;

    topbar.querySelectorAll(".order-nav, .feature-select").forEach((node) => node.remove());
    topbar.querySelectorAll(".top-actions a.button, .top-actions a.secondary").forEach((node) => node.remove());
    topbar.querySelectorAll("[data-generated-menus]").forEach((node) => node.remove());

    const actions = topbar.querySelector(".top-actions");
    if (!actions) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildMenuMarkup().trim();
    const menus = wrapper.firstElementChild;
    topbar.insertBefore(menus, actions);

    menus.querySelectorAll("select").forEach((select) => {
      select.addEventListener("change", (event) => {
        if (!event.target.value) return;
        if (event.target.value === LOGOUT_VALUE) {
          performLogout();
          event.target.value = "";
          return;
        }
        if (typeof window.confirmNavigationAllowed === "function" && !window.confirmNavigationAllowed()) {
          event.target.value = "";
          return;
        }
        window.location.href = event.target.value;
      });
    });

    const logoutButton = document.querySelector("#logoutButton");
    if (logoutButton) logoutButton.hidden = true;
    document.documentElement.classList.remove("menus-loading");
  }

  async function refreshPermissions() {
    syncSessionState();
    if (!sessionToken) return;
    try {
      const response = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data?.user) return;
      permissions = data.user.permissions || permissions;
      localStorage.setItem("kitchenStockPermissions", JSON.stringify(permissions));
      storedRole = String(data.user.role || storedRole || "").trim().toLowerCase();
      localStorage.setItem("kitchenStockRole", storedRole);
      localStorage.setItem("kitchenStockUser", data.user.name || localStorage.getItem("kitchenStockUser") || "");
      userSettings = data.user.settings || userSettings || {};
      localStorage.setItem("kitchenStockSettings", JSON.stringify(userSettings));
      syncSessionState();
    } catch {
      // Keep cached permissions if the refresh check fails.
    }
  }

  const boot = async () => {
    await refreshPermissions();
    mountMenus();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot().catch(() => {
        mountMenus();
        document.documentElement.classList.remove("menus-loading");
      });
    }, { once: true });
  } else {
    boot().catch(() => {
      mountMenus();
      document.documentElement.classList.remove("menus-loading");
    });
  }

  window.refreshKitchenMenus = () => {
    boot().catch(() => {
      mountMenus();
      document.documentElement.classList.remove("menus-loading");
    });
  };
}());
