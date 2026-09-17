// نقطة الدخول على Firebase (Cloud Functions الجيل الثاني)
// Firebase Hosting يوجّه كل الطلبات إلى الدالة "app"، والتي تشغّل نفس تطبيق Express.
// برمجة وتطوير: المبرمج عبدالله السكني
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";

// الأسرار محفوظة في Google Secret Manager (لا تُكتب في الكود ولا في Git)
const secrets = [
  defineSecret("DATABASE_URL"),
  defineSecret("OWNER_PATH"),            // رابط لوحة المالك السري
  defineSecret("OWNER_PASSWORD_HASH"),
  defineSecret("OWNER_TOTP_SECRET"),
];

const REGION = process.env.MIDAR_REGION || "me-central2";   // الدمام
const options = {
  region: REGION,
  secrets,
  memory: "512MiB",
  timeoutSeconds: 60,
  concurrency: 40,
  minInstances: 0,
  maxInstances: 10,        // حد أعلى للتكلفة
};

// التحميل عند أول طلب فقط (حتى لا يحتاج النشر إلى الأسرار)
let appPromise;
const getApp = () => (appPromise ??= import("./app.js").then((m) => m.createApp()));

export const app = onRequest(options, async (req, res) => {
  (await getApp())(req, res);
});

// تنظيف الجلسات المنتهية كل ساعة
export const purgeSessions = onSchedule({ schedule: "every 60 minutes", region: REGION, secrets, timeZone: "Asia/Riyadh" }, async () => {
  const { purgeExpiredSessions } = await import("./core/auth/sessions.js");
  await purgeExpiredSessions();
});
