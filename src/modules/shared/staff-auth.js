/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { AppError, handle, unauthorized, forbidden, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { verifyPassword, hashPassword, canonPassword } from "../../core/auth/password.js";
import { createSession, destroySession, currentSessionHash } from "../../core/auth/sessions.js";
import { logEvent, securityEvent, recentFailures, raiseAlert } from "../../core/audit.js";
import { limits } from "../../core/rate-limit.js";
import { env } from "../../config/env.js";
import { selfSetupLink } from "./school-files.service.js";

const MAX_FAILS = 5, MAX_FAILS_ACCOUNT = 30, LOCK_MIN = 5;
const FAIL_IP = "staff_login_failed", FAIL_ACCOUNT = "staff_login_failed_all";
const loginSchema = z.object({
  school: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/, "رمز المدرسة غير صحيح"),
  username: z.string().trim().toLowerCase().min(1, "اكتب رقم الجوال أو اسم المستخدم").max(40),
  password: z.string().min(1, "اكتب كلمة المرور").max(200),
  remember: z.boolean().optional().default(true),
});
async function unlockIn(q, user, ipKey, acctKey) {
  const at = async (kind, subject, n) => (await q(
    `SELECT created_at + make_interval(mins => $3) AS until FROM security_events WHERE kind = $1 AND subject = $2
       AND created_at > now() - make_interval(mins => $3) ORDER BY created_at DESC OFFSET $4 LIMIT 1`,
    [kind, subject, LOCK_MIN, n - 1]))[0]?.until;
  const times = [await at(FAIL_IP, ipKey, MAX_FAILS), await at(FAIL_ACCOUNT, acctKey, MAX_FAILS_ACCOUNT)].filter(Boolean).map((d) => new Date(d).getTime());
  if (user?.locked && user.locked_until) times.push(new Date(user.locked_until).getTime());
  const until = times.length ? Math.max(...times) : Date.now() + LOCK_MIN * 60_000;
  return Math.max(1, Math.ceil((until - Date.now()) / 1000));
}
const locked = (seconds) => ({ locked: true, retry_after: seconds,
  error: "تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة متكررة." });

const label = { admin: "إدارة", teacher: "معلم", accountant: "محاسب" };

