/* Service Worker — 讓 PWA 可被「安裝」並支援基本離線快取 */
const CACHE = 'planting-diagnosis-v6';
const ASSETS = ['./', 'index.html', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 外部 API（天氣 / 反向地理編碼）直接走網路，不進快取
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).catch(() => caches.match('index.html')))
  );
});
