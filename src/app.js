// بناء التطبيق: الحماية، الواجهات البرمجية، والصفحات
// برمجة وتطوير: المبرمج عبدالله السكني
import express from "express";
import compression from "compression";
import { staticRoutes, sendPage, serviceWorker } from "./core/web.js";
import { APP_VERSION, APP_RELEASE, BUILD_HASH, STARTED_AT } from "./core/version.js";
import { perfMiddleware } from "./core/perf.js";
import { siteData } from "./modules/shared/plans-public.service.js";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { securityHeaders, noIndex, sameOrigin, noStore } from "./core/http/security.js";
import { errorHandler, notFound } from "./core/http/errors.js";
import { limits } from "./core/rate-limit.js";
import { ownerNetwork } from "./core/auth/guards.js";
import { healthCheck, transaction } from "./core/db/pool.js";
import { handle } from "./core/http/errors.js";
import { isSchoolCode } from "./core/reserved.js";
import ownerApi from "./modules/owner/index.js";
import adminApi from "./modules/school-admin/index.js";
import teacherApi from "./modules/teacher/index.js";
import accountantApi from "./modules/accountant/index.js";
import publicApi from "./modules/public/index.js";
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

  app.use(env.OWNER_PATH, ownerNetwork, express.static(file("owner"), { index: "index.html", redirect: true }));
  app.get("/reset", send("reset", "index.html"));     // صفحة تغيير كلمة المرور بالرابط
  app.get("/reset/", send("reset", "index.html"));
  app.get("/", send("home", "index.html"));

  const school = (handler) => (req, res, next) =>
    (isSchoolCode(req.params.school) ? handler(req, res) : next());
  app.get("/:school", school(send("school", "index.html")));
  app.get("/:school/student", school(send("school", "student.html")));
  app.get("/:school/idara", school(send("staff", "index.html")));

  app.use((req, res) => res.status(404).sendFile(path.join(pages, "404.html")));
  app.use(errorHandler);
  return app;
}
