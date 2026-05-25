// ExamSo service worker — offline-first PWA.
//
// Bump VERSION whenever any file in APP_SHELL changes; the browser will
// install the new SW, evict the old cache on activate, and serve the
// updated assets on the next page load.

const VERSION = "2026-05-25-7";
const CACHE = `examso-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./prompt.template.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

const KATEX_ORIGIN = "https://cdn.jsdelivr.net";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isKatexCdn = url.origin === KATEX_ORIGIN;

  // SPA fallback — any in-scope navigation resolves to the cached shell.
  if (req.mode === "navigate" && sameOrigin) {
    event.respondWith(
      caches.match("./index.html").then((cached) => cached || fetch(req)),
    );
    return;
  }

  // App shell + KaTeX (versioned, immutable URLs): cache-first, network on miss.
  if (sameOrigin || isKatexCdn) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return response;
        });
      }),
    );
  }
});
