/* Service worker: makes the app shell available offline.
 *  - Static assets: cache-first (versioned cache, old versions purged on activate)
 *  - /api/*: network-only; the app's own replica handles offline data, so never serve stale API responses
 *  - Navigations: network-first, falling back to the cached shell
 */
var VERSION = 'v3';
var SHELL = ['/', '/index.html', '/style.css', '/build/bundle.js'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open('shell-' + VERSION).then(function (cache) { return cache.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('shell-') === 0 && k !== 'shell-' + VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== 'GET' || url.pathname.indexOf('/api/') === 0) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(function () { return caches.match('/index.html'); }));
    return;
  }
  event.respondWith(caches.match(event.request).then(function (hit) {
    return hit || fetch(event.request).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open('shell-' + VERSION).then(function (cache) { cache.put(event.request, copy); });
      }
      return res;
    });
  }));
});
