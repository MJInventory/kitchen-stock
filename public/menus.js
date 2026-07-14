(function setupGlobalMenus() {
  const currentPath = window.location.pathname || "/";
  let permissions = {};
  let storedRole = "";
  let sessionToken = "";
  let userSettings = {};

  const menuConfig = window.MJ_STOCK_MENU_ITEMS || {};
  const screenAccess = window.MJScreenAccess;
  const gotoItems = menuConfig.gotoItems || [];
  const backofficeItems = menuConfig.backofficeItems || [];
  const LOGOUT_VALUE = "__logout__";

  function directSessionSnapshot() {
    return {
      token: localStorage.getItem("kitchenStockToken") || "",
      user: localStorage.getItem("kitchenStockUser") || "",
      role: String(localStorage.getItem("kitchenStockRole") || "user").trim().toLowerCase(),
      permissions: JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}"),
      settings: JSON.parse(localStorage.getItem("kitchenStockSettings") || "{}")
    };
  }

  function readSessionSnapshot() {
    const bridge = window.kitchenSessionBridge;
    if (bridge?.readKitchenSession) {
      const session = bridge.readKitchenSession(localStorage);
      return {
        ...session,
        role: String(session.role || "user").trim().toLowerCase()
      };
    }
    return directSessionSnapshot();
  }

  function writeSessionSnapshot(session) {
    const bridge = window.kitchenSessionBridge;
    if (bridge?.writeKitchenSession) {
      return bridge.writeKitchenSession(session, localStorage);
    }
    const current = directSessionSnapshot();
    const next = {
      ...current,
      ...session,
      permissions: session.permissions ?? current.permissions,
      settings: session.settings ?? current.settings
    };
    localStorage.setItem("kitchenStockToken", next.token || "");
    localStorage.setItem("kitchenStockUser", next.user || "");
    localStorage.setItem("kitchenStockRole", next.role || "user");
    localStorage.setItem("kitchenStockPermissions", JSON.stringify(next.permissions || {}));
    localStorage.setItem("kitchenStockSettings", JSON.stringify(next.settings || {}));
    return next;
  }

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
    const session = readSessionSnapshot();
    permissions = session.permissions || {};
    storedRole = String(session.role || "").trim().toLowerCase();
    sessionToken = session.token || "";
    userSettings = session.settings || {};
  }

  function sessionSnapshot() {
    const session = readSessionSnapshot();
    return JSON.stringify({
      permissions: session.permissions || {},
      storedRole: String(session.role || "").trim().toLowerCase(),
      sessionToken: session.token || "",
      userSettings: session.settings || {},
      userName: session.user || ""
    });
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
    const section = gotoItems.includes(item) ? "goto" : "backoffice";
    return screenAccess?.isItemAllowed(item, section, currentPermissions, userSettings) ?? true;
  }

  function currentPageMenuItem() {
    return screenAccess?.findItemForPath(currentPath, menuConfig)?.item || null;
  }

  function resolveFallbackPath() {
    return screenAccess?.firstAllowedPath(menuConfig, effectivePermissionSet(), userSettings) || "/";
  }

  function redirectIfCurrentPathBlocked() {
    const currentItem = currentPageMenuItem();
    if (!currentItem || allowed(currentItem)) return false;
    const fallbackPath = resolveFallbackPath();
    if (fallbackPath && fallbackPath !== currentPath) {
      window.location.replace(fallbackPath);
      return true;
    }
    return false;
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

  async function performLogout() {
    const logoutButton = document.querySelector("#logoutButton");
    if (logoutButton) {
      logoutButton.click();
      return;
    }
    try {
      const { clearKitchenSession } = await import("/session-shell.js");
      clearKitchenSession();
    } catch {
      localStorage.removeItem("kitchenStockToken");
      localStorage.removeItem("kitchenStockUser");
      localStorage.removeItem("kitchenStockRole");
      localStorage.removeItem("kitchenStockPermissions");
      localStorage.removeItem("kitchenStockSettings");
    }
    window.location.href = "/";
  }

  function mountMenus() {
    syncSessionState();
    if (redirectIfCurrentPathBlocked()) return;
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
          void performLogout();
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
    if (!sessionToken) return false;
    const before = sessionSnapshot();
    try {
      const response = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      if (!response.ok) return false;
      const data = await response.json();
      if (!data?.user) return false;
      permissions = data.user.permissions || permissions;
      storedRole = String(data.user.role || storedRole || "").trim().toLowerCase();
      userSettings = data.user.settings || userSettings || {};
      const current = readSessionSnapshot();
      writeSessionSnapshot({
        token: current.token,
        user: data.user.name || current.user || "",
        role: storedRole,
        permissions,
        settings: userSettings,
        theme: data.user.theme || current.theme || ""
      });
      syncSessionState();
      return before !== sessionSnapshot();
    } catch {
      // Keep cached permissions if the refresh check fails.
      return false;
    }
  }

  const boot = async ({ refresh = true } = {}) => {
    mountMenus();
    if (!refresh) return;
    const changed = await refreshPermissions();
    if (changed) mountMenus();
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
    boot({ refresh: true }).catch(() => {
      mountMenus();
      document.documentElement.classList.remove("menus-loading");
    });
  };
}());
