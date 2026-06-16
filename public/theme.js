(function () {
  const APP_VERSION = "2.005";

  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("kitchenStockTheme", normalized);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", normalized === "light" ? "#f6f3ea" : "#050505");
    }
  }

  function registerUpdater() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, { updateViaCache: "none" }).then((registration) => {
      registration.update().catch(() => {});
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => {});
  }

  window.applyKitchenTheme = applyTheme;
  applyTheme(localStorage.getItem("kitchenStockTheme") || "dark");
  registerUpdater();
}());

