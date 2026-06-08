const CACHE_NAME = "kitchen-stock-v77";
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
  "/storage-locations.html",
  "/shelf-codes.html",
  "/standing-orders.html",
  "/inventory-settings.html",
  "/stock-count.html",
  "/invoice-capture.html",
  "/styles.css",
  "/app.js",
  "/dashboard.js",
  "/theme.js",
  "/driver-sheet.js",
  "/receiving-sheet.js",
  "/order-report.js",
  "/change-password.js",
  "/user-admin.js",
  "/inventory-add.js",
  "/categories.js",
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});








