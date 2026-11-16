// שומר את האפליקציה ואת אריחי המפה, כדי שתעבוד גם בלי אינטרנט
const V = 'athina-v3', TILES = 'athina-tiles';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'data.js', 'extras.js', 'icon.svg', 'icon-180.png', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.host.endsWith('cartocdn.com')) { // אריחי מפה: קודם מהמטמון
    e.respondWith(caches.open(TILES).then(async c => (await c.match(u.href)) ||
      fetch(e.request).then(r => { if (r.ok) c.put(u.href, r.clone()); return r; })));
    return;
  }
  const own = u.origin === location.origin;
  if (!own && !/fonts\.g/.test(u.host)) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: own });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return own ? (await net) || hit : hit || net;
  }));
});
