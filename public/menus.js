(function setupGlobalMenus() {
  const currentPath = window.location.pathname || "/";
  let permissions = {};
  let storedRole = "";
  let sessionToken = "";

  const gotoItems = [
    { label: "Front Page", href: "/" },
    { label: "Ordering", href: "/ordering.html", permission: "canUseSupplierOrdering" },
    { label: "Internal Orders", href: "/internal-orders.html", permission: "canPlaceInternalOrders" },
    { label: "Picker Board", href: "/picker-sheet.html", permission: "canPickInternalOrders" },
    { label: "Receiving", href: "/receiving-sheet.html" },
    { label: "Driver Sheet", href: "/driver-sheet.html" },
    { label: "Stock Count", href: "/stock-count.html" },
    { label: "Reports", href: "/order-report.html" }
  ];

  const backofficeItems = [
    { label: "Standing Orders", href: "/standing-orders.html", permission: "canAddInventoryItems" },
    { label: "Inventory Items", href: "/inventory-settings.html", permission: "canAddInventoryItems" },
    { label: "Suppliers", href: "/suppliers.html", permission: "canAddInventoryItems" },
    { label: "Categories", href: "/categories.html", permission: "canAddInventoryItems" },
    { label: "Storage & Shelves", href: "/shelf-codes.html", permission: "canAddInventoryItems" },
    { label: "User Admin", href: "/user-admin.html", permission: "canAdminUsers" },
    { label: "Change Password", href: "/change-password.html" },
    { label: "Log Out", href: "__logout__" }
  ];

  function syncSessionState() {
    permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");
    storedRole = String(localStorage.getItem("kitchenStockRole") || "").trim().toLowerCase();
    sessionToken = localStorage.getItem("kitchenStockToken") || "";
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
    return !item.permission || Boolean(currentPermissions[item.permission]);
  }

  function renderSelect(label, selectId, items) {
    const visibleItems = items.filter(allowed);
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
        if (event.target.value === "__logout__") {
          const logoutButton = document.querySelector("#logoutButton");
          if (logoutButton) {
            logoutButton.click();
            event.target.value = "";
            return;
          }
          localStorage.removeItem("kitchenStockToken");
          localStorage.removeItem("kitchenStockUser");
          localStorage.removeItem("kitchenStockRole");
          localStorage.removeItem("kitchenStockPermissions");
          window.location.href = currentPath === "/" ? "/" : "/";
          return;
        }
        window.location.href = event.target.value;
      });
    });

    const logoutButton = document.querySelector("#logoutButton");
    if (logoutButton) logoutButton.hidden = true;
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
      boot().catch(() => mountMenus());
    }, { once: true });
  } else {
    boot().catch(() => mountMenus());
  }

  window.refreshKitchenMenus = () => {
    boot().catch(() => mountMenus());
  };
}());
