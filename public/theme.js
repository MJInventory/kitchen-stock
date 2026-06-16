(function () {
  const APP_VERSION = "v158";

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
    let updatePromptShownFor = "";
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

      function maybePromptForRefresh(worker) {
        if (!worker || worker.state !== "installed" || !navigator.serviceWorker.controller) return;
        if (updatePromptShownFor === APP_VERSION) return;
        updatePromptShownFor = APP_VERSION;
        if (window.confirm("A new version is ready. Refresh now?")) {
          activateWaitingWorker();
        }
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          maybePromptForRefresh(worker);
        });
      });

      if (registration.waiting) {
        maybePromptForRefresh(registration.waiting);
      }

      const checkForUpdates = () => registration.update().catch(() => {});
      checkForUpdates();
    }).catch(() => {});
  }

  window.applyKitchenTheme = applyTheme;
  applyTheme(localStorage.getItem("kitchenStockTheme") || "dark");
  registerUpdater();
}());











