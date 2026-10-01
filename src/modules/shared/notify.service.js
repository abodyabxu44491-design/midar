// مركز الإشعارات: مكان واحد تمر منه كل رسائل المدرسة لأولياء الأمور والمنسوبين
//   1) صندوق إشعارات داخل المنصة (يبقى في ملف الطالب أو لوحة المستخدم)
//   2) إشعار فوري على الجهاز (Web Push) لمن ثبّت التطبيق وسمح بالإشعارات
//   3) رسالة نصية SMS عبر مزوّد يضبطه المالك، برصيد رسائل لكل مدرسة
// المدرسة تختار لكل حدث: إشعار فوري، رسالة نصية، أو لا شيء. والإرسال يتم بعد نجاح المعاملة فقط.
import webpush from "web-push";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { transaction } from "../../core/db/pool.js";
import { deriveSecret, openSecret } from "../../core/auth/secret-box.js";
import { z } from "../../core/http/validate.js";
import { detectPhone } from "../../../public/shared/js/phone.js";
import { getModules, effectiveModules } from "./modules.service.js";
import { accessContext } from "./subscription.service.js";

/* ---------- الأحداث ---------- */
// audience: parent (ولي أمر الطالب) أو staff (حساب من المنسوبين). push/sms: الافتراضي
export const EVENTS = {
  absence:      { name: "غياب الطالب", audience: "parent", push: true, sms: false },
  late:         { name: "تأخر الطالب", audience: "parent", push: true, sms: false },
  grades:       { name: "نشر درجات", audience: "parent", push: true, sms: false },
  homework:     { name: "واجب جديد", audience: "parent", push: false, sms: false },
  invoice:      { name: "فاتورة جديدة أو قسط مستحق", audience: "parent", push: true, sms: false },
  payment:      { name: "استلام دفعة", audience: "parent", push: true, sms: false },
  announcement: { name: "تعميم جديد", audience: "parent", push: true, sms: false },
  alert:        { name: "تنبيه أو ملاحظة على الطالب", audience: "parent", push: true, sms: false },
  behavior:     { name: "السلوك (مخالفة أو إنجاز)", audience: "parent", push: true, sms: false },
  clinic:       { name: "زيارة العيادة", audience: "parent", push: true, sms: false },
  transport:    { name: "صعود ونزول الحافلة", audience: "parent", push: true, sms: false },
  online_exam:  { name: "اختبار إلكتروني متاح", audience: "parent", push: true, sms: false },
  certificate:  { name: "إصدار شهادة", audience: "parent", push: true, sms: false },
  survey:       { name: "استبيان جديد", audience: "both", push: true, sms: false },
  meeting:      { name: "مواعيد أولياء الأمور", audience: "both", push: true, sms: false },
  calendar:     { name: "فعالية في التقويم", audience: "both", push: false, sms: false },
  library:      { name: "تذكير إرجاع كتاب", audience: "parent", push: true, sms: false },
  leave:        { name: "قرار طلب الإجازة", audience: "staff", push: true, sms: false },
  substitute:   { name: "حصة انتظار", audience: "staff", push: true, sms: false },
  lesson_plan:  { name: "مراجعة تحضير الدروس", audience: "staff", push: true, sms: false },
};
export const rulesSchema = z.object(Object.fromEntries(Object.keys(EVENTS).map((k) =>
  [k, z.object({ push: z.boolean(), sms: z.boolean() }).partial()]))).partial();

const rulesCache = new WeakMap();
export async function getRules(q) {
  if (rulesCache.has(q)) return rulesCache.get(q);
  const [row] = await q("SELECT rules FROM school_notify WHERE tenant_id = app_tenant()");
  const saved = row?.rules || {};
  const rules = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, {
    push: saved[k]?.push ?? e.push, sms: saved[k]?.sms ?? e.sms }]));
  rulesCache.set(q, rules);
  return rules;
}
export async function updateRules(q, patch) {
  const cur = await getRules(q);
  for (const [k, v] of Object.entries(patch)) cur[k] = { ...cur[k], ...v };
  await q(`INSERT INTO school_notify (tenant_id, rules) VALUES (app_tenant(), $1)
           ON CONFLICT (tenant_id) DO UPDATE SET rules = EXCLUDED.rules`, [JSON.stringify(cur)]);
  rulesCache.set(q, cur);
  return cur;
}

