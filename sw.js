/* =========================================================
 * Service worker — offline support for the whole app.
 * Strategy: pre-cache every asset on install, then serve
 * cache-first. Bump CACHE_VERSION on every deploy that
 * changes any asset so old caches are purged on activate.
 *
 * The AI voice feature loads WebLLM + transformers.js from
 * CDNs; those origins are runtime-cached (first use online,
 * offline afterwards). The AI model weights themselves are
 * cached by the libraries in their OWN caches
 * ("webllm/model", "transformers-cache") — activate must
 * never delete those, only caches with our own prefix.
 * ========================================================= */

const CACHE_VERSION = "tourist-chinese-v6";
const CDN_HOSTS = [
  "esm.run",            // webllm ES module bundle
  "cdn.jsdelivr.net",   // transformers.js + its wasm backends
  "unpkg.com"
];
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./translate.js",
  "./ai.js",
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
        // Only purge OUR app-shell caches — never the AI model caches
        // ("webllm/model", "transformers-cache") or anyone else's.
        keys.filter((k) => k.indexOf("tourist-chinese-") === 0 && k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isCdn = CDN_HOSTS.some(
    (h) => url.hostname === h || url.hostname.endsWith("." + h)
  );
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Runtime-cache CDN library files so the AI feature
        // works offline after its first online use.
        if (isCdn && res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE_VERSION)
            .then((c) => c.put(event.request, copy))
            .catch(() => {});
        }
        return res;
      }).catch(() => {
        // offline navigation fallback: the cached shell
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return Response.error();
      });
    })
  );
});
