const CACHE_NAME = "stockradar-cache-v4";
const ASSETS_TO_CACHE = [
    "./",
    "./index.html",
    "./css/style.css",
    "./js/app.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];

// Install Event: Cache all critical app assets
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("Caching app shell assets...");
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// Activate Event: Clear older caches if version changes
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log("Clearing old service worker cache:", cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event: Cache-first strategy for assets, network-only for Google News API / Proxy
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    
    // Ignore codetabs / CORS proxy calls or TradingView script fetches for caching
    // We want real-time dynamic data to always fetch from network
    if (url.href.includes("codetabs") || url.href.includes("tradingview")) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Default Cache First strategy for local assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // Fallback to fetch and cache dynamically (optional, but good for fonts/icons)
            return fetch(event.request).then((networkResponse) => {
                // If it's a valid local request, cache it
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Return offline fallback if network fails
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