// الأقسام الفعالة (مفعّلة ومشمولة في الاشتراك) مرة واحدة لكل معاملة
const modCache = new WeakMap();
export async function activeModules(q) {
  if (!modCache.has(q)) {
    const [toggles, ctx] = await Promise.all([getModules(q), accessContext(q)]);
    modCache.set(q, effectiveModules(toggles, ctx.entitled));
  }
  return modCache.get(q);
}

/* ---------- مفاتيح الإشعار الفوري ---------- */
let vapid = null;
export function vapidKeys() {
  if (vapid !== null) return vapid || null;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  } else {
    // مشتقة من مفتاح الخادم: ثابتة بين إعادة التشغيل، ولا تُخزَّن في قاعدة البيانات
    vapid = false;
    for (let i = 0; i < 4 && !vapid; i++) {
      const seed = deriveSecret(`web-push-vapid-v1:${i}`);
      if (!seed) break;
      try {
        const ecdh = crypto.createECDH("prime256v1");
        ecdh.setPrivateKey(seed);
        vapid = { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: seed.toString("base64url") };
      } catch { /* نادر جدًا: قيمة خارج نطاق المنحنى، نجرب التالية */ }
    }
  }
  if (vapid) webpush.setVapidDetails(env.PUBLIC_URL || "mailto:support@midar.app", vapid.publicKey, vapid.privateKey);
  return vapid || null;
}
export const pushPublicKey = () => vapidKeys()?.publicKey || null;

/* ---------- وسائل الإرسال (قابلة للاستبدال في الاختبارات) ---------- */
const realTransport = {
  async push(sub, payload) {
    if (!vapidKeys()) throw Object.assign(new Error("الإشعارات الفورية غير مهيأة"), { statusCode: 0 });
    return webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload), { TTL: 3 * 86400, urgency: payload.urgent ? "high" : "normal", timeout: 10_000 });
  },
  async sms(gateway, { to, message }) {
    const headers = gateway.headers ? JSON.parse(gateway.headers) : {};
    const fill = (tpl, enc) => tpl.replace(/\{(to|message|sender)\}/g, (_, k) => enc({ to, message, sender: gateway.sender }[k] ?? ""));
    let url = gateway.url, body;
    if (gateway.method === "GET") url = fill(gateway.url, encodeURIComponent);
    else if (gateway.content_type === "json") { body = fill(gateway.body_template, (v) => JSON.stringify(String(v)).slice(1, -1)); headers["Content-Type"] ||= "application/json"; }
    else { body = fill(gateway.body_template, encodeURIComponent); headers["Content-Type"] ||= "application/x-www-form-urlencoded"; }
    const res = await fetch(url, { method: gateway.method, headers, body, signal: AbortSignal.timeout(15_000) });
    const text = (await res.text()).slice(0, 2000);
    if (!res.ok) throw new Error(`رد المزوّد ${res.status}`);
    if (gateway.success_match && !text.includes(gateway.success_match)) throw new Error("رد المزوّد لا يدل على نجاح الإرسال");
    return true;
  },
};
let transport = realTransport;
export const setTransport = (t) => { transport = t ? { ...realTransport, ...t } : realTransport; };
// إرسال مباشر (رسالة المالك التجريبية)
export const sendRaw = (gateway, msg) => transport.sms(gateway, msg);

/* ---------- عدد أجزاء الرسالة النصية ---------- */
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
export function smsSegments(text) {
  const gsm = GSM.test(text);
  const len = [...text].length;
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return len <= single ? 1 : Math.ceil(len / multi);
}

export async function smsBalance(q) {
  const [r] = await q("SELECT COALESCE(sum(delta), 0)::int AS n FROM sms_ledger WHERE tenant_id = app_tenant()");
  return r.n;
}

