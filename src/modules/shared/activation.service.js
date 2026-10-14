/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from "node:crypto";
import { transaction } from "../../core/db/pool.js";
import { AppError, badRequest, notFound, conflict } from "../../core/http/errors.js";
import { hashPassword } from "../../core/auth/password.js";
import { createSession } from "../../core/auth/sessions.js";
import { logEvent } from "../../core/audit.js";
import { detectPhone } from "../../../public/shared/js/phone.js";
import { loadGateway, sendRaw } from "./notify.service.js";
import { addEvent } from "./school-files.service.js";
import { normalizePhone } from "./students.service.js";

export const OTP_MINUTES = 10, OTP_ATTEMPTS = 5, OTP_SENDS = 5, RESEND_SECONDS = 60;
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const codeHash = (id, code) => sha(`${id}:${String(code).trim()}`);
const platform = (actor, fn) => transaction({ platform: true, actor, ip: null }, fn);
export const maskPhone = (p) => { const s = String(p || ""); return s.length > 4 ? `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : s; };

async function current(q, token, { lock = false } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ""))) throw badRequest("رابط التفعيل غير صحيح");
  const [a] = await q(
    `SELECT a.*, t.name AS school, t.status AS school_status FROM school_activations a JOIN tenants t ON t.id = a.tenant_id
      WHERE a.token_hash = $1${lock ? " FOR UPDATE OF a" : ""}`, [sha(token)]);
  if (!a || a.used_at || a.revoked_at) throw notFound("رابط التفعيل غير صالح أو استُخدم مسبقًا. اطلبوا رابطًا جديدًا من إدارة مدار.");
  if (new Date(a.expires_at) < new Date()) throw new AppError(410, "انتهت صلاحية رابط التفعيل. اطلبوا رابطًا جديدًا من إدارة مدار.", "expired");
  if (a.school_status !== "active") throw new AppError(403, "حساب المدرسة موقوف حاليًا. تواصلوا مع إدارة مدار.", "forbidden");
  return a;
}

export async function info(token) {
  return platform("زائر", async (q) => {
    const a = await current(q, token);
    const wait = a.otp_last_sent_at ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - new Date(a.otp_last_sent_at)) / 1000)) : 0;
    const sent = Boolean(a.otp_hash && new Date(a.otp_expires_at) > new Date());
    return { school: a.school, school_id: a.tenant_id, manager_name: a.manager_name,
      phone: (sent || a.phone_verified_at) && a.phone ? maskPhone(a.phone) : null,
      phone_verified: Boolean(a.phone_verified_at), code_sent: sent, resend_in: wait, expires_at: a.expires_at };
  });
}

// Sends a one-time code to the number the manager types; that number becomes the manager's login once verified.
export async function sendCode(token, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !detectPhone(phone)?.intl) throw badRequest("رقم الجوال غير صحيح");
  const out = await platform("زائر", async (q) => {
    const a = await current(q, token, { lock: true });
    if (a.phone_verified_at) return { already: true };
    if (a.otp_sends >= OTP_SENDS) throw new AppError(429, "تجاوزتم عدد مرات طلب الرمز لهذا الرابط. تواصلوا مع إدارة مدار لإصدار رابط جديد.", "rate_limited");
    if (a.otp_last_sent_at && Date.now() - new Date(a.otp_last_sent_at) < RESEND_SECONDS * 1000) {
      throw new AppError(429, "انتظروا دقيقة قبل طلب رمز جديد.", "rate_limited");
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await q(`UPDATE school_activations SET phone = $4, otp_hash = $2, otp_channel = 'sms', otp_expires_at = now() + make_interval(mins => $3), otp_attempts = 0,
                    otp_sends = otp_sends + 1, otp_last_sent_at = now() WHERE id = $1`, [a.id, codeHash(a.id, code), OTP_MINUTES, phone]);
    return { a: { ...a, phone }, code };
  });
  if (out.already) return { verified: true };
  const { a, code } = out;
  const to = detectPhone(a.phone)?.intl;
  let failure = null;
  try {
    const gateway = await loadGateway();
    if (!gateway) failure = "خدمة الرسائل النصية غير مهيأة";
    else if (!to) failure = "رقم الجوال المعتمد غير صالح للإرسال";
    else await sendRaw(gateway, { to, message: `رمز تفعيل حساب ${a.school} على مدار: ${code}\nصالح ${OTP_MINUTES} دقائق. لا تشاركه مع أحد.` });
  } catch (e) { failure = `فشل إرسال الرسالة: ${String(e.message).slice(0, 120)}`; }
  await platform("النظام", async (q) => {
    if (failure) {
      await q("UPDATE school_activations SET otp_hash = NULL, otp_expires_at = NULL, otp_last_sent_at = NULL WHERE id = $1", [a.id]);
      await addEvent(q, a.tenant_id, { kind: "error", body: `تعذر إرسال رمز التحقق إلى ${maskPhone(a.phone)}: ${failure}` }, "النظام");
    } else {
      await addEvent(q, a.tenant_id, { kind: "otp", body: `أُرسل رمز تحقق برسالة نصية إلى ${maskPhone(a.phone)}` }, "النظام");
    }
  });
  if (failure) throw new AppError(503, "تعذر إرسال الرمز الآن. حاولوا بعد قليل.", "sms_failed");
  return { sent: true, phone: maskPhone(a.phone), expires_minutes: OTP_MINUTES };
}

export async function verifyCode(token, code) {
  // A wrong code is counted in its own committed write, so throwing never rolls the counter back.
  const out = await platform("زائر", async (q) => {
    const a = await current(q, token, { lock: true });
    if (a.phone_verified_at) return { verified: true };
    if (!a.otp_hash || !a.otp_expires_at) throw badRequest("اطلبوا رمز التحقق أولًا.");
    if (new Date(a.otp_expires_at) < new Date()) throw new AppError(410, "انتهت صلاحية الرمز. اطلبوا رمزًا جديدًا.", "expired");
    if (a.otp_attempts >= OTP_ATTEMPTS) throw new AppError(429, "تجاوزتم عدد المحاولات. اطلبوا رمزًا جديدًا.", "rate_limited");
    const ok = /^\d{6}$/.test(String(code || "").trim())
      && crypto.timingSafeEqual(Buffer.from(codeHash(a.id, code)), Buffer.from(a.otp_hash));
    if (!ok) {
      await q("UPDATE school_activations SET otp_attempts = otp_attempts + 1 WHERE id = $1", [a.id]);
      return { wrong: OTP_ATTEMPTS - a.otp_attempts - 1 };
    }
    await q("UPDATE school_activations SET phone_verified_at = now(), otp_hash = NULL, otp_expires_at = NULL WHERE id = $1", [a.id]);
    await addEvent(q, a.tenant_id, { kind: "phone_verified", body: `تحقق المدير من جواله ${maskPhone(a.phone)} برسالة نصية` }, "مدير المدرسة");
    return { verified: true };
  });
  if (out.wrong !== undefined) {
    const left = out.wrong;
    throw badRequest(left > 0 ? `الرمز غير صحيح. متبقٍ ${left} ${left === 1 ? "محاولة" : "محاولات"}.` : "الرمز غير صحيح. اطلبوا رمزًا جديدًا.");
  }
  return out;
}

// The password step only opens after the phone is verified; it activates the account and signs the manager in.
export async function complete(token, password, req, res) {
  const a = await platform("زائر", async (q) => {
    const x = await current(q, token, { lock: true });
    if (!x.phone_verified_at) throw new AppError(403, "تحققوا من رقم الجوال أولًا.", "forbidden");
    return x;
  });
  const hash = await hashPassword(password);
  await transaction({ tenantId: a.tenant_id, actor: "مدير المدرسة", ip: req.ip }, async (q) => {
    const [taken] = await q("SELECT 1 FROM users WHERE phone = $1 AND id <> $2", [a.phone, a.user_id]);
    if (taken) throw conflict("رقم الجوال مرتبط بحساب آخر في المدرسة. تواصلوا مع إدارة مدار.");
    const rows = await q(
      `UPDATE users SET password_hash = $2, must_change_password = false, initial_password_enc = NULL, failed_logins = 0, locked_until = NULL,
              is_active = true, password_changed_at = now(), phone = $3, phone_verified_at = now(), full_name = COALESCE($4, full_name),
              last_login_at = now()
        WHERE id = $1 AND role = 'admin' RETURNING id`, [a.user_id, hash, a.phone, a.manager_name || null]);
    if (!rows.length) throw notFound("حساب المدير غير موجود");
    await q("DELETE FROM sessions WHERE user_id = $1", [a.user_id]);
    await createSession(res, "admin", { userId: a.user_id, tenantId: a.tenant_id, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);
  });
  await platform("مدير المدرسة", async (q) => {
    const used = await q("UPDATE school_activations SET used_at = now(), token_enc = NULL WHERE id = $1 AND used_at IS NULL RETURNING id", [a.id]);
    if (!used.length) throw notFound("رابط التفعيل استُخدم مسبقًا.");
    await q("UPDATE tenants SET activated_at = COALESCE(activated_at, now()) WHERE id = $1", [a.tenant_id]);
    await addEvent(q, a.tenant_id, { kind: "activated", body: "فعّل المدير الحساب: تحقق من الجوال وأنشأ كلمة المرور" }, "مدير المدرسة");
    await logEvent(q, { actor: "مدير المدرسة", action: `تفعيل حساب المدرسة ${a.tenant_id}` });
  });
  return { ok: true, redirect: `/${a.tenant_id}/idara?role=admin` };
}
