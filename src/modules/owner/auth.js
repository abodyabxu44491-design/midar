/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env.js";
import { transaction } from "../../core/db/pool.js";
import { handle, unauthorized, badRequest } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { verifyPassword } from "../../core/auth/password.js";
import { safeEqual } from "../../core/auth/codes.js";
import { verifyTotp, newTotpSecret, totpUri } from "../../core/auth/totp.js";
import { sealSecret, openSecret } from "../../core/auth/secret-box.js";
import { createSession, destroySession, readSession } from "../../core/auth/sessions.js";
import { logEvent, securityEvent, recentFailures, raiseAlert } from "../../core/audit.js";
import { limits } from "../../core/rate-limit.js";
import { qrDataUrl } from "../shared/certificates.service.js";
import { ownerTotp, TOTP_AAD } from "../../core/auth/owner-mfa.js";

const r = Router();
const schema = z.object({
  username: z.string().max(100),
  password: z.string().max(200),
  code: z.string().max(10).optional(),
  remember: z.boolean().optional().default(false),
});
const ENROLL_MINUTES = 10;
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const platform = (req) => ({ actor: "مالك المنصة", ip: req.ip, platform: true });

export const ownerMfa = (q) => ownerTotp(q);

const deviceLabel = (ua = "") => {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "جهاز";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح";
  return `${br} على ${os}`;
};

async function openOwnerSession(req, res, q, remember) {
  await createSession(res, "owner", { ip: req.ip, userAgent: req.get("user-agent"), remember }, q);
  await logEvent(q, { actor: "مالك المنصة", action: remember ? "تسجيل دخول (تذكرني)" : "تسجيل دخول" });
  // A browser the owner never used before raises an alert (the owner sees it, and it is emailed if configured).
  const ua = req.get("user-agent") || "";
  const fp = sha(`owner-device:${ua}`);
  const [known] = await q("UPDATE owner_devices SET last_seen_at = now(), ip = $2 WHERE fingerprint = $1 RETURNING 1", [fp, req.ip || null]);
  if (!known) {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM owner_devices");
    await q("INSERT INTO owner_devices (fingerprint, label, ip) VALUES ($1, $2, $3)", [fp, deviceLabel(ua), req.ip || null]);
    if (n > 0) {
      await raiseAlert(q, { kind: `owner_new_device:${fp.slice(0, 12)}`, severity: "high", title: "دخول إلى لوحة المالك من جهاز جديد",
        detail: `${deviceLabel(ua)} — العنوان ${req.ip || "غير معروف"}. إن لم تكن أنت فأنهِ كل الجلسات وغيّر كلمة المرور فورًا.` });
    }
  }
}

r.get("/config", handle(async (req, res) => {
  const mfa = await transaction(platform(req), (q) => ownerTotp(q));
  res.json({ totp: Boolean(mfa), enroll: !mfa });
}));

r.post("/login", limits.login, handle(async (req, res) => {
  const b = parse(schema, req.body);
  const ctx = platform(req);
  const ip = req.ip || "unknown";
  const locked = await transaction(ctx, async (q) =>
    (await recentFailures(q, "owner_login_failed", `owner:${ip}`, 15)) >= 5
    || (await recentFailures(q, "owner_login_failed", "owner", 15)) >= 40);
  if (locked) throw unauthorized("تم قفل الدخول مؤقتًا بسبب محاولات خاطئة. حاول بعد 15 دقيقة.");

  const passOk = await verifyPassword(b.password, env.OWNER_PASSWORD_HASH);
  const userOk = safeEqual(b.username, env.OWNER_USERNAME);
  const mfa = await transaction(ctx, (q) => ownerTotp(q));
  const codeOk = !mfa || verifyTotp(mfa.secret, b.code);

  if (!(passOk && userOk && codeOk)) {
    await transaction(ctx, async (q) => {
      await securityEvent(q, { kind: "owner_login_failed", subject: `owner:${ip}`, ip: req.ip });
      await securityEvent(q, { kind: "owner_login_failed", subject: "owner", ip: req.ip });
      await logEvent(q, { actor: "مجهول", action: "محاولة دخول فاشلة للوحة المالك" });
      if ((await recentFailures(q, "owner_login_failed", "owner", 15)) >= 5) {
        await raiseAlert(q, { kind: "owner_login_failed", severity: "high", title: "محاولات دخول فاشلة متكررة إلى لوحة المالك",
          detail: `آخر محاولة من العنوان ${req.ip || "غير معروف"}. إن لم تكن أنت فغيّر كلمة المرور وفعّل قائمة العناوين المسموحة.` });
      }
    });
    throw unauthorized("بيانات الدخول غير صحيحة");
  }
  if (!mfa) {
    // Correct password but no second factor yet: no session, only a short enrollment step.
    const secret = newTotpSecret();
    const ticket = crypto.randomBytes(32).toString("hex");
    await transaction(ctx, (q) => q(
      `UPDATE owner_security SET pending_enc = $1, pending_hash = $2, pending_expires = now() + make_interval(mins => $3) WHERE id = 1`,
      [sealSecret(secret, TOTP_AAD), sha(ticket), ENROLL_MINUTES]));
    const uri = totpUri(secret);
    return res.status(202).json({ enroll: true, ticket, secret, uri, qr: qrDataUrl(uri), minutes: ENROLL_MINUTES });
  }
  await transaction(ctx, (q) => openOwnerSession(req, res, q, b.remember));
  res.json({ ok: true });
}));

// Finishing enrollment: the code from the authenticator app proves the secret was saved; only then a session opens.
r.post("/enroll", limits.login, handle(async (req, res) => {
  const b = parse(z.object({ ticket: z.string().regex(/^[0-9a-f]{64}$/), code: z.string().max(10), remember: z.boolean().optional().default(false) }), req.body);
  await transaction(platform(req), async (q) => {
    if (await ownerTotp(q)) throw badRequest("التحقق الثنائي مفعّل بالفعل. سجّل الدخول بالرمز.");
    const [row] = await q("SELECT pending_enc FROM owner_security WHERE id = 1 AND pending_hash = $1 AND pending_expires > now() FOR UPDATE", [sha(b.ticket)]);
    const secret = row ? openSecret(row.pending_enc, TOTP_AAD) : null;
    if (!secret) throw unauthorized("انتهت مهلة التفعيل. سجّل الدخول من جديد.");
    if (!verifyTotp(secret, b.code)) throw badRequest("الرمز غير صحيح. تأكد من وقت الجوال وأدخل الرمز الظاهر الآن.");
    await q(`UPDATE owner_security SET totp_enc = pending_enc, enrolled_at = now(), pending_enc = NULL, pending_hash = NULL, pending_expires = NULL
              WHERE id = 1`);
    await logEvent(q, { actor: "مالك المنصة", action: "تفعيل التحقق الثنائي للوحة المالك" });
    await raiseAlert(q, { kind: "owner_mfa_enrolled", severity: "info", title: "فُعّل التحقق الثنائي للوحة المالك",
      detail: `من العنوان ${req.ip || "غير معروف"}` });
    await openOwnerSession(req, res, q, b.remember);
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
