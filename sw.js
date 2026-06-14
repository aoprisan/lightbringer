// Service worker for The Light-Bringer.
// App-shell caching so the game is fully playable offline once visited.
// Bump CACHE when shipping new assets to retire the old cache.
const CACHE = "lightbringer-v37";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  // Pentagram — the action-combat spinoff (its own page + module, reusing the
  // same art and cities). Network-first like the rest of the shell (see isShell).
  "./pentagram.html",
  "./pentagram.js",
  "./pentagram.webmanifest",
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
    // `cache: "reload"` makes each precache fetch bypass the browser's HTTP
    // cache, so a new SW version stores the freshly-deployed files — not the
    // stale copies the browser may still be holding from before the deploy.
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The app shell — the page and the compiled app.js — is the *code*, and it
// changes on every deploy. Pinning it cache-first means a shipped fix stays
// invisible behind the old cached copy until the cache version retires it (and
// even then only after every tab closes). So the shell is network-first: when
// online the newest code always wins, and the cache is only the offline
// fallback. Everything else (art, icons, fonts) is large and slow-changing, so
// it stays cache-first — that is what makes the game playable offline at all.
function isShell(url) {
  return url.pathname === "/" || url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") || url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/pentagram.html") || url.pathname.endsWith("/pentagram.js");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (isShell(url)) {
    // Network-first: freshest code wins; the cache catches us when offline.
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Cache-first for the heavy, stable assets; fall back to the network and cache it.
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
