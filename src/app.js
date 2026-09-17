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
import { healthCheck } from "./core/db/pool.js";
import ownerApi from "./modules/owner/index.js";
import adminApi from "./modules/school-admin/index.js";
import teacherApi from "./modules/teacher/index.js";
import publicApi from "./modules/public/index.js";

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
  app.get("/api/site", (req, res) => res.set("Cache-Control", "public, max-age=300").json({ analytics: env.FIREBASE_ANALYTICS }));
  const api = express.Router();
  api.use(limits.api, noStore, express.json({ limit: "512kb" }), cookieParser(), sameOrigin);
  api.use("/owner", ownerApi);
  api.use("/admin", adminApi);
  api.use("/teacher", teacherApi);
  api.use("/public", publicApi);
  api.use((req, res, next) => next(notFound("المسار غير موجود")));
  app.use("/api", api);

  /* ---------- الملفات الثابتة ---------- */
  const assets = { maxAge: env.isProd ? "7d" : 0, index: false, fallthrough: true };
  app.use("/brand", express.static(path.join(WEB, "brand"), assets));
  app.use("/shared", express.static(path.join(WEB, "shared"), assets));
  app.get("/favicon.ico", (req, res) => res.sendFile(path.join(WEB, "brand", "favicon.ico")));

  /* ---------- الصفحات (كل دور في مجلد منفصل) ---------- */
  const page = (dir) => express.static(path.join(pages, dir), { index: "index.html", redirect: true, maxAge: 0 });
  app.use(env.OWNER_PATH, ownerNetwork, page("owner"));       // لوحة المالك على الرابط السري فقط
  app.use("/admin", page("admin"));                            // إدارة المدرسة
  app.use("/teacher", page("teacher"));                        // بوابة المعلم
  app.use("/school-page", page("school"));                     // ملفات صفحة الطلاب
  app.get("/s/:school", (req, res) => res.sendFile(path.join(pages, "school", "index.html")));
  app.get("/s/:school/student", (req, res) => res.sendFile(path.join(pages, "school", "student.html")));
  app.use("/", page("home"));

  app.use((req, res) => res.status(404).sendFile(path.join(pages, "404.html")));
  app.use(errorHandler);
  return app;
}
