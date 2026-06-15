(function setupGlobalMenus() {
  const currentPath = window.location.pathname || "/";
  const permissions = JSON.parse(localStorage.getItem("kitchenStockPermissions") || "{}");

  const gotoItems = [
    { label: "Front Page", href: "/" },
    { label: "Ordering", href: "/ordering.html" },
    { label: "Receiving", href: "/receiving-sheet.html" },
    { label: "Driver Sheet", href: "/driver-sheet.html" },
    { label: "Reports", href: "/order-report.html" },
    { label: "Standing Orders", href: "/standing-orders.html", permission: "canAddInventoryItems" },
    { label: "Stock Count", href: "/stock-count.html" },
    { label: "Invoices", href: "/invoice-capture.html", permission: "canUseInvoices" }
  ];

  const backofficeItems = [
    { label: "Inventory Items", href: "/inventory-settings.html", permission: "canAddInventoryItems" },
    { label: "Add Item", href: "/inventory-add.html", permission: "canAddInventoryItems" },
    { label: "Categories", href: "/categories.html", permission: "canAddInventoryItems" },
    { label: "Suppliers", href: "/suppliers.html", permission: "canAddInventoryItems" },
    { label: "Storage & Shelves", href: "/shelf-codes.html", permission: "canAddInventoryItems" },
    { label: "User Admin", href: "/user-admin.html", permission: "canAdminUsers" },
    { label: "Log Out", href: "__logout__" }
  ];

  function allowed(item) {
    return !item.permission || Boolean(permissions[item.permission]);
  }

  function renderSelect(label, selectId, items) {
    const visibleItems = items.filter(allowed);
    if (!visibleItems.length) return "";
    const selectedHref = visibleItems.some((item) => item.href === currentPath) ? currentPath : "";
    const defaultLabel = label === "Go to" ? "Where next?" : "Backoffice tasks";
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountMenus, { once: true });
  } else {
    mountMenus();
  }

  window.refreshKitchenMenus = mountMenus;
}());
