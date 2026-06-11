const CACHE_NAME = "kitchen-stock-v121";
const APP_SHELL = [
  "/",
  "/index.html",
  "/ordering.html",
  "/driver-sheet.html",
  "/receiving-sheet.html",
  "/order-report.html",
  "/change-password.html",
  "/user-admin.html",
  "/inventory-add.html",
  "/categories.html",
  "/suppliers.html",
  "/storage-locations.html",
  "/shelf-codes.html",
  "/standing-orders.html",
  "/inventory-settings.html",
  "/stock-count.html",
  "/invoice-capture.html",
  "/styles.css",
  "/app.js",
  "/dashboard.js",
  "/menus.js",
  "/push.js",
  "/theme.js",
  "/driver-sheet.js",
  "/receiving-sheet.js",
  "/order-report.js",
  "/change-password.js",
  "/user-admin.js",
  "/inventory-add.js",
  "/categories.js",
  "/suppliers.js",
  "/storage-locations.js",
  "/shelf-codes.js",
  "/standing-orders.js",
  "/page-auth.js",
  "/inventory-settings.js",
  "/stock-count.js",
  "/invoice-capture.js",
  "/manifest.webmanifest",
  "/madame-janette-logo.png",
  "/mjordering-icon-192.png",
  "/mjordering-icon-512.png",
  "/mjordering-apple-touch-icon.png",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const isAppShellRequest = event.request.mode === "navigate"
    || url.pathname === "/"
    || url.pathname.endsWith(".html")
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".css")
    || url.pathname.endsWith(".webmanifest");

  if (isAppShellRequest) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(event.request, { cache: "no-store" });
        if (fresh && fresh.ok) {
          cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw new Error("Network unavailable");
      }
    })());
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return { title: "MJ Stock Magic", body: event.data?.text?.() || "" };
    }
  })();

  const title = payload.title || "MJ Stock Magic";
  const options = {
    body: payload.body || "",
    icon: "/mjordering-icon-192.png",
    badge: "/mjordering-icon-192.png",
    tag: payload.tag || "mj-stock-magic",
    data: payload.data || { url: payload.url || "/" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = allClients.find((client) => "focus" in client);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) {
        await existing.navigate(targetUrl);
      }
      return;
    }
    await clients.openWindow(targetUrl);
  })());
});











