// حراس الوصول: يتحققون من الجلسة ومن الدور الحقيقي في قاعدة البيانات لكل طلب
import { env } from "../../config/env.js";
import { transaction } from "../db/pool.js";
import { readSession } from "./sessions.js";
import { AppError, unauthorized, forbidden, notFound } from "../http/errors.js";
import { getModules } from "../../modules/shared/modules.service.js";

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

export const requireStaff = (role) => async (req, res, next) => {
  try {
    const s = await readSession(req, role);
    if (!s) throw unauthorized();
    const ctx = await transaction({ tenantId: s.tenant_id }, async (q) => {
      const [tenant] = await q("SELECT id, name, status, max_students, subscription_end, directory_code, currency FROM tenants WHERE id = $1", [s.tenant_id]);
      const [user] = await q(
        `SELECT id, full_name, role, teacher_id, is_active, must_change_password,
                can_approve_finance, can_manage_payroll, can_manage_accounts
           FROM users WHERE id = $1 AND role = $2`,
        [s.user_id, role],
      );
      return { tenant, user, modules: await getModules(q) };
    });
    if (!ctx.user || !ctx.user.is_active || !ctx.tenant) throw unauthorized("انتهت الجلسة، سجّل الدخول مرة أخرى");
    if (ctx.tenant.status !== "active") throw forbidden("حساب المدرسة موقوف. تواصل مع إدارة المنصة.");
    req.tenant = ctx.tenant;
    req.tenantId = ctx.tenant.id;   // كل الاستعلامات بعد هذا تعمل داخل هذه المدرسة فقط
    req.user = ctx.user;
    req.modules = ctx.modules;          // الأقسام المفعّلة في هذه المدرسة
    // كلمة مرور مؤقتة: لا يعمل شيء قبل تغييرها (عدا قراءة /me وتغيير كلمة المرور نفسه)
    if (ctx.user.must_change_password && forcePasswordChange() && !passwordGateOpen(req)) {
      throw new AppError(403, "يجب تغيير كلمة المرور المؤقتة أولًا قبل المتابعة", "password_change_required");
    }
    const label = { admin: "إدارة", teacher: "معلم", accountant: "محاسب" }[role];
    req.actor = `${ctx.user.full_name} (${label})`;
    next();
  } catch (e) { next(e); }
};
