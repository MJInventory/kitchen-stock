(function () {
  const installButton = document.querySelector("[data-install-app]");
  const iosHelp = document.querySelector("[data-ios-install-help]");
  const closeButton = document.querySelector("[data-install-close]");
  const installStateKey = "mj-stock-magic-app-installed";
  const installedDisplayModes = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];
  let installPrompt = null;

  function installedStandalone() {
    return installedDisplayModes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
      || window.navigator.standalone === true
      || document.referrer.startsWith("android-app://")
      || Boolean(window.navigator.windowControlsOverlay?.visible);
  }

  function rememberedInstalled() {
    try {
      return window.localStorage.getItem(installStateKey) === "true";
    } catch {
      return false;
    }
  }

  function rememberInstalled() {
    try {
      window.localStorage.setItem(installStateKey, "true");
    } catch {
      // Storage can be blocked without affecting normal app use.
    }
    installPrompt = null;
    if (installButton) installButton.hidden = true;
    if (iosHelp) iosHelp.hidden = true;
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const appBuild = document.querySelector('meta[name="app-build"]')?.getAttribute("content")
      || document.querySelector('meta[name="app-version"]')?.getAttribute("content")
      || "dev";

    window.addEventListener("load", () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(appBuild)}`, { updateViaCache: "none" }).then((registration) => {
        registration.update().catch(() => {});
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && registration.waiting) {
              registration.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      }).catch(() => {
        // Installation support is optional; the normal website remains usable.
      });
    });
  }

  registerServiceWorker();

  if (installedStandalone()) rememberInstalled();
  if (installButton && !installedStandalone() && !rememberedInstalled() && isIosDevice()) {
    installButton.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (installedStandalone() || rememberedInstalled()) {
      if (installButton) installButton.hidden = true;
      return;
    }
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  installButton?.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      installButton.hidden = true;
      if (choice.outcome === "accepted") rememberInstalled();
      return;
    }
    if (isIosDevice() && iosHelp) iosHelp.hidden = false;
  });

  closeButton?.addEventListener("click", () => {
    if (iosHelp) iosHelp.hidden = true;
  });

  window.addEventListener("appinstalled", rememberInstalled);
  installedDisplayModes.forEach((mode) => {
    window.matchMedia(`(display-mode: ${mode})`).addEventListener?.("change", (event) => {
      if (event.matches) rememberInstalled();
    });
  });

  navigator.getInstalledRelatedApps?.().then((apps) => {
    if (apps.length) rememberInstalled();
  }).catch(() => {});
}());
