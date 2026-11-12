// Network-first service worker: always try the network so new deploys land
// immediately; fall back to cache only when offline.
const CACHE = "wg-guide-v28";
const PRECACHE = [
  "./",
  "./index.html",
  "./transit.js",
  "./today.js",
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
  // cache:"reload" skips the HTTP cache (Pages serves max-age=600), so a fresh install
  // never seeds the offline copy with the previous deploy's files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// live train feeds and the weather are minute-fresh by definition: never serve one from cache
const LIVE_HOSTS = ["api-endpoint.mta.info", "api.open-meteo.com"];

// Weak signal (a trailhead, a train between stations): if the network hasn't answered a
// same-origin request in SLOW_MS and a cached copy exists, answer with the cached copy now.
// The network response still lands in the cache for next time. The page's own stale-build
// check asks with cache:"no-store", and that one always waits for the network.
const SLOW_MS = 6000;

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (LIVE_HOSTS.includes(url.hostname)) return;
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  let saved = Promise.resolve();
  const net = fetch(e.request).then(res => {
    // keep only good copies: a 404 or 500 cached here would be served offline later
    // in place of the last working version (opaque = cross-origin, status unknowable)
    if (res.ok || res.type === "opaque") {
      const copy = res.clone();
      saved = caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
    }
    return res;
  });
  // keep the worker alive until the cache write lands, even when we answered early
  e.waitUntil(net.then(() => saved, () => {}));
  const slowOK = url.origin === self.location.origin && e.request.cache !== "no-store";
  const answer = !slowOK ? net : Promise.race([net,
    new Promise(r => setTimeout(r, SLOW_MS)).then(cached).then(c => c || net)]);
  e.respondWith(answer.catch(cached));
});
