const CACHE_NAME = "kitchen-stock-v2.007";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/madame-janette-logo-v162.png",
  "/mjstock-icon-192-v162.png",
  "/mjstock-icon-512-v162.png",
  "/mjstock-apple-touch-v162.png",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(STATIC_ASSETS);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isStaticAsset = STATIC_ASSETS.includes(url.pathname);
  if (!isStaticAsset) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const fresh = await fetch(event.request, { cache: "no-store" });
    if (fresh?.ok) {
      cache.put(event.request, fresh.clone());
    }
    return fresh;
  })());
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
    icon: "/mjstock-icon-192-v162.png",
    badge: "/mjstock-icon-192-v162.png",
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