/**
 * إرسال إشعار. يُستدعى داخل معاملة المدرسة (q).
 * @param {{ event: string, students?: number[], users?: number[], title: string, body?: string, link?: string, sms?: string, urgent?: boolean }} n
 * students: أولياء أمور هؤلاء الطلاب. users: حسابات منسوبين. sms: نص الرسالة النصية (افتراضيًا العنوان والنص)
 */
export async function notify(q, n) {
  const e = EVENTS[n.event];
  if (!e) throw new Error(`حدث غير معروف: ${n.event}`);
  const mods = await activeModules(q);
  if (!mods.notifications && !mods.sms) return { inbox: 0, sms: 0 };
  const students = [...new Set((n.students || []).map(Number))].filter(Boolean);
  const users = [...new Set((n.users || []).map(Number))].filter(Boolean);
  if (!students.length && !users.length) return { inbox: 0, sms: 0 };
  const rules = await getRules(q);
  const rule = rules[n.event];
  const title = String(n.title).slice(0, 140);
  const body = n.body ? String(n.body).slice(0, 1000) : null;

  // 1) صندوق الإشعارات + الإشعار الفوري
  let inbox = [];
  if (mods.notifications) {
    inbox = await q(
      `INSERT INTO notifications (tenant_id, student_id, user_id, kind, title, body, link)
       SELECT app_tenant(), s, NULL, $3, $4, $5, $6 FROM unnest($1::bigint[]) s WHERE EXISTS (SELECT 1 FROM students WHERE id = s)
       UNION ALL
       SELECT app_tenant(), NULL, u, $3, $4, $5, $6 FROM unnest($2::bigint[]) u WHERE EXISTS (SELECT 1 FROM users WHERE id = u)
       RETURNING id`, [students, users, n.event, title, body, n.link || null]);
  }
  const [{ tenant }] = await q("SELECT app_tenant() AS tenant");

  // 2) الرسائل النصية: لأولياء الأمور فقط، حسب اختيار المدرسة والرصيد
  let smsIds = [];
  if (mods.sms && rule?.sms && students.length) {
    smsIds = await queueSms(q, students, String(n.sms || [title, body].filter(Boolean).join(": ")), n.event);
  }

  const ids = inbox.map((r) => r.id);
  const urgent = Boolean(n.urgent);
  if ((ids.length && rule?.push) || smsIds.length) {
    q.afterCommit?.(() => deliver(tenant, { notificationIds: rule?.push ? ids : [], smsIds, urgent }));
  }
  return { inbox: ids.length, sms: smsIds.length };
}

/**
 * تجهيز رسائل نصية لأولياء أمور طلاب: تُحسب الأجزاء ويُحجز الرصيد الآن، وتُرسل بعد المعاملة.
 * @returns {Promise<number[]>} معرّفات الرسائل التي سترسل (الطلاب بلا رقم صحيح أو بلا رصيد لا يُرسل لهم)
 */
export async function queueSms(q, studentIds, rawText, kind) {
  const text = String(rawText).trim().slice(0, 600);
  if (!text) return [];
  const [{ dial }] = await q("SELECT COALESCE((SELECT country_code FROM school_messages WHERE tenant_id = app_tenant()), '967') AS dial");
  const rows = await q("SELECT id, guardian_phone FROM students WHERE id = ANY($1) AND guardian_phone IS NOT NULL", [studentIds]);
  const seg = smsSegments(text);
  let balance = await smsBalance(q);
  const ids = [];
  const seen = new Set();   // الإخوة لهم رقم واحد: رسالة واحدة لنفس الرقم ونفس النص
  for (const s of rows) {
    const ph = detectPhone(s.guardian_phone, dial);
    if (!ph?.intl || !/^[0-9]{8,15}$/.test(ph.intl) || seen.has(ph.intl)) continue;
    seen.add(ph.intl);
    const enough = balance >= seg;
    const [m] = await q(
      `INSERT INTO sms_messages (tenant_id, student_id, to_phone, body, kind, segments, status, error, created_by)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, current_setting('app.actor', true)) RETURNING id`,
      [s.id, ph.intl, text, kind, seg, enough ? "queued" : "no_credit", enough ? null : "رصيد الرسائل لا يكفي"]);
    if (!enough) continue;
    // حجز الرصيد الآن (يُعاد تلقائيًا إذا فشل الإرسال)
    await q("INSERT INTO sms_ledger (tenant_id, delta, reason, message_id, created_by) VALUES (app_tenant(), $1, 'رسالة نصية', $2, current_setting('app.actor', true))", [-seg, m.id]);
    balance -= seg;
    ids.push(m.id);
  }
  return ids;
}

