// Service worker del equipo Thowinsson: la app abre rápido y, sin conexión, muestra su última versión.
// Nunca guarda respuestas de la API: los datos personales siempre vienen del servidor.
const VERSION = 'v1';
const SHELL = `thw-shell-${VERSION}`;
const ASSETS = `thw-assets-${VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/favicon.svg', '/brand/icon-192.png', '/brand/john-hero.webp', '/brand/john-face.webp'];
const MAX_ASSETS = 160;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('thw-') && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim() {
  const cache = await caches.open(ASSETS);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas: primero la red (siempre la versión publicada); sin conexión, la última guardada.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Archivos con huella (/assets/…): no cambian nunca, se sirven desde la caché.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)).then(trim); }
        return res;
      })),
    );
    return;
  }

  // Marca e íconos: la copia guardada al instante y se actualiza en segundo plano.
  if (url.pathname.startsWith('/brand/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.open(SHELL).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit || Response.error());
        return hit || net;
      })),
    );
  }
});
