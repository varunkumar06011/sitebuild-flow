// Service worker for Meditrust ERP — provides offline app shell caching.
// Master data (vendors, items, blocks) is cached on first fetch and served from cache when offline.
const CACHE_NAME = "meditrust-erp-v1";
const APP_SHELL = [
  "/",
  "/favicon.ico",
  "/manifest.json",
];

// Install: pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))),
    ).then(() => self.clients.claim()),
  );
});

// Fetch: network-first for navigation, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip cross-origin requests (fonts, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API/server function calls (POST endpoints)
  if (url.pathname.startsWith("/_server") || url.pathname.startsWith("/api/")) return;

  // Navigation requests: network-first, fall back to cached app shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Only cache successful responses
        if (response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }),
  );
});

// Listen for messages from the client (e.g., manual cache clear)
self.addEventListener("message", (event) => {
  if (event.data === "clear-cache") {
    caches.delete(CACHE_NAME).then(() => {
      event.source?.postMessage({ success: true });
    });
  }
});
