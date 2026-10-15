/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The platform's outgoing email (any SMTP provider the owner sets up). Used for account codes only.
import nodemailer from "nodemailer";
import { transaction } from "../../core/db/pool.js";
import { openSecret } from "../../core/auth/secret-box.js";
import { AppError } from "../../core/http/errors.js";

export const MAIL_AAD = "mail-gateway";

const realTransport = {
  async send(g, { to, subject, text, html }) {
    const t = nodemailer.createTransport({
      host: g.host, port: g.port, secure: g.secure, auth: g.username ? { user: g.username, pass: g.password } : undefined,
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
    });
    await t.sendMail({ from: { name: g.from_name || "مدار", address: g.from_email }, to, subject, text, html });
    return true;
  },
};
let transport = realTransport;
export const setMailTransport = (t) => { transport = t ? { ...realTransport, ...t } : realTransport; };

export async function loadMail() {
  const [g] = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT * FROM mail_gateway WHERE id = 1"));
  if (!g?.enabled || !g.host || !g.from_email) return null;
  return { ...g, password: g.password_sealed ? openSecret(g.password_sealed, MAIL_AAD) : "" };
}
export const mailReady = async () => Boolean(await loadMail());

export async function sendMail(msg) {
  const g = await loadMail();
  if (!g) throw new AppError(503, "خدمة البريد الإلكتروني غير مهيأة بعد. تواصل مع إدارة مدار.", "mail_off");
  try { await transport.send(g, msg); } catch (e) {
    console.error("[البريد] تعذر الإرسال:", String(e.message || e).slice(0, 200));
    throw new AppError(503, "تعذر إرسال البريد الآن. حاول بعد قليل.", "mail_failed");
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// A short branded message with the one-time code; the code is never logged.
export function codeMail({ to, title, intro, code, minutes }) {
  const text = `${title}\n\n${intro}\n\nالرمز: ${code}\nصالح ${minutes} دقيقة. لا تشاركه مع أحد.\n\nإذا لم تطلب هذا الرمز فتجاهل الرسالة.\n— مدار`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F3F5F8;font-family:Tahoma,Arial,sans-serif">
<div style="max-width:480px;margin:24px auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E3E7EC">
<div style="background:#16244A;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">مدار</div>
<div style="padding:24px;color:#1A2233;line-height:1.9">
<h1 style="font-size:19px;margin:0 0 8px;color:#16244A">${esc(title)}</h1>
<p style="margin:0 0 18px">${esc(intro)}</p>
<div dir="ltr" style="font-size:32px;letter-spacing:10px;font-weight:bold;text-align:center;background:#E3F1F0;color:#0B7A75;border-radius:14px;padding:14px 0">${esc(code)}</div>
<p style="margin:18px 0 0;color:#5F6B7A;font-size:13px">صالح ${minutes} دقيقة. لا تشاركه مع أحد. إذا لم تطلب هذا الرمز فتجاهل الرسالة.</p>
</div></div></body></html>`;
  return { to, subject: `${title} — مدار`, text, html };
}
