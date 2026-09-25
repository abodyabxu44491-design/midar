// عامل الخدمة: يجعل مدار تُثبَّت كتطبيق ويسرّع فتحها
// قاعدة صارمة: لا تُخزَّن أي بيانات طلاب أو استجابات من /api إطلاقًا.
const VERSION = "midar-v1";
const SHELL = [
  "/shared/css/app.css", "/shared/css/fonts.css",
  "/shared/js/dom.js", "/shared/js/api.js", "/shared/js/ui.js", "/shared/js/format.js",
  "/brand/logo.svg", "/brand/logo-light.svg", "/brand/favicon.svg", "/brand/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const cacheable = e.request.method === "GET" && url.origin === location.origin
    && !url.pathname.startsWith("/api/")
    && (url.pathname.startsWith("/shared/") || url.pathname.startsWith("/brand/"));
  if (!cacheable) return;                       // كل شيء آخر يذهب للشبكة مباشرة
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => hit)),
  );
});
