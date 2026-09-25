// عامل الخدمة: يسرّع فتح مدار ويجعلها قابلة للتثبيت كتطبيق.
// قاعدة صارمة: لا تُخزَّن أي بيانات طلاب أو استجابات من /api إطلاقًا، ولا صفحات HTML.
//
// الإصدار يُكتب هنا تلقائيًا من الخادم مع كل نشر، فيتغير محتوى الملف ويكتشف المتصفح التحديث،
// ثم يُحذف كاش الإصدار السابق كاملًا. لا حاجة لرفع أي رقم يدويًا.
const VERSION = "__APP_VERSION__";
const CACHE = `midar-${VERSION}`;
const PREFIX = `/v/${VERSION}/`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // إبلاغ الصفحات المفتوحة بأن إصدارًا جديدًا صار فعالًا
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "midar:version", version: VERSION });
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // ملفات الإصدار الحالي: ثابتة لا تتغير أبدًا ← من الكاش مباشرة (فتح فوري بلا شبكة)
  if (url.pathname.startsWith(PREFIX)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // الشعار والأيقونات: من الكاش مع تحديث في الخلفية
  if (url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
  }
  // كل شيء آخر (الصفحات، /api، الإصدارات الأخرى) من الشبكة مباشرة
});
