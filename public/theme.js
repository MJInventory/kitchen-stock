(function () {
  function applyTheme() {
    const normalized = "light";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("kitchenStockTheme", normalized);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", "#f6f3ea");
    }
  }

  window.applyKitchenTheme = applyTheme;
  applyTheme();
}());



