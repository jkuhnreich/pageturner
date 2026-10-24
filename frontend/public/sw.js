// Service worker מינימלי: מאפשר התקנה למסך הבית.
// לא שומר שום דבר במטמון, כדי שגרסה חדשה של האתר תמיד תיטען מיד.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
