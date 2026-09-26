// عامل الخدمة: يسرّع فتح مدار ويجعلها قابلة للتثبيت كتطبيق.
// قاعدة صارمة: لا تُخزَّن أي بيانات طلاب أو استجابات من /api إطلاقًا (البيانات المحلية في IndexedDB بصلاحيات المستخدم).
// صفحة التطبيق (HTML بلا بيانات) تُحفظ نسخة منها فقط لفتح التطبيق بدون اتصال.
//
// الإصدار يُكتب هنا تلقائيًا من الخادم مع كل نشر، فيتغير محتوى الملف ويكتشف المتصفح التحديث،
// ثم يُحذف كاش الإصدار السابق كاملًا. لا حاجة لرفع أي رقم يدويًا.
const VERSION = "__APP_VERSION__";
const CACHE = `midar-${VERSION}`;
const PREFIX = `/v/${VERSION}/`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // لا نحذف ملفات الإصدار السابق هنا: قد يحتاجها العمل بدون اتصال حتى تُحفظ صفحة الإصدار الجديد.
    // الحذف يتم بعد أول تحميل ناجح لصفحة التطبيق بالإصدار الجديد (انظر cleanup)
    await self.clients.claim();
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "midar:version", version: VERSION });
  })());
});

// صفحة التطبيق بالإصدار الجديد محفوظة الآن: الإصدارات السابقة لم تعد لازمة
async function cleanup() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("midar-") && k !== CACHE).map((k) => caches.delete(k)));
}

// صفحات التطبيق التي تعمل بدون اتصال (قشرة التطبيق فقط، بلا بيانات): دخول المدرسة /<رمز>/idara
const APP_PAGE = /^\/[a-z0-9][a-z0-9-]{1,29}\/idara\/?$/;
const pageKey = (url) => `${url.origin}${url.pathname.replace(/\/$/, "")}`;

// الصفحة تطلب حفظ نسختها (أول زيارة تحدث قبل أن يتحكم عامل الخدمة بالصفحة فلا يراها)
self.addEventListener("message", (e) => {
  if (e.data?.type !== "midar:cache-page") return;
  const url = new URL(e.data.url, location.origin);
  if (url.origin !== location.origin || !APP_PAGE.test(url.pathname)) return;
  e.waitUntil((async () => {
    const res = await fetch(url.href, { credentials: "same-origin", cache: "no-store" });
    if (res.ok) { await (await caches.open(CACHE)).put(pageKey(url), res); await cleanup(); }
  })().catch(() => {}));
});

function offlinePage() {
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>مدار — غير متصل</title><style>body{font-family:system-ui,sans-serif;background:#F3F6F9;color:#16244A;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:20px}
.c{background:#fff;border:1px solid #DDE3EC;border-radius:16px;padding:28px;max-width:420px;text-align:center}h1{font-size:20px}p{line-height:1.8;color:#4A5568}
button{font:inherit;background:#0B7A75;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}</style></head>
<body><div class="c"><h1>لا يوجد اتصال بالإنترنت</h1><p>هذه الصفحة لم تُجهَّز للعمل بدون اتصال على هذا الجهاز بعد.
افتح مدار مرة واحدة وأنت متصل وسجّل الدخول، وبعدها يعمل الحضور والدرجات بدون إنترنت.</p><button onclick="location.reload()">إعادة المحاولة</button></div></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // صفحة التطبيق: من الشبكة دائمًا (أحدث إصدار)، ونسخة محفوظة فقط عند انقطاع الاتصال
  if (req.mode === "navigate" && APP_PAGE.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const c = await caches.open(CACHE);
          await c.put(pageKey(url), res.clone());
          e.waitUntil(cleanup());
        }
        return res;
      } catch {
        return (await caches.match(pageKey(url))) || offlinePage();
      }
    })());
    return;
  }
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
