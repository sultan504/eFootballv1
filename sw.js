// Service worker — caches the static app shell so the site opens instantly and
// still loads (with the last data it saw) on a weak connection.
// Live data (Supabase) and the Supabase CDN bundle are NEVER cached.
// Strategy: network-first for our own files (so a new deploy shows up right
// away), falling back to the cache only when offline.
const CACHE_NAME = 'efootball-shell-v4';
const SHELL_FILES = [
  './', 'index.html', 'css/style.css',
  'js/main.js', 'js/config.js', 'js/theme.js', 'js/theme-init.js',
  'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  // Cache each file separately so one missing file can't break the install.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('index.html')))
  );
});
