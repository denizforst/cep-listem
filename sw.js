const CACHE_NAME = 'cep-listem-shell-v10';
const APP_FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './logo-default.png', './app-icon-192.png', './app-icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES.map((file) => new Request(new URL(`${file}?v=${CACHE_NAME}`, self.location), { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('cep-listem-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || new Response('Offline: app file is not cached.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
});
