/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// School managers' Midar accounts: a verified email with a password (or Google / Apple, see oauth.service),
// linked once to each school through the setup link the owner sends. Access to a school always goes through
// the link stored here plus the school's own admin user, checked on the server for every entry.
import crypto from "node:crypto";
import { transaction } from "../../core/db/pool.js";
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from "../../core/http/errors.js";
import { hashPassword, verifyPassword } from "../../core/auth/password.js";
import { createSession } from "../../core/auth/sessions.js";
import { logEvent, securityEvent, recentFailures } from "../../core/audit.js";
import { z, t } from "../../core/http/validate.js";
import { sendMail, codeMail, noticeMail, mailReady } from "../shared/mail.service.js";
import { env } from "../../config/env.js";
import { addEvent } from "../shared/school-files.service.js";

export const CODE_MINUTES = 15, CODE_ATTEMPTS = 5, CODE_SENDS = 5, RESEND_SECONDS = 60, TICKET_MINUTES = 15;
const LOGIN_FAILS = 8, LOGIN_WINDOW_MIN = 15;

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const codeHash = (id, code) => sha(`account-code:${id}:${String(code).trim()}`);
const platform = (actor, ip, fn) => transaction({ platform: true, actor, ip: ip || null }, fn);
export const normEmail = (v) => String(v || "").trim().toLowerCase();

const email = z.string().trim().toLowerCase().max(160).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "البريد الإلكتروني غير صحيح");
const token = z.string().regex(/^[0-9a-f]{64}$/, "الرابط غير صحيح");
export const schemas = {
  signup: z.object({ email, password: t.password, name: z.string().trim().min(2, "اكتب اسمك").max(120), setup: token.optional() }),
  verify: z.object({ email, code: z.string().trim().max(10) }),
  login: z.object({ email, password: z.string().min(1, "أدخل كلمة المرور").max(200) }),
  resetStart: z.object({ email }),
  resetFinish: z.object({ ticket: z.string().max(80), password: t.password }),
  setup: z.object({ token }),
  enter: z.object({ school: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/, "رمز المدرسة غير صحيح") }),
  password: z.object({ current: z.string().max(200).optional().default(""), next: t.password }),
};

// ---- Setup links (the school link the owner sends) ----

async function setupRow(q, rawToken, { lock = false, hash = null } = {}) {
  const [a] = await q(
    `SELECT a.*, tn.name AS school, tn.status AS school_status FROM school_activations a JOIN tenants tn ON tn.id = a.tenant_id
      WHERE a.token_hash = $1${lock ? " FOR UPDATE OF a" : ""}`, [hash || sha(rawToken)]);
  if (!a || a.revoked_at) throw notFound("رابط المدرسة غير صالح. تواصل مع إدارة مدار لطلب رابط جديد.");
  if (a.used_at) throw new AppError(410, "اكتمل إعداد هذا الحساب من قبل. سجّل الدخول من صفحة مدرستك.", "used");
  if (new Date(a.expires_at) < new Date()) throw new AppError(410, "انتهت صلاحية رابط الإعداد. تواصل مع إدارة مدار لإصدار رابط جديد.", "expired");
  if (a.school_status !== "active") throw forbidden("حساب المدرسة موقوف حاليًا. تواصل مع إدارة مدار.");
  return a;
}

// What the setup page shows. Opening the link records that setup started; it grants nothing.
export async function setupInfo(rawToken, accountId = null) {
  return platform("زائر", null, async (q) => {
    const a = await setupRow(q, rawToken, { lock: true });
    if (!a.started_at) {
      await q("UPDATE school_activations SET started_at = now() WHERE id = $1", [a.id]);
      await addEvent(q, a.tenant_id, { kind: "setup_started", body: "فتح المدير رابط الإعداد" }, "النظام");
    }
    const [acct] = accountId ? await q("SELECT id, email, full_name FROM accounts WHERE id = $1 AND disabled_at IS NULL", [accountId]) : [];
    return { school: a.school, school_id: a.tenant_id, manager_name: a.manager_name, recovery: a.recovery, expires_at: a.expires_at,
      account: acct ? { email: acct.email, name: acct.full_name } : null };
  });
}

