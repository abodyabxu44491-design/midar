/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Forgotten password for school administrators: the registered mobile receives a one-time SMS code,
// the code opens a short-lived ticket, and the ticket sets the new password and signs the administrator in.
import crypto from "node:crypto";
import { transaction } from "../../core/db/pool.js";
import { AppError, badRequest } from "../../core/http/errors.js";
import { hashPassword } from "../../core/auth/password.js";
import { createSession } from "../../core/auth/sessions.js";
import { logEvent } from "../../core/audit.js";
import { detectPhone } from "../../../public/shared/js/phone.js";
import { loadGateway, sendRaw } from "./notify.service.js";
import { normalizePhone } from "./students.service.js";
import { OTP_MINUTES, OTP_ATTEMPTS, OTP_SENDS, RESEND_SECONDS, otpMessage } from "./activation.service.js";

const TICKET_MINUTES = 15;
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const codeHash = (id, code) => sha(`recovery:${id}:${String(code).trim()}`);
const run = (tenantId, ip, fn) => transaction({ tenantId, actor: "استعادة كلمة المرور", ip }, fn);

// The same matching as sign-in: the stored number, or its local digits when only one administrator has them.
async function adminByPhone(q, raw) {
  const phone = normalizePhone(raw);
  const local = String(raw).replace(/\D/g, "").replace(/^0+/, "");
  if (!phone) return null;
  const rows = await q(
    `SELECT id, full_name, phone FROM users
      WHERE role = 'admin' AND is_active AND phone_verified_at IS NOT NULL
        AND (phone = $1 OR (length($2) >= 8 AND regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $2))
      ORDER BY phone = $1 DESC LIMIT 2`, [phone, local]);
  return rows.find((u) => u.phone === phone) || (rows.length === 1 ? rows[0] : null);
}

const checkPhone = (raw) => {
  if (!detectPhone(raw)?.ok) throw badRequest("رقم الجوال غير صحيح. تأكد من الدولة والرقم.");
};

// Unknown numbers get the same answer as known ones, so the form never reveals who is registered.
export async function start(school, rawPhone, ip) {
  checkPhone(rawPhone);
  const out = await run(school, ip, async (q) => {
    const [tenant] = await q("SELECT id, status FROM tenants WHERE id = $1", [school]);
    if (!tenant || tenant.status !== "active") return null;
    const user = await adminByPhone(q, rawPhone);
    if (!user) return null;
    let [row] = await q(
      `SELECT * FROM staff_recovery WHERE user_id = $1 AND used_at IS NULL AND created_at > now() - interval '1 hour'
        ORDER BY id DESC LIMIT 1 FOR UPDATE`, [user.id]);
    if (row?.otp_sends >= OTP_SENDS) throw new AppError(429, "تم تجاوز عدد مرات طلب الرمز. حاول بعد ساعة.", "rate_limited");
    if (row?.otp_last_sent_at && Date.now() - new Date(row.otp_last_sent_at) < RESEND_SECONDS * 1000) {
      throw new AppError(429, "انتظر دقيقة قبل طلب رمز جديد.", "rate_limited");
    }
    if (!row) [row] = await q("INSERT INTO staff_recovery (tenant_id, user_id) VALUES (app_tenant(), $1) RETURNING *", [user.id]);
    const code = String(crypto.randomInt(100000, 1000000));
    await q(`UPDATE staff_recovery SET otp_hash = $2, otp_expires_at = now() + make_interval(mins => $3), otp_attempts = 0,
                    otp_sends = otp_sends + 1, otp_last_sent_at = now(), ticket_hash = NULL, ticket_expires_at = NULL WHERE id = $1`,
    [row.id, codeHash(row.id, code), OTP_MINUTES]);
    return { rowId: row.id, to: detectPhone(user.phone)?.intl, code, user };
  });
  if (out) {
    let failure = null;
    try {
      const gateway = await loadGateway();
      if (!gateway) failure = "خدمة الرسائل النصية غير مهيأة";
      else if (!out.to) failure = "رقم الجوال المسجل غير صالح للإرسال";
      else await sendRaw(gateway, { to: out.to, message: otpMessage(out.code) });
    } catch (e) { failure = String(e.message).slice(0, 120); }
    await run(school, ip, async (q) => {
      if (failure) await q("UPDATE staff_recovery SET otp_hash = NULL, otp_expires_at = NULL, otp_last_sent_at = NULL WHERE id = $1", [out.rowId]);
      await logEvent(q, { tenantId: school, actor: out.user.full_name,
        action: failure ? `تعذر إرسال رمز استعادة كلمة المرور: ${failure}` : "طلب رمز استعادة كلمة المرور برسالة نصية" });
    });
    if (failure) throw new AppError(503, "تعذر إرسال الرمز الآن. حاول بعد قليل.", "sms_failed");
  }
  return { sent: true, resend_in: RESEND_SECONDS, expires_minutes: OTP_MINUTES };
}

