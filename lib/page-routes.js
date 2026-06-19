function mergeOptions(...parts) {
  return Object.assign({}, ...parts.filter(Boolean));
}

function normalizeAliases(pathname, aliases = []) {
  return [pathname, ...aliases];
}

export function createPageRouteBuilder(helpers) {
  const {
    pageScripts,
    loginPartial,
    orderShellActions
  } = helpers;

  const orderShellBase = {
    bodyClass: "order-app",
    contentClass: "order-shell",
    topbarMenus: true,
    brandTitle: "MJ Stock Magic",
    brandSubtitle: "MADAME JANETTE"
  };

  const setupShellBase = {
    contentClass: "shell setup-shell",
    topbarMenus: true,
    showPageIntro: true,
    topbarActions: orderShellActions()
  };

  const sheetShellBase = {
    contentClass: "shell sheet-shell",
    pageEyebrow: "Inventory",
    topbarMenus: true,
    showPageIntro: true,
    topbarClass: "no-print",
    topbarActions: orderShellActions()
  };

  const routeDefinitions = [
    {
      path: "/",
      aliases: ["/index.html"],
      view: "pages/index",
      build: async () => mergeOptions(orderShellBase, {
        pageTitle: "MJ Stock Magic Home",
        beforeMain: await loginPartial("MJ Stock Magic", "Inventory", { numericPassword: true }),
        topbarActions: orderShellActions(),
        footerScripts: pageScripts("/dashboard.js")
      })
    },
    {
      path: "/phase1-preview",
      view: "pages/phase1-preview",
      build: async () => mergeOptions(orderShellBase, {
        pageTitle: "Phase 1 Preview",
        topbarActions: orderShellActions(),
        footerScripts: pageScripts()
      })
    },
    {
      path: "/categories.html",
      view: "pages/categories",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Category Admin",
        pageEyebrow: "Inventory Setup",
        beforeMain: await loginPartial("Category Admin", "Inventory Setup"),
        footerScripts: pageScripts("/categories.js")
      })
    },
    {
      path: "/suppliers.html",
      view: "pages/suppliers",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Supplier Admin",
        pageEyebrow: "Inventory Setup",
        beforeMain: await loginPartial("Supplier Admin", "Inventory Setup"),
        footerScripts: pageScripts("/suppliers.js")
      })
    },
    {
      path: "/shelf-codes.html",
      view: "pages/shelf-codes",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Storage & Shelf Admin",
        pageEyebrow: "Inventory Setup",
        beforeMain: await loginPartial("Storage & Shelf Admin", "Inventory Setup"),
        footerScripts: pageScripts("/shelf-codes.js")
      })
    },
    {
      path: "/user-admin.html",
      view: "pages/user-admin",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "User Administration",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("User Admin", "Inventory"),
        footerScripts: pageScripts("/user-admin.js")
      })
    },
    {
      path: "/inventory-settings.html",
      view: "pages/inventory-settings",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Inventory Items",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("Inventory Items", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/inventory-settings.js")
      })
    },
    {
      path: "/inventory-add.html",
      view: "pages/inventory-add",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Add Inventory Item",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("Add Inventory Item", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/inventory-add.js")
      })
    },
    {
      path: "/change-password.html",
      view: "pages/change-password",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Change Password",
        pageEyebrow: "Inventory",
        footerScripts: pageScripts("/change-password.js")
      })
    },
    {
      path: "/settings.html",
      view: "pages/settings",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "My Settings",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("My Settings", "Inventory"),
        footerScripts: pageScripts("/settings.js")
      })
    },
    {
      path: "/standing-orders.html",
      view: "pages/standing-orders",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Standing Orders",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("Standing Orders", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/standing-orders.js")
      })
    },
    {
      path: "/invoice-capture.html",
      view: "pages/invoice-capture",
      build: async () => mergeOptions({
        contentClass: "shell",
        topbarMenus: true,
        showPageIntro: true,
        topbarActions: orderShellActions()
      }, {
        pageTitle: "Invoice Capture",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("Invoice Capture", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/invoice-capture.js")
      })
    },
    {
      path: "/ordering.html",
      view: "pages/ordering",
      build: async () => mergeOptions(orderShellBase, {
        pageTitle: "MJ Stock Magic Ordering",
        beforeMain: await loginPartial("MJ Stock Magic", "Inventory", { numericPassword: true }),
        topbarActions: orderShellActions({ saveButtonId: "submitButton", saveButtonLabel: "0 Saved" }),
        footerScripts: pageScripts("/app.js", { offline: true })
      })
    },
    {
      path: "/stock-count.html",
      view: "pages/stock-count",
      build: async () => mergeOptions(orderShellBase, {
        pageTitle: "Stock Count",
        bodyClass: "order-app stock-count-app",
        brandSubtitle: "STOCK COUNT",
        beforeMain: await loginPartial("Stock Count", "Inventory", { numericPassword: true }),
        topbarActions: orderShellActions({ saveButtonId: "saveAllButton", saveButtonLabel: "Save Counts" }),
        footerScripts: pageScripts("/stock-count.js", { offline: true })
      })
    },
    {
      path: "/receiving-sheet.html",
      view: "pages/receiving-sheet",
      build: async () => mergeOptions(sheetShellBase, {
        pageTitle: "Receiving",
        beforeMain: await loginPartial("Receiving", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/receiving-sheet.js")
      })
    },
    {
      path: "/driver-sheet.html",
      view: "pages/driver-sheet",
      build: async () => mergeOptions(sheetShellBase, {
        pageTitle: "Driver Sheet",
        beforeMain: await loginPartial("Driver Sheet", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/driver-sheet.js")
      })
    },
    {
      path: "/order-report.html",
      view: "pages/order-report",
      build: async () => mergeOptions(sheetShellBase, {
        pageTitle: "Order Report",
        beforeMain: await loginPartial("Order Report", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/order-report.js")
      })
    },
    {
      path: "/management-report.html",
      view: "pages/management-report",
      build: async () => mergeOptions(sheetShellBase, {
        pageTitle: "Management Report",
        beforeMain: await loginPartial("Management Report", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/management-report.js")
      })
    },
    {
      path: "/internal-orders.html",
      view: "pages/internal-orders",
      build: async () => mergeOptions(orderShellBase, {
        pageTitle: "Internal Orders",
        beforeMain: await loginPartial("Internal Orders", "Inventory", { numericPassword: true }),
        topbarActions: orderShellActions({ saveButtonId: "submitButton", saveButtonLabel: "0 Saved" }),
        footerScripts: pageScripts("/internal-orders.js", { offline: true })
      })
    },
    {
      path: "/picker-sheet.html",
      view: "pages/picker-sheet",
      build: async () => mergeOptions(setupShellBase, {
        pageTitle: "Picker Board",
        pageEyebrow: "Inventory",
        beforeMain: await loginPartial("Picker Board", "Inventory", { numericPassword: true }),
        footerScripts: pageScripts("/picker-sheet.js", { offline: true })
      })
    }
  ];

  const routeMap = new Map();
  for (const route of routeDefinitions) {
    for (const alias of normalizeAliases(route.path, route.aliases)) {
      routeMap.set(alias, route);
    }
  }

  return async function buildPageRoute(url) {
    const pathname = new URL(url, "http://localhost").pathname;
    const route = routeMap.get(pathname);
    if (!route) return null;
    return {
      view: route.view,
      options: await route.build()
    };
  };
}