// Links the signed-in account to the school of the setup link, then opens the school.
export async function linkSetup(rawToken, accountId, via, req, res, { hash = null } = {}) {
  const a = await platform("زائر", req.ip, (q) => setupRow(q, rawToken, { hash }));
  const admin = await transaction({ tenantId: a.tenant_id, actor: "النظام", ip: req.ip }, async (q) => {
    const [u] = await q("SELECT id, is_active FROM users WHERE id = $1 AND role = 'admin'", [a.user_id]);
    return u;
  });
  if (!admin?.is_active) throw forbidden("حساب مدير المدرسة موقوف. تواصل مع إدارة مدار.");
  const out = await platform("مدير المدرسة", req.ip, async (q) => {
    const x = await setupRow(q, rawToken, { lock: true, hash });
    const [acct] = await q("SELECT id, email, full_name FROM accounts WHERE id = $1 AND disabled_at IS NULL AND email_verified_at IS NOT NULL", [accountId]);
    if (!acct) throw unauthorized("سجّل الدخول بحسابك أولًا.");
    const [current] = await q("SELECT account_id FROM account_schools WHERE user_id = $1 AND revoked_at IS NULL", [x.user_id]);
    if (current && current.account_id !== accountId) {
      // Only a recovery link (issued by the owner) may move the school to another account.
      if (!x.recovery) throw conflict("هذه المدرسة مرتبطة بحساب آخر. اطلب من إدارة مدار رابط استعادة الوصول.");
      await q("UPDATE account_schools SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [x.user_id]);
    }
    await q(
      `INSERT INTO account_schools (account_id, tenant_id, user_id, linked_via) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, tenant_id) DO UPDATE SET user_id = EXCLUDED.user_id, linked_via = EXCLUDED.linked_via, linked_at = now(), revoked_at = NULL`,
      [accountId, x.tenant_id, x.user_id, via]);
    await q("UPDATE school_activations SET used_at = now(), token_enc = NULL, account_id = $2, linked_at = now() WHERE id = $1", [x.id, accountId]);
    await q("UPDATE tenants SET activated_at = COALESCE(activated_at, now()) WHERE id = $1", [x.tenant_id]);
    await addEvent(q, x.tenant_id, { kind: "account_linked",
      body: `${x.recovery ? "استُعيد الوصول: " : ""}رُبط حساب المدير (${acct.email}) بالمدرسة عبر ${VIA[via]}` }, acct.full_name || acct.email);
    await logEvent(q, { actor: acct.email, action: `ربط حساب مدير بمدرسة ${x.tenant_id}${x.recovery ? " (استعادة وصول)" : ""}` });
    return { tenantId: x.tenant_id, userId: x.user_id, recovery: x.recovery, name: acct.full_name };
  });
  return openSchool(out.tenantId, out.userId, accountId, req, res, { revokeOthers: out.recovery, via, name: out.name });
}
const VIA = { email: "البريد الإلكتروني", google: "Google", apple: "Apple", password: "البريد وكلمة المرور" };

// Creates the admin session for a school the account is linked to (server-side checks every time).
async function openSchool(tenantId, userId, accountId, req, res, { revokeOthers = false, via = "email", name = null } = {}) {
  await transaction({ tenantId, actor: "مدير المدرسة", ip: req.ip }, async (q) => {
    const [tn] = await q("SELECT status, emergency_locked_at FROM tenants WHERE id = $1", [tenantId]);
    if (!tn || tn.status !== "active") throw forbidden("حساب المدرسة موقوف. تواصل مع إدارة مدار.");
    if (tn.emergency_locked_at) throw forbidden("الدخول للمدرسة موقوف مؤقتًا من إدارة المنصة. تواصل معها.");
    const [u] = await q("SELECT id, full_name, is_active FROM users WHERE id = $1 AND role = 'admin'", [userId]);
    if (!u?.is_active) throw forbidden("حساب مدير المدرسة موقوف. تواصل مع إدارة مدار.");
    if (revokeOthers) await q("DELETE FROM sessions WHERE user_id = $1", [userId]);
    // On linking, the school knows its manager by the name on the account.
    if (name) await q("UPDATE users SET full_name = $2 WHERE id = $1", [userId, name]);
    await q("UPDATE users SET last_login_at = now(), failed_logins = 0, locked_until = NULL, must_change_password = false WHERE id = $1", [userId]);
    await createSession(res, "admin", { userId, tenantId, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);
    await logEvent(q, { tenantId, actor: u.full_name, action: `دخول المدير بحساب مدار (${VIA[via] || via})` });
  });
  return { ok: true, school: tenantId, redirect: `/${tenantId}/idara?role=admin` };
}

// ---- First entry through the school's own login link ----
// A school with no manager account yet shows "create the manager account" on its login page. Only the
// manager email recorded in the school file (from the school's request, editable by Midar) can complete it,
// so knowing the school's link is not enough to take it over.
export const maskEmail = (v) => {
  const [user, host = ""] = normEmail(v).split("@");
  const [dom, ...tld] = host.split(".");
  const m = (x) => (x.length <= 2 ? `${x[0] || ""}*` : `${x.slice(0, 2)}${"*".repeat(Math.min(6, x.length - 2))}`);
  return `${m(user)}@${m(dom)}${tld.length ? `.${tld.join(".")}` : ""}`;
};
export async function claimInfo(school) {
  return platform("زائر", null, async (q) => {
    const [t] = await q("SELECT id, name, status, profile->>'email' AS email FROM tenants WHERE id = $1", [school]);
    if (!t || t.status !== "active") return { first_entry: false };
    const [linked] = await q("SELECT 1 FROM account_schools WHERE tenant_id = $1 AND revoked_at IS NULL LIMIT 1", [school]);
    if (linked) return { first_entry: false, school: t.name };
    return { first_entry: true, school: t.name, email_hint: t.email ? maskEmail(t.email) : null, ready: Boolean(t.email) };
  });
}

export async function claimSchool(accountId, school, via, req, res) {
  const [admin] = await transaction({ tenantId: school, actor: "النظام", ip: req.ip }, (q) => q(
    "SELECT id, is_active FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"));
  const out = await platform("مدير المدرسة", req.ip, async (q) => {
    const [t] = await q("SELECT id, status, profile->>'email' AS email FROM tenants WHERE id = $1 FOR UPDATE", [school]);
    if (!t) throw notFound("المدرسة غير موجودة.");
    if (t.status !== "active") throw forbidden("حساب المدرسة موقوف حاليًا. تواصل مع إدارة مدار.");
    const [linked] = await q("SELECT account_id FROM account_schools WHERE tenant_id = $1 AND revoked_at IS NULL LIMIT 1", [school]);
    if (linked) {
      if (Number(linked.account_id) === Number(accountId)) return { already: true };
      throw conflict("لهذه المدرسة مدير مرتبط بحسابه بالفعل. سجّل الدخول بحساب المدير، أو تواصل مع إدارة مدار.");
    }
    if (!admin?.is_active) throw forbidden("حساب مدير المدرسة موقوف. تواصل مع إدارة مدار.");
    if (!t.email) throw forbidden("لم يُسجَّل بريد مدير هذه المدرسة لدى مدار بعد. تواصل مع إدارة مدار.");
    const [acct] = await q("SELECT id, email, full_name FROM accounts WHERE id = $1 AND disabled_at IS NULL AND email_verified_at IS NOT NULL", [accountId]);
    if (!acct) throw unauthorized("سجّل الدخول بحسابك أولًا.");
    if (normEmail(acct.email) !== normEmail(t.email)) {
      throw new AppError(403, `أول دخول لمدير المدرسة يكون بالبريد المسجل لدى مدار (${maskEmail(t.email)}). استخدم هذا البريد، أو تواصل مع إدارة مدار لتغييره.`, "email_mismatch");
    }
    await q(`INSERT INTO account_schools (account_id, tenant_id, user_id, linked_via) VALUES ($1, $2, $3, $4)
             ON CONFLICT (account_id, tenant_id) DO UPDATE SET user_id = EXCLUDED.user_id, linked_via = EXCLUDED.linked_via, linked_at = now(), revoked_at = NULL`,
    [accountId, school, admin.id, via]);
    // Any setup link still open becomes unnecessary.
    await q("UPDATE school_activations SET revoked_at = now(), token_enc = NULL WHERE tenant_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [school]);
    await q("UPDATE tenants SET activated_at = COALESCE(activated_at, now()) WHERE id = $1", [school]);
    await addEvent(q, school, { kind: "account_linked", body: `أول دخول للمدير من رابط المدرسة: رُبط حسابه (${acct.email}) عبر ${VIA[via] || via}` }, acct.full_name || acct.email);
    await logEvent(q, { actor: acct.email, action: `أول دخول لمدير المدرسة ${school} وربط حسابه` });
    return { name: acct.full_name };
  });
  if (out.already) return enterSchool(accountId, school, req, res, via);
  return openSchool(school, admin.id, accountId, req, res, { via, name: out.name });
}

export async function enterSchool(accountId, school, req, res, via = "email") {
  const [link] = await platform("مدير المدرسة", req.ip, (q) => q(
    `SELECT s.user_id FROM account_schools s JOIN accounts a ON a.id = s.account_id
      WHERE s.account_id = $1 AND s.tenant_id = $2 AND s.revoked_at IS NULL AND a.disabled_at IS NULL`, [accountId, school]));
  if (!link) throw forbidden("حسابك غير مرتبط بهذه المدرسة.");
  return openSchool(school, link.user_id, accountId, req, res, { via });
}

// ---- The account itself ----

export async function me(accountId) {
  return platform("مدير المدرسة", null, async (q) => {
    const [a] = await q("SELECT id, email, full_name, password_hash IS NOT NULL AS has_password, created_at FROM accounts WHERE id = $1 AND disabled_at IS NULL", [accountId]);
    if (!a) throw unauthorized("انتهت الجلسة. سجّل الدخول من جديد.");
    const schools = await q(
      `SELECT t.id, t.name, t.status FROM account_schools s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.account_id = $1 AND s.revoked_at IS NULL ORDER BY t.name`, [accountId]);
    const ids = await q("SELECT provider, email, created_at FROM account_identities WHERE account_id = $1 ORDER BY provider", [accountId]);
    return { email: a.email, name: a.full_name, has_password: a.has_password, schools, identities: ids };
  });
}

// Trusted devices: a device that proved the email once (a code, a password reset, Google or Apple) is remembered
// for a year; signing in from any other device with the password also needs a code sent to the email.
const DEVICE_DAYS = 365;
const deviceCookie = () => `${env.COOKIE_SECURE ? "__Secure-" : ""}midar_dv`;
const deviceLabel = (ua) => {
  const s = String(ua || "");
  const os = /iPhone|iPad/.test(s) ? "آيفون" : /Android/.test(s) ? "أندرويد" : /Windows/.test(s) ? "ويندوز" : /Mac OS/.test(s) ? "ماك" : /Linux/.test(s) ? "لينكس" : "جهاز";
  const br = /Edg\//.test(s) ? "Edge" : /SamsungBrowser/.test(s) ? "Samsung" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" — ");
};
async function isTrustedDevice(q, req, accountId) {
  const raw = req.cookies?.[deviceCookie()];
  if (!raw || !/^[A-Za-z0-9_-]{40,60}$/.test(raw)) return false;
  const [d] = await q("UPDATE account_devices SET last_used_at = now(), ip = $3 WHERE token_hash = $1 AND account_id = $2 AND revoked_at IS NULL RETURNING id",
    [sha(raw), accountId, req.ip || null]);
  return Boolean(d);
}
async function trustDevice(q, req, res, accountId) {
  if (await isTrustedDevice(q, req, accountId)) return;
  const raw = crypto.randomBytes(32).toString("base64url");
  await q("INSERT INTO account_devices (account_id, token_hash, label, ip) VALUES ($1, $2, $3, $4)",
    [accountId, sha(raw), deviceLabel(req.get("user-agent")), req.ip || null]);
  res.cookie(deviceCookie(), raw, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "strict", path: "/api/account", maxAge: DEVICE_DAYS * 86_400_000 });
}

// Every account session opened after the email (or Google / Apple) was proven also remembers the device.
const accountSession = async (q, res, req, accountId, { trust = true } = {}) => {
  if (trust) await trustDevice(q, req, res, accountId);
  return createSession(res, "account", { accountId, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);
};
export const startAccountSession = (q, req, res, accountId) => accountSession(q, res, req, accountId);

// A code to an email: resend waits a minute, at most five per hour; wrong codes are counted and capped.
async function issueCode(q, purpose, mail, extra = {}) {
  // The one-minute wait applies to a code still waiting to be entered; the hourly cap counts codes never used.
  const [last] = await q(
    `SELECT last_sent_at, (consumed_at IS NULL AND expires_at > now()) AS pending,
            (SELECT count(*) FROM account_codes WHERE lower(email) = $1 AND purpose = $2 AND used_at IS NULL AND created_at > now() - interval '1 hour')::int AS n
       FROM account_codes WHERE lower(email) = $1 AND purpose = $2 ORDER BY id DESC LIMIT 1`, [mail, purpose]);
  if (last?.pending && Date.now() - new Date(last.last_sent_at) < RESEND_SECONDS * 1000) throw new AppError(429, "انتظر دقيقة قبل طلب رمز جديد.", "rate_limited");
  if (last && last.n >= CODE_SENDS) throw new AppError(429, "طلبت رموزًا كثيرة. حاول بعد ساعة.", "rate_limited");
  await q("UPDATE account_codes SET consumed_at = now() WHERE lower(email) = $1 AND purpose = $2 AND consumed_at IS NULL", [mail, purpose]);
  const code = String(crypto.randomInt(100000, 1000000));
  const [row] = await q(
    `INSERT INTO account_codes (purpose, email, account_id, code_hash, pending_hash, pending_name, setup_token_hash, expires_at)
     VALUES ($1, $2, $3, 'x', $4, $5, $6, now() + make_interval(mins => $7)) RETURNING id`,
    [purpose, mail, extra.accountId ?? null, extra.pendingHash ?? null, extra.pendingName ?? null, extra.setupHash ?? null, CODE_MINUTES]);
  await q("UPDATE account_codes SET code_hash = $2 WHERE id = $1", [row.id, codeHash(row.id, code)]);
  return { id: row.id, code };
}
async function deliver(rowId, msg) {
  try { await sendMail(msg); } catch (e) {
    await platform("النظام", null, (q) => q("UPDATE account_codes SET consumed_at = now(), last_sent_at = now() - interval '1 hour' WHERE id = $1", [rowId]));
    throw e;
  }
}

// Checks a code in its own committed write, so a wrong guess is always counted.
async function checkCode(purpose, mail, code) {
  const out = await platform("زائر", null, async (q) => {
    const [row] = await q(
      `SELECT * FROM account_codes WHERE lower(email) = $1 AND purpose = $2 AND consumed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [mail, purpose]);
    if (!row) return { error: badRequest("اطلب رمز التحقق أولًا.") };
    if (new Date(row.expires_at) < new Date()) return { error: new AppError(410, "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.", "expired") };
    if (row.attempts >= CODE_ATTEMPTS) return { error: new AppError(429, "تم تجاوز عدد المحاولات. اطلب رمزًا جديدًا.", "rate_limited") };
    const ok = /^\d{6}$/.test(String(code).trim()) && crypto.timingSafeEqual(Buffer.from(codeHash(row.id, code)), Buffer.from(row.code_hash));
    if (!ok) {
      await q("UPDATE account_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
      return { wrong: CODE_ATTEMPTS - row.attempts - 1 };
    }
    await q("UPDATE account_codes SET consumed_at = now(), used_at = now() WHERE id = $1", [row.id]);
    return { row };
  });
  if (out.error) throw out.error;
  if (out.wrong !== undefined) {
    throw badRequest(out.wrong > 0 ? `الرمز غير صحيح. متبقٍ ${out.wrong} ${out.wrong === 1 ? "محاولة" : "محاولات"}.` : "الرمز غير صحيح. اطلب رمزًا جديدًا.");
  }
  return out.row;
}

// Sign-up: the account is created only once the email is proven; an email already registered signs in instead.
export async function signupStart(b, ip) {
  if (!(await mailReady())) throw new AppError(503, "خدمة البريد الإلكتروني غير مهيأة بعد. تواصل مع إدارة مدار.", "mail_off");
  const mail = normEmail(b.email);
  if (b.setup) await platform("زائر", ip, (q) => setupRow(q, b.setup));
  const pendingHash = await hashPassword(b.password);
  const issued = await platform("زائر", ip, async (q) => {
    const [exists] = await q("SELECT 1 FROM accounts WHERE lower(email) = $1", [mail]);
    if (exists) throw new AppError(409, "هذا البريد مسجّل في مدار. سجّل الدخول بحسابك.", "exists");
    return issueCode(q, "signup", mail, { pendingHash, pendingName: b.name, setupHash: b.setup ? sha(b.setup) : null });
  });
  await deliver(issued.id, codeMail({ to: mail, title: "تأكيد بريدك الإلكتروني", intro: "استخدم هذا الرمز لإكمال إنشاء حسابك في مدار.", code: issued.code, minutes: CODE_MINUTES }));
  return { sent: true, email: mail, resend_in: RESEND_SECONDS, expires_minutes: CODE_MINUTES };
}

export async function signupVerify(b, req, res) {
  const mail = normEmail(b.email);
  const row = await checkCode("signup", mail, b.code);
  return platform("زائر", req.ip, async (q) => {
    const [exists] = await q("SELECT 1 FROM accounts WHERE lower(email) = $1", [mail]);
    if (exists) throw new AppError(409, "هذا البريد مسجّل في مدار. سجّل الدخول بحسابك.", "exists");
    const [a] = await q(
      `INSERT INTO accounts (email, email_verified_at, password_hash, full_name, password_changed_at, last_login_at)
       VALUES ($1, now(), $2, $3, now(), now()) RETURNING id, email, full_name`, [mail, row.pending_hash, row.pending_name]);
    if (row.setup_token_hash) {
      const [s] = await q(`UPDATE school_activations SET account_id = $2 WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING tenant_id`,
        [row.setup_token_hash, a.id]);
      if (s) await addEvent(q, s.tenant_id, { kind: "setup_started", body: `أنشأ المدير حسابه ووثّق بريده (${mail})` }, a.full_name);
    }
    await logEvent(q, { actor: mail, action: "إنشاء حساب مدير بالبريد الإلكتروني" });
    await accountSession(q, res, req, a.id);
    return { ok: true, email: a.email, name: a.full_name };
  });
}

export async function login(b, req, res) {
  const mail = normEmail(b.email);
  const canMail = await mailReady();
  const subject = `${mail}:${req.ip || "?"}`;
  const out = await platform(mail, req.ip, async (q) => {
    if (await recentFailures(q, "account_login_failed", subject, LOGIN_WINDOW_MIN) >= LOGIN_FAILS
      || await recentFailures(q, "account_login_failed_all", mail, LOGIN_WINDOW_MIN) >= LOGIN_FAILS * 4) {
      return { locked: true };
    }
    const [a] = await q("SELECT id, email, full_name, password_hash, disabled_at, email_verified_at FROM accounts WHERE lower(email) = $1", [mail]);
    const ok = await verifyPassword(b.password, a?.password_hash || null);
    if (!a || !ok || a.disabled_at || !a.email_verified_at) {
      await securityEvent(q, { kind: "account_login_failed", subject, ip: req.ip });
      await securityEvent(q, { kind: "account_login_failed_all", subject: mail, ip: req.ip });
      return { denied: true };
    }
    await q("DELETE FROM security_events WHERE kind = 'account_login_failed' AND subject = $1", [subject]);
    // A new device: the password was right, and the account owner confirms with a code sent to the email.
    // (Without a mail service the code cannot be sent; the password alone is accepted as before.)
    if (canMail && !(await isTrustedDevice(q, req, a.id))) return { needCode: true, account: a };
    await q("UPDATE accounts SET last_login_at = now() WHERE id = $1", [a.id]);
    await accountSession(q, res, req, a.id, { trust: false });
    return { ok: true, email: a.email, name: a.full_name };
  });
  if (out.locked) throw new AppError(429, `تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة متكررة. حاول بعد ${LOGIN_WINDOW_MIN} دقيقة.`, "locked", { retry_after: LOGIN_WINDOW_MIN * 60 });
  if (out.denied) throw unauthorized("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  if (out.needCode) return deviceCodeStart(out.account, req);
  return out;
}

async function deviceCodeStart(a, req) {
  const mail = normEmail(a.email);
  let issued = null;
  try {
    issued = await platform(mail, req.ip, (q) => issueCode(q, "device", mail, { accountId: a.id }));
  } catch (e) {
    // A code was sent less than a minute ago: the same screen stays, the user enters that code.
    if (e.code !== "rate_limited") throw e;
    const [pending] = await platform(mail, req.ip, (q) => q(
      "SELECT 1 FROM account_codes WHERE lower(email) = $1 AND purpose = 'device' AND consumed_at IS NULL AND expires_at > now() LIMIT 1", [mail]));
    if (!pending) throw e;
  }
  if (issued) {
    await deliver(issued.id, codeMail({ to: mail, title: "رمز الدخول من جهاز جديد",
      intro: `طُلب الدخول إلى حسابك في مدار من جهاز جديد (${deviceLabel(req.get("user-agent"))}). أدخل هذا الرمز لإكماله. إذا لم تكن أنت فغيّر كلمة المرور فورًا.`,
      code: issued.code, minutes: CODE_MINUTES }));
  }
  return { code_required: true, email: maskEmail(mail), resend_in: RESEND_SECONDS, expires_minutes: CODE_MINUTES };
}

// The code from the email: the device is remembered, the session opens, and the owner gets a notice.
export async function loginVerify(b, req, res) {
  const mail = normEmail(b.email);
  const row = await checkCode("device", mail, b.code);
  const out = await platform(mail, req.ip, async (q) => {
    const [a] = await q("SELECT id, email, full_name, disabled_at FROM accounts WHERE id = $1", [row.account_id]);
    if (!a || a.disabled_at) throw unauthorized("الحساب غير متاح.");
    await q("UPDATE accounts SET last_login_at = now() WHERE id = $1", [a.id]);
    await accountSession(q, res, req, a.id);
    await logEvent(q, { actor: a.email, action: `دخول حساب مدير من جهاز جديد (${deviceLabel(req.get("user-agent"))})` });
    return { ok: true, email: a.email, name: a.full_name };
  });
  const when = new Date().toLocaleString("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });
  sendMail(noticeMail({ to: mail, title: "تم الدخول إلى حسابك من جهاز جديد",
    lines: [`الجهاز: ${deviceLabel(req.get("user-agent"))}`, `الوقت: ${when}`, "إذا لم تكن أنت، ادخل إلى مدار وغيّر كلمة المرور ثم اختر «الخروج من كل الأجهزة»."] })).catch(() => {});
  return out;
}

// Forgotten password: the same answer whether or not the email is registered; a code only reaches a real account.
export async function resetStart(b, ip) {
  if (!(await mailReady())) throw new AppError(503, "خدمة البريد الإلكتروني غير مهيأة بعد. تواصل مع إدارة مدار.", "mail_off");
  const mail = normEmail(b.email);
  const issued = await platform("زائر", ip, async (q) => {
    const [a] = await q("SELECT id FROM accounts WHERE lower(email) = $1 AND disabled_at IS NULL AND email_verified_at IS NOT NULL", [mail]);
    if (!a) throw notFound("هذا البريد غير مسجّل في مدار. تأكد من كتابته، أو استخدم البريد الذي أنشأت به حسابك.");
    return issueCode(q, "reset", mail, { accountId: a.id });
  });
  await deliver(issued.id, codeMail({ to: mail, title: "استعادة كلمة المرور", intro: "استخدم هذا الرمز لتعيين كلمة مرور جديدة لحسابك في مدار.", code: issued.code, minutes: CODE_MINUTES }));
  return { sent: true, resend_in: RESEND_SECONDS, expires_minutes: CODE_MINUTES };
}

export async function resetVerify(b) {
  const row = await checkCode("reset", normEmail(b.email), b.code);
  const ticket = crypto.randomBytes(32).toString("hex");
  await platform("زائر", null, (q) => q("UPDATE account_codes SET ticket_hash = $2, ticket_expires_at = now() + make_interval(mins => $3) WHERE id = $1",
    [row.id, sha(ticket), TICKET_MINUTES]));
  return { ticket };
}

// Sets the new password, ends every session of the account and its schools, and signs in on this device.
export async function resetFinish(b, req, res) {
  if (!/^[0-9a-f]{64}$/.test(String(b.ticket || ""))) throw new AppError(410, "انتهت جلسة الاستعادة. ابدأ من جديد.", "expired");
  const hash = await hashPassword(b.password);
  return platform("مدير المدرسة", req.ip, async (q) => {
    const [row] = await q(
      `SELECT c.id, c.account_id, a.email, a.full_name FROM account_codes c JOIN accounts a ON a.id = c.account_id
        WHERE c.ticket_hash = $1 AND c.ticket_expires_at > now() AND c.purpose = 'reset' AND a.disabled_at IS NULL FOR UPDATE OF c`, [sha(b.ticket)]);
    if (!row) throw new AppError(410, "انتهت جلسة الاستعادة. ابدأ من جديد.", "expired");
    await q("UPDATE account_codes SET ticket_hash = NULL, ticket_expires_at = NULL WHERE id = $1", [row.id]);
    await q("UPDATE accounts SET password_hash = $2, password_changed_at = now(), last_login_at = now() WHERE id = $1", [row.account_id, hash]);
    await endEverywhere(q, row.account_id);
    await q("DELETE FROM security_events WHERE kind IN ('account_login_failed_all') AND subject = $1", [normEmail(row.email)]);
    await logEvent(q, { actor: row.email, action: "استعادة كلمة مرور حساب مدير بالبريد الإلكتروني" });
    await accountSession(q, res, req, row.account_id);
    return { ok: true, email: row.email, name: row.full_name };
  });
}

// Ends the account's sessions on every device, and the school sessions opened through it.
async function endEverywhere(q, accountId) {
  await q("DELETE FROM sessions WHERE account_id = $1", [accountId]);
  await q("UPDATE account_devices SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL", [accountId]);
  await q(`DELETE FROM sessions WHERE kind = 'admin' AND user_id IN (SELECT user_id FROM account_schools WHERE account_id = $1 AND revoked_at IS NULL)`, [accountId]);
}

export async function changePassword(accountId, b, req) {
  const hash = await hashPassword(b.next);
  await platform("مدير المدرسة", req.ip, async (q) => {
    const [a] = await q("SELECT email, password_hash FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
    if (!a) throw unauthorized("انتهت الجلسة.");
    if (a.password_hash && !(await verifyPassword(b.current, a.password_hash))) throw unauthorized("كلمة المرور الحالية غير صحيحة.");
    await q("UPDATE accounts SET password_hash = $2, password_changed_at = now() WHERE id = $1", [accountId, hash]);
    await logEvent(q, { actor: a.email, action: a.password_hash ? "تغيير كلمة مرور حساب مدير" : "تعيين كلمة مرور لحساب مدير" });
  });
  return { ok: true };
}

export async function signOutEverywhere(accountId, req) {
  await platform("مدير المدرسة", req.ip, async (q) => {
    const [a] = await q("SELECT email FROM accounts WHERE id = $1", [accountId]);
    await endEverywhere(q, accountId);
    await logEvent(q, { actor: a?.email || "مدير", action: "إنهاء جلسات حساب مدير على كل الأجهزة" });
  });
  return { ok: true };
}

export async function unlinkProvider(accountId, provider, req) {
  await platform("مدير المدرسة", req.ip, async (q) => {
    const [a] = await q("SELECT email, password_hash FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
    const ids = await q("SELECT provider FROM account_identities WHERE account_id = $1", [accountId]);
    if (!ids.some((i) => i.provider === provider)) throw notFound("هذه الطريقة غير مرتبطة بحسابك.");
    if (!a.password_hash && ids.length < 2) throw badRequest("أضف كلمة مرور أو طريقة دخول أخرى قبل إلغاء هذه الطريقة.");
    await q("DELETE FROM account_identities WHERE account_id = $1 AND provider = $2", [accountId, provider]);
    await logEvent(q, { actor: a.email, action: `إلغاء ربط ${provider === "google" ? "Google" : "Apple"} من حساب مدير` });
  });
  return { ok: true };
}
