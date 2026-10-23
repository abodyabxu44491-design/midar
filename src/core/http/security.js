/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import helmet from "helmet";
import { env } from "../../config/env.js";
import { forbidden } from "./errors.js";
import { SEO_SLUGS } from "../seo-pages.js";

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
      imgSrc: ["'self'", "data:", "blob:", ...GA.img],
      // Exam questions: uploaded clips play from memory, and a video link plays inside the question.
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://drive.google.com"],
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

export const INDEXABLE = new Set(["/", "/privacy", "/terms", "/robots.txt", "/sitemap.xml", ...SEO_SLUGS.map((s) => `/${s}`)]);
export function noIndex(req, res, next) {
  if (!((req.method === "GET" || req.method === "HEAD") && INDEXABLE.has(req.path))) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
}

const extraOrigins = [env.PUBLIC_URL, ...String(process.env.ALLOWED_ORIGINS || "").split(",")]
  .map((o) => o && o.trim().replace(/\/$/, "")).filter(Boolean);
export function allowedOrigins(req) {
  const hosts = [req.get("host"), req.hostname, req.get("x-forwarded-host")?.split(",")[0]?.trim()].filter(Boolean);
  return new Set([...hosts.flatMap((h) => [`https://${h}`, `http://${h}`]), ...extraOrigins]);
}

export function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const site = req.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return next(forbidden("مصدر الطلب غير موثوق"));
  if (origin && !allowedOrigins(req).has(origin)) return next(forbidden("مصدر الطلب غير موثوق"));
  if (!req.is("application/json") && req.headers["content-length"] > 0) return next(forbidden("نوع الطلب غير مدعوم"));
  next();
}

export function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
