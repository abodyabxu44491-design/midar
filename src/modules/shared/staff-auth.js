// تسجيل دخول منسوبي المدرسة (يُستخدم بشكل منفصل للإدارة وللمعلمين)
// قفل الحساب مؤقتًا بعد 5 محاولات خاطئة
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { AppError, handle, unauthorized, forbidden, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { verifyPassword, hashPassword, canonPassword } from "../../core/auth/password.js";
import { createSession, destroySession, currentSessionHash } from "../../core/auth/sessions.js";
import { logEvent, securityEvent, recentFailures } from "../../core/audit.js";
import { limits } from "../../core/rate-limit.js";

// القفل لكل (حساب + عنوان IP): من يخمّن كلمة المرور من عنوانه لا يحرم صاحب الحساب من الدخول من عنوان آخر.
// وسقف أعلى للحساب كله من كل العناوين لمقاومة التخمين الموزّع.
// القفل: 5 محاولات خاطئة من نفس الجهاز لنفس الحساب ← 5 دقائق (و30 محاولة على الحساب من كل الأجهزة)
const MAX_FAILS = 5, MAX_FAILS_ACCOUNT = 30, LOCK_MIN = 5;
const FAIL_IP = "staff_login_failed", FAIL_ACCOUNT = "staff_login_failed_all";
const loginSchema = z.object({
  school: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/, "رمز المدرسة غير صحيح"),
  username: z.string().trim().toLowerCase().min(1, "اكتب اسم المستخدم").max(40),
  password: z.string().min(1, "اكتب كلمة المرور").max(200),
  remember: z.boolean().optional().default(true),   // البقاء مسجلًا هو الافتراضي (حتى تسجيل الخروج)
});
/**
 * متى يُفتح القفل (بالثواني): القفل «منزلق» على آخر ${LOCK_MIN} دقائق، فينتهي عندما تخرج المحاولة الخاطئة
 * الخامسة (من الأحدث) من النافذة الزمنية. نفس الحساب يعمل سواء وُجد الحساب أو لم يوجد (لا يكشف الأسماء).
 */
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

/**
 * باب واحد لمنسوبي المدرسة: النظام يعرف من الحساب هل هو مدير أو معلم،
 * ويفتح له جلسة من نوعه. الفصل بين الدورين يبقى كما هو في الخلفية.
 */
export const staffLoginRouter = () => {
  const r = Router();
  r.post("/login", limits.staffLoginNet, limits.staffLogin, handle(async (req, res) => {
    const b = parse(loginSchema, req.body);
    const outcome = await transaction({ tenantId: b.school, actor: b.username, ip: req.ip }, async (q) => {
      const denied = { error: "بيانات الدخول غير صحيحة" };
      const [tenant] = await q("SELECT id, status, emergency_locked_at FROM tenants WHERE id = $1", [b.school]);
      const [user] = tenant ? await q(
        "SELECT id, full_name, role, password_hash, is_active, must_change_password, locked_until, locked_until > now() AS locked FROM users WHERE username = $1",
        [b.username]) : [];
      // يُنفَّذ دائمًا لتساوي أزمنة الاستجابة. المؤقتة (من النظام) لا تفرق بين الحروف الكبيرة والصغيرة
      const ok = await verifyPassword(b.password, user?.password_hash, { temporary: Boolean(user?.must_change_password) });
      if (!tenant) return denied;

      const ipKey = `${tenant.id}:${b.username}:${req.ip || "unknown"}`;
      const acctKey = `${tenant.id}:${b.username}`;
      const ipFails = await recentFailures(q, FAIL_IP, ipKey, LOCK_MIN);
      const acctFails = await recentFailures(q, FAIL_ACCOUNT, acctKey, LOCK_MIN);
      // رسالة القفل تظهر بالطريقة نفسها سواء وُجد الحساب أو لم يوجد، فلا تكشف أسماء المستخدمين
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
        // هذه المحاولة أكملت الحد: القفل يبدأ الآن ويظهر العد التنازلي مباشرة
        if (ipFails + 1 >= MAX_FAILS) return locked(await unlockIn(q, user, ipKey, acctKey));
        return denied;
      }
      if (tenant.status !== "active") return { error: "حساب المدرسة موقوف. تواصل مع إدارة المنصة.", status: 403 };
      if (tenant.emergency_locked_at) return { error: "الدخول للمدرسة موقوف مؤقتًا من إدارة المنصة. تواصل معها.", status: 403 };
      await q("DELETE FROM security_events WHERE kind = $1 AND subject = $2", [FAIL_IP, ipKey]);   // نجاح الدخول يصفّر عدّاد هذا العنوان
      await q("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
      await createSession(res, user.role, { userId: user.id, tenantId: tenant.id, ip: req.ip, userAgent: req.get("user-agent"), remember: b.remember }, q);
      await logEvent(q, { tenantId: tenant.id, actor: user.full_name, action: `تسجيل دخول (${label[user.role] || "موظف"})${b.remember ? " - تذكرني" : ""}` });
      return { role: user.role };
    });
    if (outcome.locked) throw new AppError(429, outcome.error, "locked", { retry_after: outcome.retry_after });
    if (outcome.error) throw outcome.status === 403 ? forbidden(outcome.error) : unauthorized(outcome.error);
    res.json({ role: outcome.role });
  }));
  return r;
};

// الخروج فقط: تسجيل الدخول موحّد عبر /api/staff/login
export function logoutRouter(role) {
  const r = Router();
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
  if (canonPassword(b.next) === canonPassword(b.current)) throw badRequest("اختر كلمة مرور مختلفة عن الحالية");
  const hash = await hashPassword(b.next);
  const keep = currentSessionHash(req, req.user.role);
  const done = await transaction({ tenantId: req.tenantId, actor: req.actor, ip: req.ip }, async (q) => {
    const [u] = await q("SELECT password_hash, must_change_password FROM users WHERE id = $1", [req.user.id]);
    // نفس قاعدة الدخول: المؤقتة لا تفرق بين الحروف الكبيرة والصغيرة
    if (!(await verifyPassword(b.current, u.password_hash, { temporary: u.must_change_password }))) return false;
    await q("UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1", [req.user.id, hash]);
    // إنهاء كل الجلسات الأخرى لهذا الحساب (أي جهاز آخر) وإبقاء الجلسة الحالية فقط
    await q("DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)", [req.user.id, keep]);
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: "تغيير كلمة المرور" });
    return true;
  });
  if (!done) throw unauthorized("كلمة المرور الحالية غير صحيحة");
  res.json({ ok: true });
});
