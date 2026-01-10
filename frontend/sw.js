// DocuClean Service Worker - PWA Support
const CACHE_NAME = 'docuclean-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/admin.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[ServiceWorker] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[ServiceWorker] Installation complete');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.log('[ServiceWorker] Cache failed:', error);
            })
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[ServiceWorker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[ServiceWorker] Activation complete');
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests and API calls
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip API requests - always go to network
    if (event.request.url.includes('/api/') ||
        event.request.url.includes('/analytics/') ||
        event.request.url.includes('/clean-pdf') ||
        event.request.url.includes('/remove-watermark')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // Return cached version, but also update cache in background
                    event.waitUntil(
                        fetch(event.request)
                            .then((networkResponse) => {
                                if (networkResponse && networkResponse.status === 200) {
                                    caches.open(CACHE_NAME)
                                        .then((cache) => {
                                            cache.put(event.request, networkResponse.clone());
                                        });
                                }
                            })
                            .catch(() => { })
                    );
                    return cachedResponse;
                }

                // Not in cache, fetch from network
                return fetch(event.request)
                    .then((response) => {
                        // Cache successful responses for static assets
                        if (response && response.status === 200 &&
                            (event.request.url.endsWith('.html') ||
                                event.request.url.endsWith('.css') ||
                                event.request.url.endsWith('.js') ||
                                event.request.url.endsWith('.png') ||
                                event.request.url.endsWith('.jpg') ||
                                event.request.url.endsWith('.svg'))) {
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, response.clone());
                                });
                        }
                        return response;
                    })
                    .catch(() => {
                        // Offline fallback for navigation requests
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
