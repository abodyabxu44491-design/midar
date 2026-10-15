/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
//
const VERSION = "__APP_VERSION__";
const CACHE = `midar-${VERSION}`;
const PREFIX = `/v/${VERSION}/`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "midar:version", version: VERSION });
  })());
});

async function cleanup() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("midar-") && k !== CACHE).map((k) => caches.delete(k)));
}

// Pages that open without internet once visited: the staff app and the gate phone (it scans offline).
const APP_PAGE = /^\/[a-z0-9][a-z0-9-]{1,29}\/(idara|gate)\/?$/;
const pageKey = (url) => `${url.origin}${url.pathname.replace(/\/$/, "")}`;

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
  if (url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
  }
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data?.text() || "مدار" }; }
  const urgent = d.priority === 1 || Boolean(d.urgent);
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "مدار", {
      body: d.body || "", tag: d.tag || undefined, renotify: Boolean(d.tag), lang: "ar", dir: "rtl",
      icon: "/brand/icon-192.png", badge: "/brand/favicon-32.png", data: { url: d.url || "/", nid: d.nid || null },
      requireInteraction: urgent, vibrate: urgent ? [200, 100, 200, 100, 200] : [150], timestamp: Date.now(),
    }),
    d.badge > 0 && self.navigator.setAppBadge ? self.navigator.setAppBadge(d.badge).catch(() => {}) : null,
  ]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", location.origin);
  if (target.origin !== location.origin) return;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = wins.find((w) => new URL(w.url).pathname === target.pathname);
    if (same) { await same.focus(); same.postMessage({ type: "midar:notification", url: target.href }); return; }
    await self.clients.openWindow(target.href);
  })());
});
