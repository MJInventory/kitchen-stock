const CACHE_NAME = "kitchen-stock-v34";
const APP_SHELL = [
  "/",
  "/index.html",
  "/driver-sheet.html",
  "/inventory-settings.html",
  "/stock-count.html",
  "/invoice-capture.html",
  "/styles.css",
  "/app.js",
  "/driver-sheet.js",
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
