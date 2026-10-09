// بناء التطبيق: الحماية، الواجهات البرمجية، والصفحات
// برمجة وتطوير: المبرمج عبدالله السكني
import express from "express";
import compression from "compression";
import { staticRoutes, sendPage, renderPage, serviceWorker } from "./core/web.js";
import { ownerManifest, schoolManifest, withManifest, appKind } from "./core/manifest.js";
import { APP_VERSION, APP_RELEASE, BUILD_HASH, STARTED_AT } from "./core/version.js";
import { perfMiddleware } from "./core/perf.js";
import { siteData } from "./modules/shared/plans-public.service.js";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { securityHeaders, noIndex, sameOrigin, noStore, INDEXABLE } from "./core/http/security.js";
import { errorHandler, notFound } from "./core/http/errors.js";
import { limits } from "./core/rate-limit.js";
import { ownerNetwork } from "./core/auth/guards.js";
import { healthCheck, transaction } from "./core/db/pool.js";
import { handle } from "./core/http/errors.js";
import { isSchoolCode } from "./core/reserved.js";
import { baseUrl } from "./core/links.js";
import { SEO_PAGES, renderSeoPage, homeLd, ldScripts } from "./core/seo-pages.js";
import ownerApi from "./modules/owner/index.js";
import adminApi from "./modules/school-admin/index.js";
import teacherApi from "./modules/teacher/index.js";
import accountantApi from "./modules/accountant/index.js";
import publicApi from "./modules/public/index.js";
import gateApi from "./modules/gate/index.js";
import { staffLoginRouter } from "./modules/shared/staff-auth.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const pages = path.join(WEB, "pages");

