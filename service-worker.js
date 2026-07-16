const CACHE_NAME = "capito-v83-events-offline";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./firebase-config.js",
  "./js/app.js",
  "./js/charts.js",
  "./js/finance.js",
  "./js/firebase.js",
  "./js/importer.js",
  "./js/market.js",
  "./js/store.js",
  "./icons/favicon.ico",
  "./icons/favicon-16x16.png",
  "./icons/favicon-32x32.png",
  "./icons/favicon-48x48.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const localCore = CORE.filter(item => String(item).startsWith("./"));
      const remoteCore = CORE.filter(item => !String(item).startsWith("./"));
      await cache.addAll(localCore);
      await Promise.allSettled(remoteCore.map(item => cache.add(item)));
    }).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isFirebaseModule = url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/12.15.0/");
  const isAppShell =
    event.request.mode === "navigate" ||
    isFirebaseModule ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest");

  if (isAppShell) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fresh = fetch(event.request, { cache: "no-store" })
          .then(response => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => undefined);
            return response;
          })
          .catch(() => cached || caches.match("./index.html"));
        return cached || fresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => undefined);
      return response;
    }))
  );
});
