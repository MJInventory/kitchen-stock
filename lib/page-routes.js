export function createPageRouteBuilder(helpers) {
  const {
    pageScripts,
    loginPartial,
    actionButton,
    actionLogout,
    actionUserChip,
    joinActions,
    adminActions,
    sheetActions,
    orderShellActions
  } = helpers;

  return async function buildPageRoute(url) {
    const pathname = new URL(url, "http://localhost").pathname;
    switch (pathname) {
      case "/":
      case "/index.html":
        return {
          view: "pages/index",
          options: {
            pageTitle: "MJ Stock Magic Home",
            bodyClass: "order-app",
            contentClass: "order-shell",
            beforeMain: await loginPartial("MJ Stock Magic", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            brandTitle: "MJ Stock Magic",
            brandSubtitle: "MADAME JANETTE",
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/dashboard.js")
          }
        };
      case "/phase1-preview":
        return {
          view: "pages/phase1-preview",
          options: {
            pageTitle: "Phase 1 Preview",
            bodyClass: "order-app",
            contentClass: "order-shell",
            topbarMenus: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts()
          }
        };
      case "/categories.html":
        return {
          view: "pages/categories",
          options: {
            pageTitle: "Category Admin",
            pageEyebrow: "Inventory Setup",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Category Admin", "Inventory Setup"),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/categories.js")
          }
        };
      case "/suppliers.html":
        return {
          view: "pages/suppliers",
          options: {
            pageTitle: "Supplier Admin",
            pageEyebrow: "Inventory Setup",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Supplier Admin", "Inventory Setup"),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/suppliers.js")
          }
        };
      case "/shelf-codes.html":
        return {
          view: "pages/shelf-codes",
          options: {
            pageTitle: "Storage & Shelf Admin",
            pageEyebrow: "Inventory Setup",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Storage & Shelf Admin", "Inventory Setup"),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/shelf-codes.js")
          }
        };
      case "/user-admin.html":
        return {
          view: "pages/user-admin",
          options: {
            pageTitle: "User Administration",
            pageEyebrow: "Inventory",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("User Admin", "Inventory"),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/user-admin.js")
          }
        };
      case "/inventory-settings.html":
        return {
          view: "pages/inventory-settings",
          options: {
            pageTitle: "Inventory Items",
            pageEyebrow: "Inventory",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Inventory Items", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/inventory-settings.js")
          }
        };
      case "/inventory-add.html":
        return {
          view: "pages/inventory-add",
          options: {
            pageTitle: "Add Inventory Item",
            pageEyebrow: "Inventory",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Add Inventory Item", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/inventory-add.js")
          }
        };
      case "/change-password.html":
        return {
          view: "pages/change-password",
          options: {
            pageTitle: "Change Password",
            pageEyebrow: "Inventory",
            contentClass: "shell setup-shell",
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/change-password.js")
          }
        };
      case "/settings.html":
        return {
          view: "pages/settings",
          options: {
            pageTitle: "My Settings",
            pageEyebrow: "Inventory",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("My Settings", "Inventory"),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/settings.js")
          }
        };
      case "/standing-orders.html":
        return {
          view: "pages/standing-orders",
          options: {
            pageTitle: "Standing Orders",
            pageEyebrow: "Inventory",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Standing Orders", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/standing-orders.js")
          }
        };
      case "/invoice-capture.html":
        return {
          view: "pages/invoice-capture",
          options: {
            pageTitle: "Invoice Capture",
            pageEyebrow: "Inventory",
            contentClass: "shell",
            beforeMain: await loginPartial("Invoice Capture", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/invoice-capture.js")
          }
        };
      case "/ordering.html":
        return {
          view: "pages/ordering",
          options: {
            pageTitle: "MJ Stock Magic Ordering",
            bodyClass: "order-app",
            contentClass: "order-shell",
            beforeMain: await loginPartial("MJ Stock Magic", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            brandTitle: "MJ Stock Magic",
            brandSubtitle: "MADAME JANETTE",
            topbarActions: orderShellActions({ saveButtonId: "submitButton", saveButtonLabel: "0 Saved" }),
            footerScripts: pageScripts("/app.js", { offline: true })
          }
        };
      case "/stock-count.html":
        return {
          view: "pages/stock-count",
          options: {
            pageTitle: "Stock Count",
            bodyClass: "order-app stock-count-app",
            contentClass: "order-shell",
            beforeMain: await loginPartial("Stock Count", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            brandTitle: "MJ Stock Magic",
            brandSubtitle: "STOCK COUNT",
            topbarActions: orderShellActions({ saveButtonId: "saveAllButton", saveButtonLabel: "Save Counts" }),
            footerScripts: pageScripts("/stock-count.js", { offline: true })
          }
        };
      case "/receiving-sheet.html":
        return {
          view: "pages/receiving-sheet",
          options: {
            pageTitle: "Receiving",
            contentClass: "shell sheet-shell",
            beforeMain: await loginPartial("Receiving", "Inventory", { numericPassword: true }),
            pageEyebrow: "Inventory",
            topbarMenus: true,
            showPageIntro: true,
            topbarClass: "no-print",
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/receiving-sheet.js")
          }
        };
      case "/driver-sheet.html":
        return {
          view: "pages/driver-sheet",
          options: {
            pageTitle: "Driver Sheet",
            contentClass: "shell sheet-shell",
            beforeMain: await loginPartial("Driver Sheet", "Inventory", { numericPassword: true }),
            pageEyebrow: "Inventory",
            topbarMenus: true,
            showPageIntro: true,
            topbarClass: "no-print",
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/driver-sheet.js")
          }
        };
      case "/order-report.html":
        return {
          view: "pages/order-report",
          options: {
            pageTitle: "Order Report",
            contentClass: "shell sheet-shell",
            beforeMain: await loginPartial("Order Report", "Inventory", { numericPassword: true }),
            pageEyebrow: "Inventory",
            topbarMenus: true,
            showPageIntro: true,
            topbarClass: "no-print",
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/order-report.js")
          }
        };
      case "/internal-orders.html":
        return {
          view: "pages/internal-orders",
          options: {
            pageTitle: "Internal Orders",
            bodyClass: "order-app",
            contentClass: "order-shell",
            beforeMain: await loginPartial("Internal Orders", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            brandTitle: "MJ Stock Magic",
            brandSubtitle: "MADAME JANETTE",
            topbarActions: orderShellActions({ saveButtonId: "submitButton", saveButtonLabel: "0 Saved" }),
            footerScripts: pageScripts("/internal-orders.js", { offline: true })
          }
        };
      case "/picker-sheet.html":
        return {
          view: "pages/picker-sheet",
          options: {
            pageTitle: "Picker Board",
            contentClass: "shell setup-shell",
            beforeMain: await loginPartial("Picker Board", "Inventory", { numericPassword: true }),
            topbarMenus: true,
            showPageIntro: true,
            topbarActions: orderShellActions(),
            footerScripts: pageScripts("/picker-sheet.js", { offline: true })
          }
        };
      default:
        return null;
    }
  };
}
