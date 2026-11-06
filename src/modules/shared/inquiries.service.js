/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Inquiries the platform receives, from the site's forms or by email (Cloudflare Email Routing hands each received
// message to the platform through the email Worker), each with its status and a log of what was done about it.
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { deriveSecret } from "../../core/auth/secret-box.js";
import { kickOwnerPush } from "./alerts.service.js";
import { loadMail, sendMail, noticeMail } from "./mail.service.js";
import { transaction } from "../../core/db/pool.js";
import { background } from "../../core/platform.js";

export const KINDS = { general: "استفسار عام", support: "دعم فني", sales: "اشتراك ومبيعات", complaint: "شكوى", admin: "مراسلة إدارية", other: "أخرى" };
export const STATUSES = { new: "جديد", in_progress: "قيد المعالجة", replied: "تم الرد", closed: "مغلق" };
// The mailbox a message was sent to tells what it is about.
const BY_ADDRESS = { info: "general", support: "support", sales: "sales", admin: "admin" };

// A form opened on the site carries a signed time: a submission sooner than a person could type, or one with an
// expired or forged stamp, is refused. Together with a hidden field that people never fill in, this stops most bots.
const formKey = () => deriveSecret("inquiry-form") || Buffer.from("midar-inquiry-form-fallback");
export function formToken(now = Date.now()) {
  const t = String(now);
  return `${t}.${crypto.createHmac("sha256", formKey()).update(t).digest("base64url").slice(0, 22)}`;
}
export function formTokenProblem(token, now = Date.now()) {
  const [t, sig] = String(token || "").split(".");
  if (!t || !sig) return "أعد فتح النموذج وأرسل مرة أخرى";
  const want = crypto.createHmac("sha256", formKey()).update(t).digest("base64url").slice(0, 22);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return "أعد فتح النموذج وأرسل مرة أخرى";
  const age = now - Number(t);
  if (!(age >= 3000)) return "أُرسل النموذج بسرعة غير معتادة. انتظر لحظة ثم أرسل";
  if (age > 6 * 3600_000) return "انتهت صلاحية النموذج. أعد فتح الصفحة وأرسل";
  return null;
}

// --- Email received through the email Worker. ------------------------------------------------------------------------
// The Worker signs the JSON body with the shared secret; the platform accepts nothing else on this route.
export function inboundSignatureOk(raw, signature) {
  if (!env.INBOUND_EMAIL_SECRET) return false;
  const want = crypto.createHmac("sha256", env.INBOUND_EMAIL_SECRET).update(raw).digest("hex");
  const got = String(signature || "").replace(/^sha256=/, "");
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const atLeast = (v, n, empty) => (!v ? empty : v.length >= n ? v : v.padEnd(n, "…"));
export function fromEmail(m) {
  const to = clean(m.to, 200).toLowerCase();
  const local = to.split("@")[0];
  const fromAddr = clean(m.from, 200).toLowerCase();
  const name = clean(m.from_name, 120) || fromAddr.split("@")[0] || "مرسل";
  return {
    kind: BY_ADDRESS[local] || "general",
    name: atLeast(name, 2, "مرسل"),
    email: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(fromAddr) ? fromAddr : null,
    subject: atLeast(clean(m.subject, 200), 3, "(بلا عنوان)"),
    body: atLeast(clean(m.text, 10000), 5, "(رسالة بلا نص)"),
    to_address: to || null,
    message_id: clean(m.message_id, 300) || null,
  };
}

export async function recordEmail(m) {
  const x = fromEmail(m);
  if (!x.email) return { ignored: "no-sender" };
  const id = await transaction({ platform: true, actor: "البريد الوارد" }, async (q) => {
    const [row] = await q(
      `INSERT INTO inquiries (channel, kind, name, email, subject, body, to_address, message_id)
       VALUES ('email', $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (message_id) DO NOTHING RETURNING id`,
      [x.kind, x.name, x.email, x.subject, x.body, x.to_address, x.message_id]);
    if (!row) return null;
    await q("INSERT INTO inquiry_events (inquiry_id, kind, body, actor) VALUES ($1, 'received', $2, 'البريد الوارد')",
      [row.id, `بريد إلى ${x.to_address || "عنوان المنصة"}`]);
    return row.id;
  });
  if (!id) return { duplicate: true };
  notifyNew(id);
  return { id: Number(id) };
}

// The owner's devices hear about a new inquiry at once; and by email too when an outgoing mail service is set up and
// the owner left the notice on. A failure to notify never loses the inquiry, it is only written to the log.
export function notifyNew(id) {
  kickOwnerPush();
  background(emailOwner(id).catch((e) => console.error("[الاستفسارات] تعذر إشعار البريد:", String(e.message || e).slice(0, 160))));
}
async function emailOwner(id) {
  if (!(await loadMail())) return;
  const [s] = await transaction({ platform: true, actor: "النظام" }, (q) =>
    q("SELECT email_admin, brand_email, inquiry_notify FROM platform_settings WHERE id"));
  const to = s?.email_admin || s?.brand_email || env.OWNER_ALERT_EMAIL;
  if (!s?.inquiry_notify || !to) return;
  const [x] = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT * FROM inquiries WHERE id = $1", [id]));
  if (!x) return;
  await sendMail(noticeMail({ to, title: `رسالة جديدة #${x.id}: ${x.subject}`,
    lines: [`النوع: ${KINDS[x.kind]}`, `من: ${x.name}${x.email ? ` <${x.email}>` : ""}${x.phone ? ` — ${x.phone}` : ""}`,
      x.organization ? `المؤسسة: ${x.organization}` : "", "", x.body.slice(0, 1500), "", "تابعها من لوحة المالك ← صندوق الرسائل."].filter((l) => l !== null) }));
  await transaction({ platform: true, actor: "النظام" }, (q) =>
    q("INSERT INTO inquiry_events (inquiry_id, kind, body, actor) VALUES ($1, 'notify', $2, 'النظام')", [id, `أُرسل إشعار إلى ${to}`]));
}
