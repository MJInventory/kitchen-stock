(function configureMjStockMenus() {
  window.MJ_STOCK_MENU_ITEMS = {
    gotoItems: [
      { label: "Front Page", href: "/" },
      { label: "Ordering", href: "/ordering.html", permission: "canUseSupplierOrdering" },
      { label: "Internal Orders", href: "/internal-orders.html", permission: "canPlaceInternalOrders" },
      { label: "Picker Board", href: "/picker-sheet.html", permission: "canPickInternalOrders" },
      { label: "Receiving", href: "/receiving-sheet.html" },
      { label: "Driver Sheet", href: "/driver-sheet.html" },
      { label: "Stock Count", href: "/stock-count.html" },
      { label: "Reports", href: "/order-report.html" }
    ],
    backofficeItems: [
      { label: "Settings", href: "/settings.html", fixed: true },
      { label: "Management Report", href: "/management-report.html", permission: "canAddInventoryItems" },
      { label: "Standing Orders", href: "/standing-orders.html", permission: "canAddInventoryItems" },
      { label: "Inventory Items", href: "/inventory-settings.html", permission: "canAddInventoryItems" },
      { label: "Suppliers", href: "/suppliers.html", permission: "canAddInventoryItems" },
      { label: "Categories", href: "/categories.html", permission: "canAddInventoryItems" },
      { label: "Storage & Shelves", href: "/shelf-codes.html", permission: "canAddInventoryItems" },
      { label: "User Admin", href: "/user-admin.html", permission: "canAdminUsers" }
    ]
  };
}());
