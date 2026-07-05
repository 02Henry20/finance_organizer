const CACHE_NAME = "vaultpilot-v5";
const CORE = ["./", "./index.html", "./styles.css", "./manifest.webmanifest", "./js/app.js", "./js/charts.js", "./js/finance.js", "./js/firebase.js", "./js/importer.js", "./js/market.js", "./js/store.js", "./firebase-config.js"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).catch(() => undefined));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
