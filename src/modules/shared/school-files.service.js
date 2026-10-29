/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from "node:crypto";
import { transaction } from "../../core/db/pool.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { sealSecret, openSecret } from "../../core/auth/secret-box.js";
import { logEvent } from "../../core/audit.js";
import { qrDataUrl } from "./certificates.service.js";

export const LINK_DAYS = 7;
export const STAGES = [
  ["received", "استلام الطلب"], ["review", "المراجعة"], ["approved", "الاعتماد"],
  ["account", "إنشاء الحساب"], ["delivered", "إرسال رابط المدرسة"], ["first_login", "أول دخول للمدير"],
];
export const CHANNELS = { email: "البريد الإلكتروني", whatsapp: "واتساب", copy: "نسخ الرسالة", pdf: "ملف PDF", manual: "تسليم يدوي" };
export const DELIVERY = { sent: "تم التسليم", failed: "فشل", pending: "بانتظار التأكيد" };

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
export const addEvent = (q, tenantId, e, actor) => q(
  `INSERT INTO school_events (tenant_id, kind, channel, recipient, status, error, body, meta, actor)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
  [tenantId, e.kind, e.channel ?? null, e.recipient ?? null, e.status ?? null, e.error ?? null, e.body ?? null, e.meta ?? {}, actor]);

// The fields of a school file the owner may edit. Older values stay in the change log.
export const PROFILE_FIELDS = {
  contact_name: "اسم المسؤول", phone: "رقم الجوال", phone2: "رقم بديل", email: "البريد الإلكتروني", school_phone: "هاتف المدرسة",
  school_email: "بريد المدرسة", country: "الدولة", city: "المدينة", region: "المنطقة", address: "العنوان", org_type: "نوع المؤسسة",
  short_name: "الاسم المختصر", license_no: "رقم الترخيص", website: "الموقع", students_count: "عدد الطلاب", classes_count: "عدد الفصول",
  academic_year: "العام الدراسي", note: "ملاحظة الطلب",
};
export const profileSchema = z.object({
  name: t.shortText("اسم المدرسة", 150).optional(),
  ...Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, z.union([z.string().trim().max(300), z.number(), z.null()]).optional()])),
  stages: z.array(z.enum(["kg", "primary", "middle", "secondary"])).max(4).optional(),
});

const deliveryState = `(SELECT e.status FROM school_events e WHERE e.tenant_id = t.id AND e.kind = 'delivery' ORDER BY (e.status = 'sent') DESC, e.id DESC LIMIT 1)`;

export function stageOf(row) {
  if (row.activated_at) return "first_login";
  if (row.delivery === "sent") return "delivered";
  if (row.admin_id) return "account";
  if (row.approved_at) return "approved";
  if (row.lead_status === "reviewing") return "review";
  return "received";
}

export async function list(q, f = {}) {
  const params = [];
  const where = ["TRUE"];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  if (f.q) {
    add(`(t.name ILIKE '%' || ? || '%' OR t.id ILIKE '%' || ? || '%' OR t.profile->>'phone' LIKE '%' || ? || '%'
          OR t.profile->>'contact_name' ILIKE '%' || ? || '%' OR t.profile->>'email' ILIKE '%' || ? || '%')`, f.q);
  }
  if (f.status) add("t.status = ?", f.status);
  if (f.org_type) add("t.org_type_key = ?", f.org_type);
  const order = f.sort === "updated" ? "t.updated_at DESC" : f.sort === "oldest" ? "t.created_at ASC" : "t.created_at DESC";
  const rows = await q(
    `SELECT t.id, t.name, t.status, t.created_at, t.updated_at, t.approved_at, t.activated_at, t.is_demo, t.lead_id,
            t.org_type_key, o.name AS org_type_name,
            t.profile->>'contact_name' AS contact_name, t.profile->>'phone' AS phone, t.profile->>'email' AS email,
            l.status AS lead_status, s.plan_name, s.status AS sub_status, s.kind AS sub_kind,
            (SELECT count(*) FROM school_events e WHERE e.tenant_id = t.id AND e.kind IN ('account', 'activation_link', 'password')) > 0
              OR t.activated_at IS NOT NULL OR t.lead_id IS NULL AS admin_id,
            ${deliveryState} AS delivery,
            (SELECT max(e.created_at) FROM school_events e WHERE e.tenant_id = t.id AND e.kind = 'delivery') AS last_delivery_at
       FROM tenants t JOIN org_types o ON o.key = t.org_type_key LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN subscriptions s ON s.id = t.subscription_id
      WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 1000`, params);
  for (const r of rows) r.stage = stageOf(r);
  const pick = f.delivery ? rows.filter((r) => (f.delivery === "none" ? !r.delivery : r.delivery === f.delivery)) : rows;
  return f.stage ? pick.filter((r) => r.stage === f.stage) : pick;
}

export async function counts(q) {
  const [c] = await q(
    `SELECT (SELECT count(*) FROM tenants)::int AS schools,
            (SELECT count(*) FROM leads WHERE kind IN ('trial', 'subscription') AND tenant_id IS NULL AND status = 'new')::int AS new_requests,
            (SELECT count(*) FROM leads WHERE kind IN ('trial', 'subscription') AND tenant_id IS NULL AND status = 'reviewing')::int AS reviewing,
            (SELECT count(*) FROM tenants WHERE approved_at IS NOT NULL OR lead_id IS NULL)::int AS approved,
            (SELECT count(*) FROM tenants t WHERE ${deliveryState} IS NULL AND t.activated_at IS NULL)::int AS not_delivered,
            (SELECT count(*) FROM tenants t WHERE ${deliveryState} = 'failed')::int AS failed,
            (SELECT count(*) FROM tenants WHERE activated_at IS NOT NULL)::int AS activated,
            (SELECT count(*) FROM leads WHERE last_error IS NOT NULL AND tenant_id IS NULL)::int AS create_errors`);
  return c;
}

// Users are read inside the school's own scope (row-level security keeps them per school).
async function adminOf(q, tenantId) {
  const [u] = await transaction({ tenantId, actor: "النظام" }, (tq) => tq(
    `SELECT id, full_name, is_active, must_change_password, last_login_at, password_changed_at, phone, phone_verified_at
       FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`));
  return u || null;
}

// The current activation link, if one is still valid, decrypted so it can be shown again.
async function currentLink(q, tenantId, baseUrl) {
  const [a] = await q(`SELECT id, token_enc, expires_at, created_at, created_by, started_at, account_id, recovery FROM school_activations
                        WHERE tenant_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND created_by <> $2
                        ORDER BY id DESC LIMIT 1`, [tenantId, SELF_SETUP]);
  if (!a) return null;
  const token = a.token_enc ? openSecret(a.token_enc, `activation:${tenantId}`) : null;
  return { expires_at: a.expires_at, created_at: a.created_at, created_by: a.created_by, started_at: a.started_at,
    account_created: Boolean(a.account_id), recovery: a.recovery, url: token ? `${baseUrl}/activate?token=${token}` : null };
}

export async function getFile(q, id, baseUrl) {
  const [t] = await q(
    `SELECT t.*, (SELECT name FROM org_types WHERE key = t.org_type_key) AS org_type_name, s.plan_name, s.kind AS sub_kind, s.status AS sub_status, s.ends_on, s.starts_on, p.name AS lead_plan,
            l.status AS lead_status, l.kind AS lead_kind, l.created_at AS requested_at, l.details AS lead_details, l.handled_by
       FROM tenants t LEFT JOIN subscriptions s ON s.id = t.subscription_id LEFT JOIN leads l ON l.id = t.lead_id
       LEFT JOIN plans p ON p.id = l.plan_id WHERE t.id = $1`, [id]);
  if (!t) throw notFound("المدرسة غير موجودة");
  const admin = await adminOf(q, id);
  const events = await q("SELECT * FROM school_events WHERE tenant_id = $1 ORDER BY id DESC LIMIT 300", [id]);
  const delivery = events.find((e) => e.kind === "delivery" && e.status === "sent")?.status || events.find((e) => e.kind === "delivery")?.status || null;
  const stage = stageOf({ ...t, admin_id: admin?.id, delivery });
  const links = { login: `${baseUrl}/${id}/idara`, parents: `${baseUrl}/${id}` };
  links.login_qr = qrDataUrl(links.login);
  const activation = admin ? await currentLink(q, id, baseUrl) : null;
  // The manager's Midar account linked to this school (who, how, since when) — never any secret.
  const [account] = await q(
    `SELECT a.email, a.full_name, s.linked_via, s.linked_at, a.last_login_at FROM account_schools s JOIN accounts a ON a.id = s.account_id
      WHERE s.tenant_id = $1 AND s.revoked_at IS NULL ORDER BY s.linked_at DESC LIMIT 1`, [id]);
  // An open link shows its own progress (a recovery link first); otherwise the account's final state.
  // The manager enters first from the school's login link with the email recorded here; a recovery link exists
  // only to move an already linked school to another account.
  const sent = events.some((e) => e.kind === "delivery");
  const activationState = activation?.recovery ? "recovery"
    : account ? "activated"
      : !t.profile?.email ? "no_email"
        : sent ? "link_sent" : "waiting";
  return {
    school: { id: t.id, name: t.name, status: t.status, created_at: t.created_at, updated_at: t.updated_at, approved_at: t.approved_at,
      approved_by: t.approved_by, activated_at: t.activated_at, is_demo: t.is_demo, directory_code: t.directory_code, currency: t.currency,
      lead_id: t.lead_id, requested_at: t.requested_at || t.created_at, lead_status: t.lead_status, lead_kind: t.lead_kind, handled_by: t.handled_by,
      org_type: t.org_type, org_type_key: t.org_type_key, org_type_name: t.org_type_name },
    profile: { ...(t.lead_details || {}), ...t.profile },
    subscription: t.plan_name ? { plan_name: t.plan_name, kind: t.sub_kind, status: t.sub_status, starts_on: t.starts_on, ends_on: t.ends_on } : null,
    admin, activation, activation_state: activationState, account: account || null,
    links, stage, stages: STAGES, delivery, events,
  };
}

export async function updateProfile(q, id, b, actor) {
  const [t] = await q("SELECT id, name, profile FROM tenants WHERE id = $1 FOR UPDATE", [id]);
  if (!t) throw notFound("المدرسة غير موجودة");
  const next = { ...t.profile };
  const changes = [];
  for (const k of [...Object.keys(PROFILE_FIELDS), "stages"]) {
    if (b[k] === undefined) continue;
    const v = Array.isArray(b[k]) ? b[k] : b[k] === "" || b[k] === null ? null : String(b[k]);
    if (JSON.stringify(t.profile[k] ?? null) === JSON.stringify(v)) continue;
    changes.push({ field: k, label: PROFILE_FIELDS[k] || "المراحل", from: t.profile[k] ?? null, to: v });
    if (v === null) delete next[k]; else next[k] = v;
  }
  if (b.name && b.name !== t.name) changes.push({ field: "name", label: "اسم المدرسة", from: t.name, to: b.name });
  if (!changes.length) return { changed: 0 };
  await q("UPDATE tenants SET profile = $2, name = COALESCE($3, name) WHERE id = $1", [id, next, b.name || null]);
  await addEvent(q, id, { kind: "change", body: changes.map((c) => c.label).join("، "), meta: { changes } }, actor);
  return { changed: changes.length };
}

// Issues a new activation link and revokes the previous one, so only the latest link works.
export async function issueLink(q, id, actor, baseUrl) {
  const admin = await adminOf(q, id);
  if (!admin) throw badRequest("لا يوجد حساب مدير لهذه المدرسة بعد. أكمل إنشاء الحساب أولًا.");
  if (!admin.is_active) throw badRequest("حساب المدير موقوف. فعّله أولًا.");
  const [t] = await q("SELECT profile FROM tenants WHERE id = $1", [id]);
  const p = t?.profile || {};
  const m = p.manager || {};
  const manager = p.contact_name || [m.first, m.second, m.third, m.family].filter(Boolean).join(" ") || admin.full_name;
  await q("UPDATE school_activations SET revoked_at = now(), token_enc = NULL WHERE tenant_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [id]);
  // A school already linked to a manager's account gets a recovery link: completing it moves the school to the new account.
  const [{ linked }] = await q("SELECT EXISTS (SELECT 1 FROM account_schools WHERE tenant_id = $1 AND revoked_at IS NULL) AS linked", [id]);
  const token = crypto.randomBytes(32).toString("hex");
  const [a] = await q(
    `INSERT INTO school_activations (tenant_id, user_id, token_hash, token_enc, expires_at, created_by, phone, manager_name, recovery)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6, $7, $8, $9) RETURNING expires_at`,
    [id, admin.id, sha(token), sealSecret(token, `activation:${id}`), LINK_DAYS, actor, null, manager, linked]);
  await addEvent(q, id, linked
    ? { kind: "access_reset", body: `رابط استعادة وصول المدير صالح ${LINK_DAYS} أيام (الرابط السابق أُلغي)` }
    : { kind: "activation_link", body: `رابط إعداد حساب المدير صالح ${LINK_DAYS} أيام (الرابط السابق أُلغي)` }, actor);
  return { url: `${baseUrl}/activate?token=${token}`, expires_at: a.expires_at };
}

// An existing school's manager proved who they are with the school's current username and password:
// a short setup link (never shown to the owner) takes them straight to creating their Midar account.
// Returns null when the school is already linked to an account.
export const SELF_SETUP = "المدير — أول دخول";
const SELF_MINUTES = 30;
export async function selfSetupLink(tenantId, userId, ip) {
  return transaction({ platform: true, actor: SELF_SETUP, ip }, async (q) => {
    const [{ linked }] = await q("SELECT EXISTS (SELECT 1 FROM account_schools WHERE tenant_id = $1 AND revoked_at IS NULL) AS linked", [tenantId]);
    if (linked) return null;
    const [u] = await transaction({ tenantId, actor: "النظام" }, (tq) => tq("SELECT full_name FROM users WHERE id = $1", [userId]));
    await q("UPDATE school_activations SET revoked_at = now() WHERE tenant_id = $1 AND created_by = $2 AND used_at IS NULL AND revoked_at IS NULL", [tenantId, SELF_SETUP]);
    const token = crypto.randomBytes(32).toString("hex");
    await q(
      `INSERT INTO school_activations (tenant_id, user_id, token_hash, expires_at, created_by, manager_name, recovery)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5, $6, false)`,
      [tenantId, userId, sha(token), SELF_MINUTES, SELF_SETUP, u?.full_name || null]);
    await addEvent(q, tenantId, { kind: "activation_link", body: "دخل المدير ببياناته السابقة وبدأ إنشاء حساب مدار" }, SELF_SETUP);
    return { url: `/activate?token=${token}` };
  });
}

// Stops any open activation link (lost phone, wrong recipient). A new link can be issued afterwards.
export async function revokeLinks(q, id, actor) {
  const rows = await q("UPDATE school_activations SET revoked_at = now(), token_enc = NULL WHERE tenant_id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id", [id]);
  if (!rows.length) throw badRequest("لا يوجد رابط تفعيل مفتوح لإلغائه.");
  await addEvent(q, id, { kind: "activation_link", body: "أُلغي رابط التفعيل المفتوح ولم يعد صالحًا" }, actor);
  await logEvent(q, { actor, action: `إلغاء رابط تفعيل ${id}` });
  return { revoked: rows.length };
}

export async function recordDelivery(q, id, b, actor) {
  const [row] = await addEvent(q, id, { kind: "delivery", channel: b.channel, recipient: b.recipient ?? null, status: b.status,
    error: b.error ?? null, body: b.body ?? null }, actor);
  await logEvent(q, { actor, action: `تسليم بيانات دخول ${id} عبر ${CHANNELS[b.channel]}: ${DELIVERY[b.status]}` });
  return row;
}

export async function setDelivery(q, id, eventId, status, error, actor) {
  const rows = await q(`UPDATE school_events SET status = $3, error = $4, updated_at = now(), meta = meta || jsonb_build_object('confirmed_by', $5::text)
                         WHERE id = $2 AND tenant_id = $1 AND kind = 'delivery' RETURNING id`, [id, eventId, status, error ?? null, actor]);
  if (!rows.length) throw notFound("عملية الإرسال غير موجودة");
}

export async function setStatus(q, id, status, reason, actor) {
  const rows = await q(`UPDATE tenants SET status = $2, auto_suspended_at = CASE WHEN $2 = 'active' THEN NULL ELSE auto_suspended_at END
                         WHERE id = $1 RETURNING id`, [id, status]);
  if (!rows.length) throw notFound("المدرسة غير موجودة");
  if (status !== "active") await q("DELETE FROM sessions WHERE tenant_id = $1", [id]);
  await addEvent(q, id, { kind: "status", body: `${status === "active" ? "أُعيد تفعيل حساب المدرسة" : "أُوقف حساب المدرسة مؤقتًا"}${reason ? `: ${reason}` : ""}` }, actor);
  await logEvent(q, { actor, action: `${status === "active" ? "إعادة تفعيل" : "إيقاف"} المدرسة ${id}` });
}

export async function uniqueSchoolCode(q, name) {
  const { schoolCodeFrom } = await import("../../../public/shared/js/school-code.js");
  const { RESERVED_CODES } = await import("../../core/reserved.js");
  const base = schoolCodeFrom(name);
  for (let i = 1; i < 200; i++) {
    const code = i === 1 ? base : `${base.slice(0, 26)}-${i}`;
    if (RESERVED_CODES.has(code)) continue;
    const [taken] = await q("SELECT 1 FROM tenants WHERE id = $1 UNION ALL SELECT 1 FROM school_groups WHERE id = $1", [code]);
    if (!taken) return code;
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36).slice(-5)}`;
}

