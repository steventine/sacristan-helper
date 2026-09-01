// Offline support for Sacristan Helper.
//
// Strategy: network-first with a short timeout, falling back to cache.
// The sacristy has poor signal, but a wrong reading is worse than a slow one,
// so a fresh copy always wins when the network answers quickly. Because every
// successful response is written back to the cache, a redeployed index.html or
// readings.json is picked up on the next online visit with no version bump.
//
// Bump VERSION only when this file's caching logic changes; that purges the
// old cache on activate.
const VERSION = 'v1';
const CACHE = 'sacristan-' + VERSION;
const ASSETS = ['./', './index.html', './readings.json'];
const NETWORK_TIMEOUT_MS = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Don't fail the whole install if one asset is momentarily unavailable.
      .then((cache) => Promise.allSettled(ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Leave the USCCB verification links to the browser.
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  // Always kick off the network request; it refreshes the cache either way.
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  });

  const cached = await cache.match(request, { ignoreSearch: true });
  if (!cached) return network.catch(() => shell(cache, request));

  // Have a usable copy: prefer the network, but never block on a bad signal.
  return Promise.race([
    network.catch(() => cached),
    wait(NETWORK_TIMEOUT_MS).then(() => cached),
  ]);
}

async function shell(cache, request) {
  if (request.mode === 'navigate') {
    const page = await cache.match('./index.html');
    if (page) return page;
  }
  return new Response('Offline and nothing cached yet.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}
