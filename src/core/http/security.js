// طبقات الحماية العامة لكل الطلبات
import helmet from "helmet";
import { env } from "../../config/env.js";
import { forbidden } from "./errors.js";

// نطاقات Google المطلوبة لتحليلات Firebase (تُضاف فقط إذا فُعّلت)
const GA = env.FIREBASE_ANALYTICS ? {
  script: ["https://www.gstatic.com", "https://www.googletagmanager.com"],
  connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com",
    "https://firebase.googleapis.com", "https://firebaseinstallations.googleapis.com"],
  img: ["https://*.google-analytics.com", "https://*.googletagmanager.com"],
} : { script: [], connect: [], img: [] };

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...GA.script],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:", ...GA.img],
      connectSrc: ["'self'", ...GA.connect],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: env.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: "same-origin" },
});

export function noIndex(req, res, next) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
}

// النطاقات المسموحة: النطاق الذي وصل إليه الطلب فعلًا (req.hostname يقرأ X-Forwarded-Host خلف وكيل موثوق
// مثل Firebase Hosting)، ورابط المنصة، والنطاقات الإضافية، ونطاقا Firebase الافتراضيان للمشروع.
const firebaseProject = (() => {
  try { return process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || null; } catch { return null; }
})();
const extraOrigins = [env.PUBLIC_URL, ...String(process.env.ALLOWED_ORIGINS || "").split(","), ...(firebaseProject
  ? [`https://${firebaseProject}.web.app`, `https://${firebaseProject}.firebaseapp.com`] : [])]
  .map((o) => o && o.trim().replace(/\/$/, "")).filter(Boolean);
export function allowedOrigins(req) {
  const hosts = [req.get("host"), req.hostname, req.get("x-forwarded-host")?.split(",")[0]?.trim()].filter(Boolean);
  return new Set([...hosts.flatMap((h) => [`https://${h}`, `http://${h}`]), ...extraOrigins]);
}

// حماية من الطلبات المزورة (CSRF): أي طلب يغير بيانات يجب أن يأتي من نفس الموقع
export function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const site = req.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return next(forbidden("مصدر الطلب غير موثوق"));
  if (origin && !allowedOrigins(req).has(origin)) return next(forbidden("مصدر الطلب غير موثوق"));
  if (!req.is("application/json") && req.headers["content-length"] > 0) return next(forbidden("نوع الطلب غير مدعوم"));
  next();
}

// منع التخزين المؤقت لأي بيانات خاصة
export function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
