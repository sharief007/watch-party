// Minimal service worker for Watch Party PWA install + offline app shell.
// Stays out of WebRTC traffic (signaling/STUN/TURN are cross-origin or non-HTTP).

const CACHE = 'watch-party-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Never intercept cross-origin requests — leaves PeerJS signaling, TURN
  // health checks, etc. completely untouched.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, fall back to cached index.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = await caches.match('./');
        if (fallback) return fallback;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Static assets: cache-first.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      // No cache and no network — let the browser surface the error.
      return Response.error();
    }
  })());
});
