/*
 * Offline-first service worker.
 * Purely local version.
 */
const CACHE = 'energy-v4-offline';

const CORE_ASSETS = [
    './',
    'index.html',
    'data.js',
    'graph.js',
    'app.js',
    'css/styles.css',
    'manifest.json',
    'icon.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .catch(err => console.warn('Cache failed:', err))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                if (response.ok && new URL(event.request.url).origin === self.location.origin) {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
                }
                return response;
            }).catch(() => {
                // Return index.html for navigation requests when offline
                if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
                    return caches.match('index.html');
                }
                return new Response('', { status: 503, statusText: 'Offline' });
            });
        })
    );
});
