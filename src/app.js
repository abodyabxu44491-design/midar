// بناء التطبيق: الحماية، الواجهات البرمجية، والصفحات
// برمجة وتطوير: المبرمج عبدالله السكني
import express from "express";
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
import publicApi from "./modules/public/index.js";
import { staffLoginRouter } from "./modules/shared/staff-auth.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const pages = path.join(WEB, "pages");

export function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(securityHeaders, noIndex);

  // فحص سريع للمراقبة وإيقاظ الخادم (لا يلمس قاعدة البيانات حتى لا تُستهلك ساعات حوسبتها)
  app.get("/healthz", (req, res) => res.json({ ok: true }));

  // فحص عميق يشمل قاعدة البيانات
  app.get("/healthz/db", async (req, res) => {
    try { await healthCheck(); res.json({ ok: true, db: true }); }
    catch { res.status(503).json({ ok: false, db: false }); }
  });

  /* ---------- الواجهات البرمجية ---------- */
  app.get("/api/site", handle(async (req, res) => {
    const [s] = await transaction({}, (q) => q("SELECT landing_mode, brand_phone, brand_email FROM platform_settings WHERE id"));
    res.set("Cache-Control", "no-store").json({ analytics: env.FIREBASE_ANALYTICS, ...s });
  }));
  const api = express.Router();
  api.use(limits.api, noStore, express.json({ limit: "512kb" }), cookieParser(), sameOrigin);
  api.use("/owner", ownerApi);
  api.use("/admin", adminApi);
  api.use("/teacher", teacherApi);
  api.use("/public", publicApi);
  api.use("/staff", staffLoginRouter());     // باب موحّد: يوجّه الحساب إلى لوحته
  api.use((req, res, next) => next(notFound("المسار غير موجود")));
  app.use("/api", api);

  /* ---------- الملفات الثابتة ---------- */
  const assets = { maxAge: env.isProd ? "7d" : 0, index: false, fallthrough: true };
  app.use("/brand", express.static(path.join(WEB, "brand"), assets));
  app.use("/shared", express.static(path.join(WEB, "shared"), assets));
  app.get("/favicon.ico", (req, res) => res.sendFile(path.join(WEB, "brand", "favicon.ico")));
  // عامل الخدمة يجب أن يُقدَّم من الجذر ليغطي كل الصفحات
  app.get("/sw.js", (req, res) => res.set("Cache-Control", "no-cache").type("application/javascript").sendFile(path.join(WEB, "sw.js")));

  /* ---------- الصفحات ----------
     الرابط الرئيسي صفحة فاضية بلا روابط.
     كل مدرسة لها رابطها الخاص:
       /<رمز المدرسة>           صفحة الطلاب وأولياء الأمور
       /<رمز المدرسة>/student   ملف الطالب
       /<رمز المدرسة>/idara     باب المدير والمعلم
     ولوحة المالك على رابط سري فقط.                                   */
  const file = (...p) => path.join(pages, ...p);
  const send = (...p) => (req, res) => res.sendFile(file(...p));

  app.use(env.OWNER_PATH, ownerNetwork, express.static(file("owner"), { index: "index.html", redirect: true }));
  app.use("/school-page", express.static(file("school"), { index: false }));
  // ملفات لوحتي الإدارة والمعلم تُحمّل من باب المدرسة الموحّد
  app.use("/admin", express.static(file("admin"), { index: false }));
  app.use("/teacher", express.static(file("teacher"), { index: false }));
  app.use("/staff-page", express.static(file("staff"), { index: false }));
  app.use("/home-page", express.static(file("home"), { index: false }));
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