export const staffLoginRouter = () => {
  const r = Router();
  r.post("/login", limits.staffLoginNet, limits.staffLogin, handle(async (req, res) => {
    const b = parse(loginSchema, req.body);
    const outcome = await transaction({ tenantId: b.school, actor: b.username, ip: req.ip }, async (q) => {
      const denied = { error: "بيانات الدخول غير صحيحة" };
      const [tenant] = await q("SELECT id, status, emergency_locked_at FROM tenants WHERE id = $1", [b.school]);
      const [user] = tenant ? await q(
        `SELECT id, full_name, role, password_hash, is_active, must_change_password, locked_until, locked_until > now() AS locked,
                role = 'admin' AND id = (SELECT min(id) FROM users WHERE role = 'admin') AS primary_admin
           FROM users WHERE username = $1`, [b.username]) : [];
      const ok = await verifyPassword(b.password, user?.password_hash, { temporary: Boolean(user?.must_change_password) });
      if (!tenant) return denied;

      const ipKey = `${tenant.id}:${b.username}:${req.ip || "unknown"}`;
      const acctKey = `${tenant.id}:${b.username}`;
      const ipFails = await recentFailures(q, FAIL_IP, ipKey, LOCK_MIN);
      const acctFails = await recentFailures(q, FAIL_ACCOUNT, acctKey, LOCK_MIN);
      if (user?.locked || ipFails >= MAX_FAILS || acctFails >= MAX_FAILS_ACCOUNT) {
        return locked(await unlockIn(q, user, ipKey, acctKey));
      }

      if (!user || !user.is_active || !ok) {
        await securityEvent(q, { kind: FAIL_IP, subject: ipKey, tenantId: tenant.id, ip: req.ip });
        await securityEvent(q, { kind: FAIL_ACCOUNT, subject: acctKey, tenantId: tenant.id, ip: req.ip });
        if (user) {
          await logEvent(q, { tenantId: tenant.id, actor: b.username,
            action: ipFails + 1 >= MAX_FAILS ? "قفل الدخول من عنوان بعد محاولات خاطئة" : "محاولة دخول فاشلة" });
        }
        if (ipFails + 1 >= MAX_FAILS) {
          await raiseAlert(q, { kind: "staff_login_locked", severity: "medium", tenantId: tenant.id,
            title: "قفل دخول حساب بعد محاولات خاطئة متكررة", detail: `اسم المستخدم «${b.username}» — العنوان ${req.ip || "غير معروف"}` });
          return locked(await unlockIn(q, user, ipKey, acctKey));
        }
        return denied;
      }
      if (tenant.status !== "active") return { error: "حساب المدرسة موقوف. تواصل مع إدارة المنصة.", status: 403 };
      if (tenant.emergency_locked_at) return { error: "الدخول للمدرسة موقوف مؤقتًا من إدارة المنصة. تواصل معها.", status: 403 };
      await q("DELETE FROM security_events WHERE kind = $1 AND subject = $2", [FAIL_IP, ipKey]);
      // The school's manager signs in with a Midar account (email, Google or Apple), not a username.
      // A school not linked to an account yet: these credentials open account creation, once.
      if (user.primary_admin && !env.ADMIN_LEGACY_LOGIN) {
        await logEvent(q, { tenantId: tenant.id, actor: user.full_name, action: "تحقق المدير ببياناته السابقة (الانتقال إلى حساب مدار)" });
        return { manager: { tenantId: tenant.id, userId: user.id } };
      }
      await q("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
      if (user.role === "admin") await q("UPDATE tenants SET activated_at = now() WHERE id = $1 AND activated_at IS NULL", [tenant.id]);
      await createSession(res, user.role, { userId: user.id, tenantId: tenant.id, ip: req.ip, userAgent: req.get("user-agent"), remember: b.remember }, q);
      await logEvent(q, { tenantId: tenant.id, actor: user.full_name, action: `تسجيل دخول (${label[user.role] || "موظف"})${b.remember ? " - تذكرني" : ""}` });
      return { role: user.role, name: user.full_name };
    });
    if (outcome.manager) {
      const setup = await selfSetupLink(outcome.manager.tenantId, outcome.manager.userId, req.ip);
      if (!setup) throw new AppError(403, "يدخل مدير المدرسة بحساب مدار: البريد الإلكتروني أو Google أو Apple. اختر «الإدارة» في صفحة الدخول.", "use_account");
      return res.json({ role: "admin", setup: setup.url });
    }
    if (outcome.locked) throw new AppError(429, outcome.error, "locked", { retry_after: outcome.retry_after });
    if (outcome.code) throw new AppError(403, outcome.error, outcome.code);
    if (outcome.error) throw outcome.status === 403 ? forbidden(outcome.error) : unauthorized(outcome.error);
    res.json({ role: outcome.role, name: outcome.name });
  }));

  // Whether this school's manager already has a Midar account (decides what the manager tab asks for).
  r.get("/manager", limits.site, handle(async (req, res) => {
    const school = parse(loginSchema.shape.school, req.query.school);
    const [row] = await transaction({ platform: true, actor: "زائر", ip: req.ip }, (q) => q(
      "SELECT EXISTS (SELECT 1 FROM account_schools WHERE tenant_id = $1 AND revoked_at IS NULL) AS linked", [school]));
    res.json({ account: Boolean(row?.linked) || env.ADMIN_LEGACY_LOGIN });
  }));

  return r;
};

export function logoutRouter(role) {
  const r = Router();
  r.post("/logout", handle(async (req, res) => {
    await destroySession(req, res, role);
    res.json({ ok: true });
  }));
  return r;
}

const pwSchema = z.object({ current: z.string().min(1).max(200), next: t.password });
export const changePassword = handle(async (req, res) => {
  const b = parse(pwSchema, req.body);
  if (canonPassword(b.next) === canonPassword(b.current)) throw badRequest("اختر كلمة مرور مختلفة عن الحالية");
  const hash = await hashPassword(b.next);
  const keep = currentSessionHash(req, req.user.role);
  const done = await transaction({ tenantId: req.tenantId, actor: req.actor, ip: req.ip }, async (q) => {
    const [u] = await q("SELECT password_hash, must_change_password FROM users WHERE id = $1", [req.user.id]);
    if (!(await verifyPassword(b.current, u.password_hash, { temporary: u.must_change_password }))) return false;
    await q("UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1", [req.user.id, hash]);
    await q("DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)", [req.user.id, keep]);
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: "تغيير كلمة المرور" });
    return true;
  });
  if (!done) throw unauthorized("كلمة المرور الحالية غير صحيحة");
  res.json({ ok: true });
});
