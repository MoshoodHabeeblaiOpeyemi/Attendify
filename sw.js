const CACHE_NAME = "attendify-v1";
const assetsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js"
];

// Install Event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assetsToCache);
    })
  );
});

// Fetch Event
self.addEventListener("fetch", (event) => {
  event.responWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});