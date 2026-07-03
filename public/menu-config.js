(function configureMjStockMenus() {
  window.MJ_STOCK_MENU_ITEMS = {
    gotoItems: [
      { label: "Home", href: "/" },
      { label: "Ordering", href: "/ordering.html", permission: "canUseSupplierOrdering" },
      { label: "Internal Orders", href: "/internal-orders.html", permission: "canPlaceInternalOrders" },
      { label: "Picker Board", href: "/picker-sheet.html", permission: "canPickInternalOrders" },
      { label: "Kitchen Roster", href: "/kitchen-roster.html", permission: "canViewKitchenRoster" },
      { label: "Receiving", href: "/receiving-sheet.html" },
      { label: "Driver Sheet", href: "/driver-sheet.html" },
      { label: "Stock Count", href: "/stock-count.html" },
      { label: "Reports", href: "/order-report.html" },
      { label: "Log Off", href: "__logout__" }
    ],
    backofficeItems: [
      { label: "Settings", href: "/settings.html", fixed: true },
      { label: "Management Report", href: "/management-report.html", permission: "canAddInventoryItems" },
      { label: "Standing Orders", href: "/standing-orders.html", permission: "canAddInventoryItems" },
      { label: "Item Admin", href: "/inventory-settings.html", permission: "canAddInventoryItems" },
      { label: "User Admin", href: "/user-admin.html", permission: "canAdminUsers" },
      { label: "Log Off", href: "__logout__" }
    ]
  };
}());
