const CACHE = "workmates-offline-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/offline.html")));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("workmates-offline-") && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/hook/")) return;
  event.respondWith(fetch(event.request).catch(async () =>
    (await caches.match("/offline.html")) || Response.error()));
});
