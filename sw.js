/* Service Worker — 讓 PWA 可被「安裝」並支援離線
 * 策略：網路優先(network-first)。線上時永遠抓最新檔並順手更新快取，
 * 只有離線(fetch 失敗)才用快取墊底 → 不會再卡在舊版本。 */
const CACHE = 'planting-diagnosis-v23';
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
  // 網路優先：抓到就回傳並更新快取；離線失敗才退回快取，最後退回首頁
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
  );
});
