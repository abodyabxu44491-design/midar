/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The official signature on the platform's email. The site and address lines appear only when the owner set them.
import { env } from "../../config/env.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function signatureLines(s = {}) {
  const site = s.site_url || env.PUBLIC_URL || null;
  return ["مدار | MIDAIR SCHOOL", "منصة لإدارة المؤسسات التعليمية",
    site ? `الموقع: ${site}` : null, s.email_info ? `البريد: ${s.email_info}` : null].filter(Boolean);
}
export const signatureText = (s) => `—\n${signatureLines(s).join("\n")}`;
export function signatureHtml(s) {
  const [name, line, ...rest] = signatureLines(s);
  return `<div style="border-top:1px solid #E3E7EC;margin-top:18px;padding-top:12px;color:#5F6B7A;font-size:13px;line-height:1.8">
<div style="color:#16244A;font-weight:bold;font-size:14px">${esc(name)}</div><div>${esc(line)}</div>${rest.map((l) => `<div dir="auto">${esc(l)}</div>`).join("")}</div>`;
}

// A plain message from the platform (a reply to an inquiry) in the platform's look, with the signature.
export function signedMail({ to, subject, body, settings }) {
  const paras = String(body).split(/\n{2,}/);
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F3F5F8;font-family:Tahoma,Arial,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E3E7EC">
<div style="background:#16244A;color:#fff;padding:16px 24px;font-size:19px;font-weight:bold">مدار <span style="font-size:12px;letter-spacing:3px;opacity:.8">SCHOOL</span></div>
<div style="padding:24px;color:#1A2233;line-height:1.9">${paras.map((p) => `<p style="margin:0 0 12px;white-space:pre-line">${esc(p)}</p>`).join("")}
${signatureHtml(settings)}</div></div></body></html>`;
  return { to, subject, text: `${body}\n\n${signatureText(settings)}`, html };
}
