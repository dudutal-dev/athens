// שומר את האפליקציה ואת אריחי המפה שכבר נצפו, כדי שתעבוד גם עם קליטה חלשה
const V = 'athina-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'data.js', 'icon.svg', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const cacheable = u.origin === location.origin || /cartocdn|cdnjs|fonts\.g/.test(u.host);
  if (!cacheable) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return u.origin === location.origin ? (await net) || hit : hit || net;
  }));
});
