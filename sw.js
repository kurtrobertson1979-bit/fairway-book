// Offline support: app shell is cached on install; map tiles and fonts are cached as they load.
const VERSION = 'fwb-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/ui.js', 'js/golf.js', 'js/whs.js', 'js/geo.js', 'js/play.js', 'js/courses.js', 'js/insights.js', 'js/demo.js', 'js/live.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'data/england-courses.json', 'data/packs/index.json', 'data/packs/poult-wood-18.json', 'data/packs/poult-wood-9.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('fwb-v') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Satellite tiles: cache first (saved for offline from the course page)
  if (url.hostname === 'server.arcgisonline.com') {
    e.respondWith(caches.open('fwb-tiles').then(async (c) => {
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request.url, r.clone()); return r; }
      catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    e.respondWith(caches.open('fwb-fonts').then(async (c) => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // App files: network first so updates arrive, cache when offline
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
  }
});