export async function verify(school, rawPhone, code, ip) {
  checkPhone(rawPhone);
  // A wrong code is counted in its own committed write, so throwing never rolls the counter back.
  const out = await run(school, ip, async (q) => {
    const user = await adminByPhone(q, rawPhone);
    const [row] = user ? await q(
      `SELECT * FROM staff_recovery WHERE user_id = $1 AND used_at IS NULL AND otp_hash IS NOT NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [user.id]) : [];
    if (!row) return { error: badRequest("اطلب رمز التحقق أولًا.") };
    if (new Date(row.otp_expires_at) < new Date()) return { error: new AppError(410, "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.", "expired") };
    if (row.otp_attempts >= OTP_ATTEMPTS) return { error: new AppError(429, "تم تجاوز عدد المحاولات. اطلب رمزًا جديدًا.", "rate_limited") };
    const ok = /^\d{6}$/.test(String(code).trim())
      && crypto.timingSafeEqual(Buffer.from(codeHash(row.id, code)), Buffer.from(row.otp_hash));
    if (!ok) {
      await q("UPDATE staff_recovery SET otp_attempts = otp_attempts + 1 WHERE id = $1", [row.id]);
      return { wrong: OTP_ATTEMPTS - row.otp_attempts - 1 };
    }
    const ticket = crypto.randomBytes(32).toString("hex");
    await q(`UPDATE staff_recovery SET otp_hash = NULL, otp_expires_at = NULL, ticket_hash = $2,
                    ticket_expires_at = now() + make_interval(mins => $3) WHERE id = $1`, [row.id, sha(ticket), TICKET_MINUTES]);
    return { ticket, name: user.full_name };
  });
  if (out.error) throw out.error;
  if (out.wrong !== undefined) {
    throw badRequest(out.wrong > 0 ? `الرمز غير صحيح. متبقٍ ${out.wrong} ${out.wrong === 1 ? "محاولة" : "محاولات"}.` : "الرمز غير صحيح. اطلب رمزًا جديدًا.");
  }
  return out;
}

// Sets the new password, ends every other session and signs the administrator in.
export async function reset(school, ticket, password, req, res) {
  if (!/^[0-9a-f]{64}$/.test(String(ticket || ""))) throw badRequest("انتهت جلسة الاستعادة. ابدأ من جديد.");
  const hash = await hashPassword(password);
  return run(school, req.ip, async (q) => {
    const [row] = await q(
      `SELECT r.id, r.user_id, u.full_name FROM staff_recovery r JOIN users u ON u.id = r.user_id
        WHERE r.ticket_hash = $1 AND r.used_at IS NULL AND r.ticket_expires_at > now() AND u.role = 'admin' AND u.is_active FOR UPDATE OF r`, [sha(ticket)]);
    if (!row) throw new AppError(410, "انتهت جلسة الاستعادة. ابدأ من جديد.", "expired");
    await q(`UPDATE users SET password_hash = $2, must_change_password = false, initial_password_enc = NULL, failed_logins = 0,
                    locked_until = NULL, password_changed_at = now(), last_login_at = now() WHERE id = $1`, [row.user_id, hash]);
    await q("UPDATE staff_recovery SET used_at = now(), ticket_hash = NULL WHERE id = $1", [row.id]);
    await q("DELETE FROM sessions WHERE user_id = $1", [row.user_id]);
    await createSession(res, "admin", { userId: row.user_id, tenantId: school, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);
    await logEvent(q, { tenantId: school, actor: row.full_name, action: "تغيير كلمة المرور بعد التحقق من الجوال" });
    return { role: "admin", name: row.full_name };
  });
}
