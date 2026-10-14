/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { SEO_SLUGS } from "./seo-pages.js";

export const RESERVED_CODES = new Set([
  "api", "brand", "shared", "assets", "static", "public", "healthz", "favicon", "robots", "sitemap",
  "admin", "teacher", "accountant", "owner", "staff", "idara", "student", "school-page", "staff-page", "s",
  "control", "www", "app", "login", "logout", "signin", "signup", "verify",
  "privacy", "terms", "subscription-policy", "group", "group-page", "activate", "activate-page", "demo", "legal-page", "gate-page", "q",
  ...SEO_SLUGS,
]);
export const isSchoolCode = (v) => /^[a-z0-9][a-z0-9-]{2,29}$/.test(String(v || "").toLowerCase()) && !RESERVED_CODES.has(String(v).toLowerCase());
