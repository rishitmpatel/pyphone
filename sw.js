/* PyPhone service worker */

const CACHE_NAME = 'pyphone-v6';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './worker.js',
  './pyrunner.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---- input() bridge ----------------------------------------------------
 * The Python worker cannot show a prompt, and it must block until the user
 * answers. It does a synchronous XHR to /__pyphone_stdin__?id=N; we hold that
 * request open until the page posts { type:'pyphone-stdin', id, value }. */
const stdinWaiters = new Map();
const stdinAnswers = new Map();

function textResponse(text) {
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function waitForStdin(id) {
  if (stdinAnswers.has(id)) {
    const v = stdinAnswers.get(id);
    stdinAnswers.delete(id);
    return Promise.resolve(textResponse(v));
  }
  return new Promise((resolve) => {
    stdinWaiters.set(id, (v) => resolve(textResponse(v)));
  });
}

self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || d.type !== 'pyphone-stdin') return;
  const id = String(d.id);
  const value = String(d.value == null ? '' : d.value);
  const waiter = stdinWaiters.get(id);
  if (waiter) {
    stdinWaiters.delete(id);
    waiter(value);
  } else {
    stdinAnswers.set(id, value);
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.endsWith('/__pyphone_stdin__')) {
    event.respondWith(waitForStdin(url.searchParams.get('id') || ''));
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
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
    .catch(() => hit);
  return hit || network;
}
