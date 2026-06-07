(function () {
  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("kitchenStockTheme", normalized);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", normalized === "light" ? "#f6f3ea" : "#050505");
    }
  }

  window.applyKitchenTheme = applyTheme;
  applyTheme(localStorage.getItem("kitchenStockTheme") || "dark");
})();



