(function () {
  const APP_VERSION = "v151";

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

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register(`/sw.js?${APP_VERSION}`, { updateViaCache: "none" }).then((registration) => {
      function activateWaitingWorker() {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            activateWaitingWorker();
          }
        });
      });

      if (registration.waiting) {
        activateWaitingWorker();
      }

      const checkForUpdates = () => registration.update().catch(() => {});
      checkForUpdates();
      window.setInterval(checkForUpdates, 60000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          checkForUpdates();
        }
      });
    }).catch(() => {});
  }

  window.applyKitchenTheme = applyTheme;
  applyTheme(localStorage.getItem("kitchenStockTheme") || "dark");
  registerUpdater();
}());




