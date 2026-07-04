const APP_CACHE = "vaultpilot-app-v1";
const FIREBASE_CACHE = "vaultpilot-firebase-v1";
const FIREBASE_VERSION = "12.15.0";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./firebase-config.js",
  "./js/app.js",
  "./js/firebase.js",
  "./js/store.js",
  "./js/finance.js",
  "./js/importer.js",
  "./js/market.js",
  "./js/charts.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("vaultpilot-") && ![APP_CACHE, FIREBASE_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith(`/firebasejs/${FIREBASE_VERSION}/`)) {
    event.respondWith(caches.open(FIREBASE_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(APP_CACHE).then(cache => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) caches.open(APP_CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