/** رسالة نصية يدوية من الإدارة لمجموعة طلاب (تُرسل بعد المعاملة) */
export async function sendManualSms(q, studentIds, text) {
  const ids = await queueSms(q, studentIds, text, "manual");
  const [{ tenant }] = await q("SELECT app_tenant() AS tenant");
  if (ids.length) q.afterCommit?.(() => deliver(tenant, { smsIds: ids }));
  return ids.length;
}

/* ---------- التسليم (بعد المعاملة) ---------- */
export async function deliver(tenantId, { notificationIds = [], smsIds = [], urgent = false }) {
  const results = { push: 0, push_failed: 0, sms: 0, sms_failed: 0 };
  if (notificationIds.length) {
    const targets = await transaction({ tenantId, actor: "النظام" }, (q) => q(
      `SELECT n.id AS nid, n.kind, n.title, n.body, n.student_id, n.user_id, p.id AS sid, p.endpoint, p.p256dh, p.auth
         FROM notifications n
         JOIN push_subscriptions p ON (p.student_id = n.student_id OR p.user_id = n.user_id)
        WHERE n.id = ANY($1)`, [notificationIds]));
    const gone = [], failed = [], ok = [];
    for (const t of targets) {
      const url = t.student_id ? `/${tenantId}/student?s=${t.student_id}&n=${t.nid}#${t.kind}` : `/${tenantId}/idara`;
      try {
        await transport.push(t, { title: t.title, body: t.body || "", url, tag: `${t.kind}-${t.student_id || t.user_id}`, urgent });
        ok.push(t.sid); results.push++;
      } catch (err) {
        results.push_failed++;
        (err.statusCode === 404 || err.statusCode === 410 ? gone : failed).push(t.sid);
      }
    }
    await transaction({ tenantId, actor: "النظام" }, async (q) => {
      if (gone.length) await q("DELETE FROM push_subscriptions WHERE id = ANY($1)", [gone]);
      if (failed.length) await q("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ANY($1)", [failed]);
      await q("DELETE FROM push_subscriptions WHERE failures >= 8");
      if (ok.length) await q("UPDATE push_subscriptions SET failures = 0, last_sent_at = now() WHERE id = ANY($1)", [ok]);
    });
  }
  if (smsIds.length) {
    const gateway = await loadGateway();
    const msgs = await transaction({ tenantId, actor: "النظام" }, (q) => q("SELECT id, to_phone, body, segments FROM sms_messages WHERE id = ANY($1) AND status = 'queued'", [smsIds]));
    for (const m of msgs) {
      let error = null;
      if (!gateway) error = "مزوّد الرسائل غير مهيأ";
      else {
        try { await transport.sms(gateway, { to: m.to_phone, message: m.body }); } catch (err) { error = String(err.message || err).slice(0, 300); }
      }
      await transaction({ tenantId, actor: "النظام" }, (q) => q(
        "UPDATE sms_messages SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() END WHERE id = $1",
        [m.id, error ? (gateway ? "failed" : "disabled") : "sent", error]));
      if (error) {
        results.sms_failed++;
        // الرسالة لم تُرسل: يعود رصيدها للمدرسة
        await transaction({ platform: true, actor: "النظام" }, (q) => q(
          "INSERT INTO sms_ledger (tenant_id, delta, reason, message_id, created_by) VALUES ($1, $2, 'استرجاع رسالة لم تُرسل', $3, 'النظام')",
          [tenantId, m.segments, m.id]));
      } else results.sms++;
    }
  }
  return results;
}

/* ---------- مزوّد الرسائل ---------- */
export async function loadGateway() {
  const [g] = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT * FROM sms_gateway WHERE id = 1"));
  if (!g?.enabled || !g.url) return null;
  return { ...g, headers: g.headers_sealed ? openSecret(g.headers_sealed, "sms-gateway") : null };
}
