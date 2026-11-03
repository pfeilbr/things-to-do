// Network-first service worker: always try the network so new deploys land
// immediately; fall back to cache only when offline.
const CACHE = "wg-guide-v17";
const PRECACHE = [
  "./",
  "./index.html",
  "./transit.js",
  "./data.json",
  "./data-nyc.json",
  "./data-brooklyn.json",
  "./data-queens.json",
  "./data-foresthills.json",
  "./data-flushing.json",
  "./data-ithaca.json",
  "./data-verona.json",
  "./data-ac.json",
  "./data-baltimore.json",
  "./data-dc.json",
  "./data-pittsburgh.json",
  "./data-richmond.json",
  "./data-stamford.json",
  "./guide-stamford.json",
  "./transit-stamford.json",
  "./data-boston.json",
  "./data-vb.json",
  "./data-buffalo.json",
  "./data-cleveland.json",
  "./data-raleigh.json",
  "./data-chicago.json",
  "./data-toronto.json",
  "./data-nashville.json",
  "./data-la.json",
  "./data-sf.json",
  "./data-seattle.json",
  "./data-sandiego.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// live train feeds are minute-fresh by definition: never serve one from cache
const LIVE_HOSTS = ["api-endpoint.mta.info"];

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (LIVE_HOSTS.includes(new URL(e.request.url).hostname)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // keep only good copies: a 404 or 500 cached here would be served offline later
        // in place of the last working version (opaque = cross-origin, status unknowable)
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
