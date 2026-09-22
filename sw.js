/* PyPhone service worker — caches app shell + Pyodide for offline use */

const CACHE_NAME = 'pyphone-v1';

/* Files precached on install */
const APP_SHELL = [
  './',
  './index.html',
];

/* ---------- install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())   // don't wait for old tabs to close
  );
});

/* ---------- activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)   // anything not our current version
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())      // take over open tabs immediately
  );
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;   // never cache POST/PUT/DELETE

  const url = new URL(req.url);

  /* Pyodide + packages from jsDelivr.
     URLs contain the version number, so they're immutable → cache-first. */
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* Our own files (index.html, sw.js) → stale-while-revalidate. */
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  /* Anything else → let the browser handle it. */
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp && resp.ok) cache.put(req, resp.clone());
  return resp;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => hit);   // offline? fall back to whatever we have
  return hit || network;
}
