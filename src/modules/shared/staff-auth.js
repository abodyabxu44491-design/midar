// تسجيل دخول منسوبي المدرسة (يُستخدم بشكل منفصل للإدارة وللمعلمين)
// قفل الحساب مؤقتًا بعد 5 محاولات خاطئة
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, unauthorized, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { verifyPassword, hashPassword } from "../../core/auth/password.js";
import { createSession, destroySession } from "../../core/auth/sessions.js";
import { logEvent } from "../../core/audit.js";
import { limits } from "../../core/rate-limit.js";

const MAX_FAILS = 5, LOCK_MIN = 15;
const loginSchema = z.object({
  school: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/, "رمز المدرسة غير صحيح"),
  username: z.string().trim().toLowerCase().min(1, "اكتب اسم المستخدم").max(40),
  password: z.string().min(1, "اكتب كلمة المرور").max(200),
});
const label = { admin: "إدارة", teacher: "معلم" };

export function staffAuthRouter(role) {
  const r = Router();

  r.post("/login", limits.login, handle(async (req, res) => {
    const b = parse(loginSchema, req.body);
    const outcome = await transaction({ tenantId: b.school, actor: `${b.username} (${label[role]})`, ip: req.ip }, async (q) => {
      const [tenant] = await q("SELECT id, status FROM tenants WHERE id = $1", [b.school]);
      const [user] = tenant ? await q(
        "SELECT id, full_name, password_hash, is_active, failed_logins, locked_until > now() AS locked FROM users WHERE username = $1 AND role = $2",
        [b.username, role]) : [];
      const ok = await verifyPassword(b.password, user?.password_hash); // يُنفذ دائمًا لمساواة زمن الاستجابة
      if (!tenant || !user || !user.is_active) return { error: "بيانات الدخول غير صحيحة" };
      if (user.locked) return { error: `الحساب مقفل مؤقتًا بسبب محاولات خاطئة. حاول بعد ${LOCK_MIN} دقيقة.` };
      if (!ok) {
        const fails = user.failed_logins + 1;
        const lock = fails >= MAX_FAILS;
        await q(`UPDATE users SET failed_logins = $2::int,
                   locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE NULL END
                 WHERE id = $1`, [user.id, lock ? 0 : fails, lock, LOCK_MIN]);
        await logEvent(q, { tenantId: tenant.id, actor: b.username, action: lock ? "قفل الحساب بعد محاولات خاطئة" : "محاولة دخول فاشلة" });
        return { error: "بيانات الدخول غير صحيحة" };
      }
      if (tenant.status !== "active") return { error: "حساب المدرسة موقوف. تواصل مع إدارة المنصة.", status: 403 };
      await q("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
      await createSession(res, role, { userId: user.id, tenantId: tenant.id, ip: req.ip, userAgent: req.get("user-agent") }, q);
      await logEvent(q, { tenantId: tenant.id, actor: user.full_name, action: "تسجيل دخول" });
      return { ok: true };
    });
    if (outcome.error) throw outcome.status === 403 ? forbidden(outcome.error) : unauthorized(outcome.error);
    res.json({ ok: true });
  }));

  r.post("/logout", handle(async (req, res) => {
    await destroySession(req, res, role);
    res.json({ ok: true });
  }));

  return r;
}

// تغيير كلمة المرور (بعد تسجيل الدخول)
const pwSchema = z.object({ current: z.string().min(1).max(200), next: t.password });
export const changePassword = handle(async (req, res) => {
  const b = parse(pwSchema, req.body);
  const hash = await hashPassword(b.next);
  const done = await transaction({ tenantId: req.tenantId, actor: req.actor, ip: req.ip }, async (q) => {
    const [u] = await q("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!(await verifyPassword(b.current, u.password_hash))) return false;
    await q("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [req.user.id, hash]);
    // إنهاء الجلسات الأخرى
    await q("DELETE FROM sessions WHERE user_id = $1 AND last_seen_at < now() - interval '5 seconds'", [req.user.id]);
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: "تغيير كلمة المرور" });
    return true;
  });
  if (!done) throw unauthorized("كلمة المرور الحالية غير صحيحة");
  res.json({ ok: true });
});
