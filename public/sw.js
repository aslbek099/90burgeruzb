// Oddiy service worker: faqat o'rnatish uchun. Keshlamaydi, shuning uchun buyurtmalar doim jonli.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => { e.respondWith(fetch(e.request)); });
