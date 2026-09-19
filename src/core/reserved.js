// رموز محجوزة لمسارات النظام: لا تُستخدم كرمز مدرسة ولا تُعامل كرابط مدرسة
export const RESERVED_CODES = new Set([
  "api", "brand", "shared", "assets", "static", "public", "healthz", "favicon", "robots", "sitemap",
  "admin", "teacher", "accountant", "owner", "staff", "idara", "student", "school-page", "staff-page", "s",
  "control", "www", "app", "login", "logout", "signin", "signup",
]);
export const isSchoolCode = (v) => /^[a-z0-9][a-z0-9-]{2,29}$/.test(String(v || "").toLowerCase()) && !RESERVED_CODES.has(String(v).toLowerCase());
