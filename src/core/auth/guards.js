// حراس الوصول: يتحققون من الجلسة ومن الدور الحقيقي في قاعدة البيانات لكل طلب
import { env } from "../../config/env.js";
import { transaction } from "../db/pool.js";
import { readSession } from "./sessions.js";
import { unauthorized, forbidden, notFound } from "../http/errors.js";

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

// requireStaff("admin") | requireStaff("teacher")
export const requireStaff = (role) => async (req, res, next) => {
  try {
    const s = await readSession(req, role);
    if (!s) throw unauthorized();
    const ctx = await transaction({ tenantId: s.tenant_id }, async (q) => {
      const [tenant] = await q("SELECT id, name, status, max_students, subscription_end, directory_code FROM tenants WHERE id = $1", [s.tenant_id]);
      const [user] = await q(
        "SELECT id, full_name, role, teacher_id, is_active FROM users WHERE id = $1 AND role = $2",
        [s.user_id, role],
      );
      return { tenant, user };
    });
    if (!ctx.user || !ctx.user.is_active || !ctx.tenant) throw unauthorized("انتهت الجلسة، سجّل الدخول مرة أخرى");
    if (ctx.tenant.status !== "active") throw forbidden("حساب المدرسة موقوف. تواصل مع إدارة المنصة.");
    req.tenant = ctx.tenant;
    req.tenantId = ctx.tenant.id;   // كل الاستعلامات بعد هذا تعمل داخل هذه المدرسة فقط
    req.user = ctx.user;
    req.actor = `${ctx.user.full_name} (${role === "admin" ? "إدارة" : "معلم"})`;
    next();
  } catch (e) { next(e); }
};
