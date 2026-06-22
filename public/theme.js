(function () {
  const APP_VERSION = document.querySelector('meta[name="app-version"]')?.getAttribute("content") || "dev";

  function applyTheme() {
    const normalized = "light";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("kitchenStockTheme", normalized);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", "#f6f3ea");
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
  applyTheme();
  registerUpdater();
}());



