const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/sheet.js",
  "./js/map.js",
  "./js/deepseek.js",
  "./js/parse-route.js",
  "./data/sample-route.json",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const CACHE = "wander-lite-v5";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  const sameOrigin = url.origin === location.origin;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (sameOrigin && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (sameOrigin ? caches.match("./index.html") : undefined)))
  );
});
