/* =========================================================
 * Service worker — offline support for the whole app.
 * Strategy: pre-cache every asset on install, then serve
 * cache-first. Bump CACHE_VERSION on every deploy that
 * changes any asset so old caches are purged on activate.
 * ========================================================= */

const CACHE_VERSION = "tourist-chinese-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./translate.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./data/categories.js",
  "./data/cat1.js",
  "./data/cat2.js",
  "./data/cat3.js",
  "./data/cat4.js",
  "./data/cat5.js",
  "./data/cat6.js",
  "./data/cat7.js",
  "./data/cat8.js",
  "./data/cat9.js",
  "./data/cat10.js",
  "./data/dict.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // offline navigation fallback: the cached shell
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      });
    })
  );
});
