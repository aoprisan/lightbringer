// Service worker for The Light-Bringer.
// App-shell caching so the game is fully playable offline once visited.
// Bump CACHE when shipping new assets to retire the old cache.
const CACHE = "lightbringer-v28";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/icon-180.png",
  "./icons/og-image.jpg",
  "./art/title-backdrop.jpg",
  "./art/keeper-sigil.png",
  "./art/fresco-sun.jpg",
  "./art/fresco-veil.jpg",
  "./art/fresco-press.jpg",
  "./art/fresco-child.jpg",
  "./art/fresco-morning.jpg",
  "./art/texture-vellum.jpg",
  "./art/texture-ink.jpg",
  // Gameplay sprites (see ART_PLAN.md), optimized from art/prompts/*.png.
  // addAll() rejects the whole install if any listed asset 404s, so every
  // file here must exist in art/ — bump CACHE whenever this list changes.
  "./art/ground.png",
  "./art/dwelling-dark.png",
  "./art/dwelling-lit.png",
  "./art/dwelling-awakened.png",
  "./art/dwelling-snuffed.png",
  "./art/conduit.png",
  "./art/press.png",
  "./art/shrine.png",
  "./art/keeper-node.png",
  "./art/keeper-patrol.png",
  "./art/player-lantern.png",
  "./art/veil-scar.png",
  "./art/flame-spark.png",
  "./art/rain-overlay.png",
  "./art/wind-overlay.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for our own GET requests; fall back to the network and cache it.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
