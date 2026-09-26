// دخول المالك: اسم مستخدم + كلمة مرور (بصمة scrypt) + رمز تحقق ثنائي اختياري
// قفل بعد 5 محاولات خاطئة خلال 15 دقيقة
import { Router } from "express";
import { env } from "../../config/env.js";
import { transaction } from "../../core/db/pool.js";
import { handle, unauthorized } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { verifyPassword } from "../../core/auth/password.js";
import { safeEqual } from "../../core/auth/codes.js";
import { verifyTotp } from "../../core/auth/totp.js";
import { createSession, destroySession, readSession } from "../../core/auth/sessions.js";
import { logEvent, securityEvent, recentFailures } from "../../core/audit.js";
import { limits } from "../../core/rate-limit.js";

const r = Router();
const schema = z.object({ username: z.string().max(100), password: z.string().max(200), code: z.string().max(10).optional() });

r.get("/config", (req, res) => res.json({ totp: Boolean(env.OWNER_TOTP_SECRET) }));

r.post("/login", limits.login, handle(async (req, res) => {
  const b = parse(schema, req.body);
  const ctx = { actor: "مالك المنصة", ip: req.ip, platform: true };
  // القفل لكل عنوان IP (5 محاولات)، مع سقف أعلى عام يقاوم التخمين الموزّع.
  // لو كان القفل عامًا فقط لاستطاع أي شخص إبقاء المالك خارج لوحته بإرسال 5 محاولات كل 15 دقيقة.
  const ip = req.ip || "unknown";
  const locked = await transaction(ctx, async (q) =>
    (await recentFailures(q, "owner_login_failed", `owner:${ip}`, 15)) >= 5
    || (await recentFailures(q, "owner_login_failed", "owner", 15)) >= 40);
  if (locked) throw unauthorized("تم قفل الدخول مؤقتًا بسبب محاولات خاطئة. حاول بعد 15 دقيقة.");

  const passOk = await verifyPassword(b.password, env.OWNER_PASSWORD_HASH);
  const userOk = safeEqual(b.username, env.OWNER_USERNAME);
  const codeOk = !env.OWNER_TOTP_SECRET || verifyTotp(env.OWNER_TOTP_SECRET, b.code);

  if (!(passOk && userOk && codeOk)) {
    await transaction(ctx, async (q) => {
      await securityEvent(q, { kind: "owner_login_failed", subject: `owner:${ip}`, ip: req.ip });
      await securityEvent(q, { kind: "owner_login_failed", subject: "owner", ip: req.ip });
      await logEvent(q, { actor: "مجهول", action: "محاولة دخول فاشلة للوحة المالك" });
    });
    throw unauthorized("بيانات الدخول غير صحيحة");   // رسالة واحدة: لا نكشف أن كلمة المرور صحيحة وأن الرمز وحده الخاطئ
  }
  await transaction(ctx, async (q) => {
    await createSession(res, "owner", { ip: req.ip, userAgent: req.get("user-agent") }, q);
    await logEvent(q, { actor: "مالك المنصة", action: "تسجيل دخول" });
  });
  res.json({ ok: true });
}));

r.post("/logout", handle(async (req, res) => {
  await destroySession(req, res, "owner");
  res.json({ ok: true });
}));

r.get("/me", handle(async (req, res) => {
  if (!(await readSession(req, "owner"))) throw unauthorized();
  res.json({ ok: true });
}));

export default r;
