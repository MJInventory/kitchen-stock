(function () {
  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("kitchenStockTheme", normalized);
  }

  window.applyKitchenTheme = applyTheme;
  applyTheme(localStorage.getItem("kitchenStockTheme") || "dark");
})();
