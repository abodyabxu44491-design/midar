// حراس الوصول: يتحققون من الجلسة ومن الدور الحقيقي في قاعدة البيانات لكل طلب
import { env } from "../../config/env.js";
import { transaction } from "../db/pool.js";
import { readSession, sessionRow, sessionHashOf } from "./sessions.js";
import { AppError, unauthorized, forbidden, notFound } from "../http/errors.js";
import { getModules, effectiveModules } from "../../modules/shared/modules.service.js";
import { accessOf, entitlements, LOCK_MESSAGE } from "../../modules/shared/subscription.service.js";

export function ownerIpAllowed(req) {
  if (!env.ownerIps.length) return true;
  return env.ownerIps.includes(String(req.ip || "").replace(/^::ffff:/, ""));
}

// يمنع حتى معرفة وجود لوحة المالك من عنوان غير مسموح
export const ownerNetwork = (req, res, next) => (ownerIpAllowed(req) ? next() : next(notFound()));

export async function requireOwner(req, res, next) {
  try {
    if (!(await readSession(req, "owner"))) throw unauthorized();
    req.actor = "مالك المنصة";
    next();
  } catch (e) { next(e); }
}

// requireStaff("admin") | requireStaff("teacher") | requireStaff("accountant")
/**
 * صلاحيات المالية: مدير المدرسة أو المحاسب.
 * يُجرَّب كلا النوعين من الجلسات حتى تفتح نفس الصفحات لكليهما.
 */
export const requireFinanceUser = async (req, res, next) => {
  for (const role of ["admin", "accountant"]) {
    const done = await new Promise((resolve) => {
      requireStaff(role)(req, res, (err) => resolve(!err));
    });
    if (done) return next();
  }
  next(unauthorized());
};

// صلاحية دقيقة داخل المالية (اعتماد، رواتب)
/**
 * قسم موقوف = غير موجود: يرفضه الخادم بـ 404 حتى لا يُفتح برابط مباشر.
 */
export const requireModule = (...names) => (req, res, next) =>
  (names.every((n) => req.modules?.[n]) ? next() : next(notFound("هذا القسم غير مفعّل في هذه المدرسة")));

export const requirePermission = (flag, message) => (req, res, next) =>
  (req.user?.[flag] ? next() : next(forbidden(message)));

// الإلزام مفعّل دائمًا في الإنتاج. في بيئة الاختبار يُطفأ افتراضيًا (الاختبارات تنشئ حسابات مؤقتة وتستعملها فورًا)
// ويُفعَّل صراحة باختبار مخصص عبر FORCE_PASSWORD_CHANGE=true
const forcePasswordChange = () => {
  const v = process.env.FORCE_PASSWORD_CHANGE;
  return v ? v === "true" : process.env.NODE_ENV !== "test";
};
const passwordGateOpen = (req) =>
  (req.method === "GET" && req.path === "/me") || (req.method === "POST" && req.path === "/password");

// ما يبقى متاحًا عند توقف الاشتراك: /me وتغيير كلمة المرور لكل الأدوار، وصفحة الاشتراك وطلباته للمدير
const subscriptionGateOpen = (req, role) => (req.method === "GET" && req.path === "/me") || (req.method === "POST" && req.path === "/password")
  || (role === "admin" && (req.path.startsWith("/subscription") || req.path.startsWith("/settings/subscription")));

export const requireStaff = (role) => async (req, res, next) => {
  try {
    // معاملة واحدة: الجلسة، ثم سياق المدرسة، ثم المدرسة والمستخدم والاشتراك والأقسام في استعلام واحد
    const hash = sessionHashOf(req, role);
    if (!hash) throw unauthorized();
    const ctx = await transaction({ sessionHash: hash }, async (q, client) => {
      const s = await sessionRow(q, hash, role);
      if (!s) return null;
      // سياق المدرسة (RLS) ثم كل ما يحتاجه الحارس في رحلة واحدة
      const [, res] = await client.query(`SELECT set_config('app.tenant_id', ${client.escapeLiteral(s.tenant_id)}, true);
        SELECT (SELECT row_to_json(t) FROM (SELECT id, name, status, max_students, subscription_end, directory_code, currency
                  FROM tenants WHERE id = app_tenant()) t) AS tenant,
               (SELECT row_to_json(u) FROM (SELECT id, full_name, role, teacher_id, is_active, must_change_password,
                  can_approve_finance, can_manage_payroll, can_manage_accounts FROM users
                  WHERE id = ${Number(s.user_id)} AND role = ${client.escapeLiteral(role)}) u) AS "user",
               (SELECT row_to_json(x) FROM (SELECT sb.*, (SELECT trial_grace_days FROM platform_settings WHERE id) AS trial_grace
                  FROM tenants t JOIN subscriptions sb ON sb.id = t.subscription_id WHERE t.id = app_tenant()) x) AS sub,
               (SELECT row_to_json(m) FROM school_modules m WHERE m.tenant_id = app_tenant()) AS modules`);
      const row = res.rows[0];
      const toggles = row.modules || await getModules(q);   // صف الأقسام يُنشأ مرة واحدة فقط
      const sub = row.sub ? { ...row.sub, starts_on: row.sub.starts_on, ends_on: row.sub.ends_on } : null;
      const access = { sub, access: accessOf(sub, sub?.trial_grace || 0), entitled: entitlements(sub) };
      return { tenant: row.tenant, user: row.user, modules: effectiveModules(toggles, access.entitled), ...access };
    });
    if (!ctx) throw unauthorized();
    if (!ctx.user || !ctx.user.is_active || !ctx.tenant) throw unauthorized("انتهت الجلسة، سجّل الدخول مرة أخرى");
    if (ctx.tenant.status !== "active") throw forbidden("حساب المدرسة موقوف. تواصل مع إدارة المنصة.");
    req.tenant = ctx.tenant;
    req.tenantId = ctx.tenant.id;   // كل الاستعلامات بعد هذا تعمل داخل هذه المدرسة فقط
    req.user = ctx.user;
    req.modules = ctx.modules;          // الأقسام المفعّلة في هذه المدرسة (ومشمولة في اشتراكها)
    req.access = ctx.access;            // حالة الاشتراك: تجربة، فعّال، سماح، مقفل
    req.subscription = ctx.sub;
    req.entitled = ctx.entitled;
    // اشتراك غير فعّال: البيانات محفوظة، لكن الوصول يتوقف. المدير يصل لصفحة الاشتراك فقط ليجدد،
    // والمعلم والمحاسب يرون رسالة فقط. التحقق هنا في الخادم وليس بإخفاء الواجهة.
    if (ctx.access.locked && !subscriptionGateOpen(req, role)) {
      throw new AppError(role === "admin" ? 402 : 403, LOCK_MESSAGE[ctx.access.status] || LOCK_MESSAGE.ended, "subscription_inactive");
    }
    // كلمة مرور مؤقتة: لا يعمل شيء قبل تغييرها (عدا قراءة /me وتغيير كلمة المرور نفسه)
    if (ctx.user.must_change_password && forcePasswordChange() && !passwordGateOpen(req)) {
      throw new AppError(403, "يجب تغيير كلمة المرور المؤقتة أولًا قبل المتابعة", "password_change_required");
    }
    const label = { admin: "إدارة", teacher: "معلم", accountant: "محاسب" }[role];
    req.actor = `${ctx.user.full_name} (${label})`;
    next();
  } catch (e) { next(e); }
};
