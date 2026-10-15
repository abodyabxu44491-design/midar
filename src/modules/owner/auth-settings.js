/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's settings for managers' sign-in: the SMTP server for account emails, and Google / Apple.
// Secrets are sealed on save and never sent back; the page only learns whether one is stored.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { sealSecret, credentialsEnabled } from "../../core/auth/secret-box.js";
import { logEvent } from "../../core/audit.js";
import { env } from "../../config/env.js";
import { MAIL_AAD, sendMail, codeMail } from "../shared/mail.service.js";
import { PROVIDER_AAD, callbackUrl } from "../account/oauth.service.js";

const r = Router();
const platform = (req, fn) => transaction({ platform: true, actor: req.actor || "مالك المنصة", ip: req.ip }, fn);
const base = (req) => env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, async (q) => {
    const [m] = await q("SELECT enabled, host, port, secure, username, from_email, from_name, password_sealed IS NOT NULL AS has_password, updated_at FROM mail_gateway WHERE id = 1");
    const providers = await q("SELECT provider, enabled, client_id, team_id, key_id, secret_sealed IS NOT NULL AS has_secret, updated_at FROM auth_providers ORDER BY provider");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM accounts");
    return { mail: m, providers, accounts: n, can_store_secret: credentialsEnabled(),
      callbacks: { google: callbackUrl(base(req), "google"), apple: callbackUrl(base(req), "apple") }, origin: base(req) };
  }));
}));

const mailSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(200).regex(/^[a-zA-Z0-9.-]*$/, "اسم الخادم غير صحيح"),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().max(200),
  password: z.string().max(500).optional(),
  from_email: z.string().trim().max(160).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "بريد المرسل غير صحيح"),
  from_name: z.string().trim().max(80),
});
r.put("/mail", handle(async (req, res) => {
  const b = parse(mailSchema, req.body);
  if (b.enabled && (!b.host || !b.from_email)) throw badRequest("أكمل اسم الخادم وبريد المرسل قبل التفعيل");
  if (b.password && !credentialsEnabled()) throw badRequest("لا يمكن حفظ كلمة المرور: مفتاح التشفير غير مضبوط على الخادم");
  await platform(req, async (q) => {
    await q(`UPDATE mail_gateway SET enabled = $1, host = $2, port = $3, secure = $4, username = $5, from_email = $6, from_name = $7,
               password_sealed = CASE WHEN $8::text IS NULL THEN password_sealed ELSE $8 END, updated_at = now() WHERE id = 1`,
    [b.enabled, b.host, b.port, b.secure, b.username, b.from_email, b.from_name || "مدار", b.password ? sealSecret(b.password, MAIL_AAD) : null]);
    await logEvent(q, { actor: req.actor, action: `تحديث إعدادات البريد الإلكتروني (${b.enabled ? "مفعّل" : "متوقف"})` });
  });
  res.json({ ok: true });
}));

r.post("/mail/test", handle(async (req, res) => {
  const { to } = parse(z.object({ to: z.string().trim().max(160).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "البريد غير صحيح") }), req.body);
  await sendMail(codeMail({ to, title: "رسالة تجريبية", intro: "وصلت هذه الرسالة من إعدادات البريد في لوحة مالك مدار. الرمز أدناه للتجربة فقط.", code: "123456", minutes: 15 }));
  await platform(req, (q) => logEvent(q, { actor: req.actor, action: "إرسال بريد تجريبي" }));
  res.json({ ok: true });
}));

const providerSchema = z.object({
  enabled: z.boolean(),
  client_id: z.string().trim().max(300),
  team_id: z.string().trim().max(20).optional().default(""),
  key_id: z.string().trim().max(20).optional().default(""),
  secret: z.string().max(4000).optional(),
});
r.put("/providers/:provider", handle(async (req, res) => {
  const provider = parse(z.enum(["google", "apple"]), req.params.provider);
  const b = parse(providerSchema, req.body);
  if (b.secret && !credentialsEnabled()) throw badRequest("لا يمكن حفظ المفتاح السري: مفتاح التشفير غير مضبوط على الخادم");
  if (provider === "apple" && b.secret && !/-----BEGIN PRIVATE KEY-----/.test(b.secret)) throw badRequest("ألصق محتوى ملف المفتاح (.p8) كاملًا");
  await platform(req, async (q) => {
    const [cur] = await q("SELECT secret_sealed FROM auth_providers WHERE provider = $1", [provider]);
    if (b.enabled && (!b.client_id || (!b.secret && !cur.secret_sealed) || (provider === "apple" && (!b.team_id || !b.key_id)))) {
      throw badRequest("أكمل كل الحقول قبل التفعيل");
    }
    await q(`UPDATE auth_providers SET enabled = $2, client_id = $3, team_id = $4, key_id = $5,
               secret_sealed = CASE WHEN $6::text IS NULL THEN secret_sealed ELSE $6 END, updated_at = now() WHERE provider = $1`,
    [provider, b.enabled, b.client_id, b.team_id, b.key_id, b.secret ? sealSecret(b.secret.trim(), PROVIDER_AAD(provider)) : null]);
    await logEvent(q, { actor: req.actor, action: `تحديث الدخول عبر ${provider === "google" ? "Google" : "Apple"} (${b.enabled ? "مفعّل" : "متوقف"})` });
  });
  res.json({ ok: true });
}));

export default r;