export function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(perfMiddleware, securityHeaders, noIndex);
  // ضغط كل الاستجابات النصية (JSON وJS وCSS وHTML): 5–10 أضعاف أصغر على الجوال
  app.use(compression({ threshold: 1024 }));
  // نطاق واحد لمحركات البحث: الصفحات العامة على أي نطاق آخر (مثل midar.onrender.com) تُحوَّل بشكل دائم إلى PUBLIC_URL،
  // فلا يرى جوجل نسختين من نفس الصفحة. صفحات المدارس واللوحات لا تُحوَّل حتى لا تنقطع جلسات أو روابط قديمة.
  const canonical = env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : null;
  app.use((req, res, next) => {
    if (!canonical || !(req.method === "GET" || req.method === "HEAD") || !INDEXABLE.has(req.path)) return next();
    const host = req.hostname;
    if (host === canonical.hostname || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return next();
    res.redirect(301, `${canonical.origin}${req.originalUrl}`);
  });

  // فحص سريع للمراقبة وإيقاظ الخادم (لا يلمس قاعدة البيانات حتى لا تُستهلك ساعات حوسبتها)
  app.get("/healthz", (req, res) => res.json({ ok: true }));

  // فحص عميق يشمل قاعدة البيانات
  app.get("/healthz/db", limits.health, async (req, res) => {
    try { await healthCheck(); res.json({ ok: true, db: true }); }
    catch { res.status(503).json({ ok: false, db: false }); }
  });

  /* ---------- الواجهات البرمجية ---------- */
  // رقم الإصدار: تعرضه الواجهة ويقارنه المتصفح لاكتشاف النشر الجديد
  app.get("/api/version", (req, res) => res.set("Cache-Control", "no-store").json({ version: APP_VERSION, release: APP_RELEASE, build: BUILD_HASH, started_at: STARTED_AT }));
  // إعداد التحليلات فقط (صغير وثابت): بدل تنزيل بيانات الصفحة الرسمية كاملة في كل صفحة
  app.get("/api/analytics-config", (req, res) => res.set("Cache-Control", "public, max-age=3600").json({ analytics: env.FIREBASE_ANALYTICS || null }));
  app.get("/api/site", limits.site, handle(async (req, res) => {
    // الصفحة العامة تقرأ الباقات والأسعار والمميزات من قاعدة البيانات (لا نصوص ثابتة في الكود)
    const s = await siteData();
    res.set("Cache-Control", "no-store").json({ analytics: env.FIREBASE_ANALYTICS, ...s });
  }));
  const api = express.Router();
  // حجم الطلب: 512KB لكل شيء، ما عدا رفع مرفقات الحركات المالية (صورة بصيغة base64 حتى ~2.8MB).
  // يجب أن يُحسم الحد هنا لأن المحلل الأول هو الذي يرفض الطلب الكبير قبل أن يصل لأي محلل داخل المسار.
  const smallJson = express.json({ limit: "512kb" });
  const uploadJson = express.json({ limit: "4mb" });
  // وكذلك صور الأسئلة وشعار المدرسة، وحفظ ورقة الاختبار (قد تكون طويلة: حتى 300 سؤال)
  const isUpload = (req) => (req.method === "POST" && (
      /^\/(admin|accountant)\/ledger\/entries\/\d+\/attachments$/.test(req.path)
      || /^\/(admin|teacher)\/papers\/images$/.test(req.path)
      || req.path === "/admin/papers-settings/logo"
      || req.path === "/admin/setup/logo"
      || /^\/admin\/students\/\d+\/photo$/.test(req.path)
      || /^\/admin\/teachers\/\d+\/photo$/.test(req.path)
      || /^\/(admin|teacher)\/papers\/import$/.test(req.path)))
    || (req.method === "PUT" && /^\/(admin|teacher)\/papers\/\d+$/.test(req.path));
  // كل استجابة API تحمل رقم الإصدار: إن اختلف عن إصدار الصفحة المفتوحة تعرف الواجهة أن هناك تحديثًا
  api.use((req, res, next) => { res.set("X-App-Version", APP_VERSION); next(); });
  api.use(limits.api, noStore, (req, res, next) => (isUpload(req) ? uploadJson : smallJson)(req, res, next), cookieParser(), sameOrigin);
  api.use("/owner", ownerApi);
  api.use("/admin", adminApi);
  api.use("/teacher", teacherApi);
  api.use("/accountant", accountantApi);
  api.use("/public", publicApi);
  api.use("/gate", gateApi);                 // أجهزة البوابة الذكية (مصادقة الجهاز لا المستخدم)
  api.use("/staff", staffLoginRouter());     // باب موحّد: يوجّه الحساب إلى لوحته
  api.use((req, res, next) => next(notFound("المسار غير موجود")));
  app.use("/api", api);

  /* ---------- الملفات الثابتة (بإصدار وبدون) ---------- */
  staticRoutes(app, { isProd: env.isProd });
  app.get("/favicon.ico", (req, res) => res.set("Cache-Control", "public, max-age=86400").sendFile(path.join(WEB, "brand", "favicon.ico")));
  // عامل الخدمة من الجذر ليغطي كل الصفحات، ومحتواه يتغير مع كل إصدار
  app.get("/sw.js", serviceWorker());

  /* ---------- الصفحات ----------
     الرابط الرئيسي صفحة فاضية بلا روابط.
     كل مدرسة لها رابطها الخاص:
       /<رمز المدرسة>           صفحة الطلاب وأولياء الأمور
       /<رمز المدرسة>/student   ملف الطالب
       /<رمز المدرسة>/idara     باب المدير والمعلم
     ولوحة المالك على رابط سري فقط.                                   */
  const file = (...p) => path.join(pages, ...p);
  const send = (...p) => sendPage(file(...p), { isProd: env.isProd });   // HTML بلا كاش ويشير للإصدار الحالي

  // ملف التطبيق لكل دور (التثبيت على الجوال يفتح لوحة صاحبه مباشرة)
  app.get(`${env.OWNER_PATH}/app.webmanifest`, ownerNetwork, ownerManifest(env.OWNER_PATH));
  app.use(env.OWNER_PATH, ownerNetwork, express.static(file("owner"), { index: "index.html", redirect: true }));
  app.get("/reset", send("reset", "index.html"));     // صفحة تغيير كلمة المرور بالرابط
  app.get("/reset/", send("reset", "index.html"));
  // الصفحات العامة القابلة للفهرسة: الرئيسية والخصوصية والشروط. روابط المشاركة (og) تحتاج النطاق كاملًا
  const withOrigin = (...p) => (req, res) => res.set("Cache-Control", "no-cache").type("html")
    .send(renderPage(file(...p), { isProd: env.isProd }).replaceAll("__ORIGIN__", baseUrl(req)));
  // الرئيسية: بيانات منظمة (المنظمة والموقع والأسئلة الشائعة) وروابط الصفحات التعريفية، يقرؤها جوجل والواجهة
  const seoLinks = JSON.stringify(SEO_PAGES.map((p) => [p.slug, p.nav])).replace(/</g, "\\u003c");
  app.get("/", handle(async (req, res) => {
    let site = {};
    try { site = await siteData(); } catch { /* بدون بيانات التواصل */ }
    res.set("Cache-Control", "no-cache").type("html").send(renderPage(file("home", "index.html"), { isProd: env.isProd })
      .replaceAll("__ORIGIN__", baseUrl(req))
      .replace("<!--LD-->", `${ldScripts(homeLd(baseUrl(req), site))}\n  <script type="application/json" id="seo-links">${seoLinks}</script>`));
  }));
  // الصفحات التعريفية لمحركات البحث (HTML كامل من الخادم)
  for (const page of SEO_PAGES) {
    app.get(`/${page.slug}`, (req, res) => res.set("Cache-Control", "no-cache").type("html").send(renderSeoPage(page, baseUrl(req))));
  }
  app.get("/privacy", withOrigin("legal", "privacy.html"));
  app.get("/terms", withOrigin("legal", "terms.html"));
  // محركات البحث: الصفحات التسويقية فقط، وكل ما عداها (صفحات المدارس واللوحات) ممنوع
  app.get("/robots.txt", (req, res) => res.set("Cache-Control", "public, max-age=3600").type("text/plain").send([
    "User-agent: *", "Allow: /$", "Allow: /privacy", "Allow: /terms", "Allow: /brand/", "Allow: /v/", "Allow: /shared/",
    "Allow: /home-page/", "Allow: /legal-page/", "Allow: /api/site", ...SEO_PAGES.map((p) => `Allow: /${p.slug}$`),
    "Disallow: /", "", `Sitemap: ${baseUrl(req)}/sitemap.xml`, ""].join("\n")));
  app.get("/sitemap.xml", (req, res) => res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      [["/", "1.0"], ...SEO_PAGES.map((p) => [`/${p.slug}`, "0.8"]), ["/privacy", "0.3"], ["/terms", "0.3"]]
        .map(([u, p]) => `  <url><loc>${baseUrl(req)}${u}</loc><lastmod>${STARTED_AT.slice(0, 10)}</lastmod><priority>${p}</priority></url>`).join("\n")
    }\n</urlset>\n`));
  app.get("/verify/:code", send("verify", "index.html"));
  // رمز بطاقة الحضور إن مُسح بكاميرا جوال عادية: صفحة تشرح أنه للبوابة فقط، بلا أي بيانات
  app.get("/q/:school/:token", send("gate", "card.html"));   // التحقق من الشهادات برمز QR

  const school = (handler) => (req, res, next) =>
    (isSchoolCode(req.params.school) ? handler(req, res) : next());
  // صفحات المدرسة: كل صفحة تشير لتطبيقها. المنسوبون حسب الدور في الرابط (?role=)، والزائر وولي الأمر لصفحة المدرسة
  const appPage = (as, ...p) => (req, res) => res.set("Cache-Control", "no-cache").type("html").send(withManifest(
    renderPage(file(...p), { isProd: env.isProd }), `/${req.params.school.toLowerCase()}/app.webmanifest?as=${as(req)}`));
  const staffAs = (req) => { const r = appKind(String(req.query.role || "")); return r === "parent" || r === "gate" ? "staff" : r; };
  app.get("/:school/app.webmanifest", school(schoolManifest()));
  app.get("/:school", school(appPage(() => "parent", "school", "index.html")));
  app.get("/:school/student", school(appPage(() => "parent", "school", "student.html")));
  app.get("/:school/idara", school(appPage(staffAs, "staff", "index.html")));
  app.get("/:school/gate", school(appPage(() => "gate", "gate", "index.html")));   // تطبيق الحارس (جوال البوابة)

  app.use((req, res) => res.status(404).sendFile(path.join(pages, "404.html")));
  app.use(errorHandler);
  return app;
}
