// مركز الإشعارات: مكان واحد تمر منه كل رسائل المدرسة لأولياء الأمور والمنسوبين
//   1) صندوق إشعارات داخل المنصة (يبقى في ملف الطالب أو لوحة المستخدم)
//   2) إشعار فوري على الجهاز (Web Push) لمن ثبّت التطبيق وسمح بالإشعارات
//   3) رسالة نصية SMS: عبر بوابة المدرسة الخاصة (جوالها بشريحتها، بلا رصيد ولا تكلفة على المنصة)
//      أو عبر مزوّد يضبطه المالك برصيد رسائل لكل مدرسة
//   4) قائمة إرسال واتساب: رسائل جاهزة يرسلها الإداري من جواله واحدة تلو الأخرى (مجانًا)
// المدرسة تختار لكل حدث: إشعار فوري، رسالة نصية، واتساب، أو لا شيء. والإرسال يتم بعد نجاح المعاملة فقط.
import webpush from "web-push";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { transaction } from "../../core/db/pool.js";
import { deriveSecret, openSecret, sealSecret } from "../../core/auth/secret-box.js";
import { z } from "../../core/http/validate.js";
import { detectPhone } from "../../../public/shared/js/phone.js";
import { getModules, effectiveModules } from "./modules.service.js";
import { accessContext } from "./subscription.service.js";

/* ---------- الأحداث ---------- */
// كل حدث في المنصة يمر من هنا، والمحرك يقرر: من يستلم، وبأي أولوية، وهل يصل للجوال، وهل يُدمج مع إشعار سابق.
//   audience: parent (ولي أمر الطالب/الطالب نفسه في ملفه) أو staff (حساب من المنسوبين) أو both
//   category: تصنيف مركز الإشعارات. topic: ما يتحكم فيه ولي الأمر من «إعدادات الإشعارات»
//   priority: 1 عاجل، 2 مهم، 3 عادي. optIn: لا يُنشأ أصلًا إلا إذا فعّلته المدرسة (أحداث كثيرة التكرار)
//   collapse: إشعار عام (إعلان، تقويم…) يصل الجهاز مرة واحدة حتى لو كان لولي الأمر أكثر من ابن
export const EVENTS = {
  absence:      { name: "غياب الطالب", audience: "parent", push: true, sms: false, category: "attendance", topic: "absence", priority: 1 },
  late:         { name: "تأخر الطالب", audience: "parent", push: true, sms: false, category: "attendance", topic: "late", priority: 2 },
  departure:    { name: "انصراف الطالب من المدرسة (البوابة)", audience: "parent", push: true, sms: false, category: "attendance", topic: "present", priority: 3 },
  arrival:      { name: "وصول الطالب للمدرسة (بوابة الحضور)", audience: "parent", push: true, sms: false, category: "attendance", topic: "present", priority: 3 },
  present:      { name: "حضور الطالب", audience: "parent", push: false, sms: false, category: "attendance", topic: "present", priority: 3, optIn: true },
  grades:       { name: "درجة جديدة أو نتيجة اختبار", audience: "parent", push: true, sms: false, category: "grades", topic: "grades", priority: 2 },
  online_exam:  { name: "اختبار إلكتروني متاح", audience: "parent", push: true, sms: false, category: "exams", topic: "exams", priority: 2 },
  exam_result:  { name: "نتيجة الاختبار الإلكتروني", audience: "parent", push: true, sms: false, category: "exams", topic: "exams", priority: 2 },
  certificate:  { name: "نشر الشهادة أو كشف الدرجات", audience: "parent", push: true, sms: false, category: "grades", topic: "grades", priority: 2 },
  homework:     { name: "واجب جديد", audience: "parent", push: true, sms: false, category: "homework", topic: "homework", priority: 3 },
  homework_due: { name: "قرب موعد تسليم الواجب", audience: "parent", push: true, sms: false, category: "homework", topic: "homework", priority: 3 },
  homework_missing: { name: "لم يسلّم الطالب الواجب", audience: "parent", push: true, sms: false, category: "homework", topic: "homework", priority: 2 },
  invoice:      { name: "فاتورة جديدة أو قسط مستحق", audience: "parent", push: true, sms: false, category: "finance", topic: "finance", priority: 2 },
  overdue:      { name: "مبلغ متأخر السداد", audience: "parent", push: true, sms: false, category: "finance", topic: "finance", priority: 2 },
  payment:      { name: "تسجيل دفعة وإصدار إيصال", audience: "parent", push: true, sms: false, category: "finance", topic: "finance", priority: 3 },
  announcement: { name: "إعلان أو تعميم من المدرسة", audience: "parent", push: true, sms: false, category: "announcements", topic: "announcements", priority: 3, collapse: true },
  message:      { name: "رسالة من المدرسة", audience: "both", push: true, sms: false, category: "messages", topic: "messages", priority: 2, collapse: true },
  alert:        { name: "ملاحظة أو تنبيه من المعلم", audience: "parent", push: true, sms: false, category: "messages", topic: "messages", priority: 2 },
  timetable:    { name: "تغيير الجدول الدراسي", audience: "both", push: true, sms: false, category: "timetable", topic: "timetable", priority: 3, collapse: true },
  behavior:     { name: "السلوك (مخالفة أو إنجاز)", audience: "parent", push: true, sms: false, category: "messages", topic: "behavior", priority: 2 },
  clinic:       { name: "زيارة العيادة", audience: "parent", push: true, sms: false, category: "messages", topic: "services", priority: 2 },
  transport:    { name: "صعود ونزول الحافلة", audience: "parent", push: true, sms: false, category: "attendance", topic: "services", priority: 3 },
  survey:       { name: "استبيان جديد", audience: "both", push: true, sms: false, category: "announcements", topic: "announcements", priority: 3, collapse: true },
  meeting:      { name: "مواعيد أولياء الأمور", audience: "both", push: true, sms: false, category: "messages", topic: "messages", priority: 2 },
  calendar:     { name: "فعالية في التقويم", audience: "both", push: false, sms: false, category: "announcements", topic: "announcements", priority: 3, collapse: true },
  library:      { name: "تذكير إرجاع كتاب", audience: "parent", push: true, sms: false, category: "messages", topic: "services", priority: 3 },
  leave:        { name: "قرار طلب الإجازة", audience: "staff", push: true, sms: false, category: "tasks", topic: "tasks", priority: 2 },
  substitute:   { name: "حصة انتظار (تكليف)", audience: "staff", push: true, sms: false, category: "tasks", topic: "tasks", priority: 2 },
  lesson_plan:  { name: "مراجعة تحضير الدروس", audience: "staff", push: true, sms: false, category: "tasks", topic: "tasks", priority: 3 },
  grades_review: { name: "اعتماد الدرجات أو إعادتها", audience: "staff", push: true, sms: false, category: "grades", topic: "tasks", priority: 2 },
  request:      { name: "طلبات جديدة للإدارة (تسجيل، إجازة)", audience: "staff", push: true, sms: false, category: "requests", topic: "requests", priority: 2 },
  gate:         { name: "بوابة الحضور (مراجعة الغياب، أجهزة البوابة)", audience: "staff", push: true, sms: false, category: "tasks", topic: "tasks", priority: 2 },
  system:       { name: "تنبيهات النظام (اكتمال استيراد أو خطأ)", audience: "staff", push: true, sms: false, category: "system", topic: "system", priority: 3 },
};

// ما يراه ولي الأمر في «إعدادات الإشعارات» (والمنسوب في إعداداته)
export const TOPICS = {
  parent: { absence: "الغياب", late: "التأخر", present: "الحضور", grades: "الدرجات والشهادات", exams: "الاختبارات", homework: "الواجبات",
    announcements: "الإعلانات", messages: "الرسائل والملاحظات", finance: "المالية", timetable: "الجدول", behavior: "السلوك", services: "العيادة والحافلة والمكتبة" },
  staff: { tasks: "التكليفات والمهام", requests: "الطلبات", messages: "الرسائل", announcements: "الإعلانات", timetable: "الجدول", grades: "الدرجات", system: "تنبيهات النظام" },
};
// تصنيفات مركز الإشعارات (أزرار التصفية)
export const CATEGORIES = { attendance: "الحضور", grades: "الدرجات", homework: "الواجبات", exams: "الاختبارات", finance: "المالية",
  announcements: "الإعلانات", messages: "الرسائل", timetable: "الجدول", tasks: "المهام", requests: "الطلبات", system: "النظام", other: "أخرى" };
const staffTopic = (e) => (e.audience === "staff" ? e.topic : ({ grades: "grades", exams: "grades", homework: "tasks", announcements: "announcements",
  messages: "messages", timetable: "timetable" }[e.topic] || "announcements"));

export const rulesSchema = z.object(Object.fromEntries(Object.keys(EVENTS).map((k) =>
  [k, z.object({ push: z.boolean(), sms: z.boolean(), wa: z.boolean(), mandatory: z.boolean() }).partial()]))).partial();

const rulesCache = new WeakMap();
export async function getRules(q) {
  if (rulesCache.has(q)) return rulesCache.get(q);
  const [row] = await q("SELECT rules FROM school_notify WHERE tenant_id = app_tenant()");
  const saved = row?.rules || {};
  const rules = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, {
    push: saved[k]?.push ?? e.push, sms: saved[k]?.sms ?? e.sms, wa: saved[k]?.wa ?? false,
    mandatory: saved[k]?.mandatory ?? (k === "absence") }]));
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

/* ---------- ساعات الهدوء (إعداد المدرسة) ---------- */
const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "الوقت بصيغة 22:00");
export const quietSchema = z.object({ quiet_start: hhmm.nullable(), quiet_end: hhmm.nullable() })
  .refine((v) => (v.quiet_start === null) === (v.quiet_end === null), "حدد البداية والنهاية معًا أو اتركهما فارغين");
export async function getQuiet(q) {
  const [r] = await q("SELECT to_char(quiet_start, 'HH24:MI') AS quiet_start, to_char(quiet_end, 'HH24:MI') AS quiet_end, timezone FROM school_notify WHERE tenant_id = app_tenant()");
  return { quiet_start: r?.quiet_start ?? null, quiet_end: r?.quiet_end ?? null, timezone: r?.timezone || "Asia/Aden" };
}
export async function setQuiet(q, b) {
  await q(`INSERT INTO school_notify (tenant_id, quiet_start, quiet_end) VALUES (app_tenant(), $1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end`, [b.quiet_start, b.quiet_end]);
  return getQuiet(q);
}
/** كم دقيقة حتى تنتهي ساعات الهدوء الآن (0 = خارجها). تعمل مع الفترات التي تعبر منتصف الليل */
export function quietDelayMinutes({ quiet_start, quiet_end, timezone }, now = new Date()) {
  if (!quiet_start || !quiet_end || quiet_start === quiet_end) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "Asia/Aden", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const cur = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const a = m(quiet_start), b = m(quiet_end);
  const inside = a < b ? cur >= a && cur < b : cur >= a || cur < b;
  return inside ? (b - cur + 1440) % 1440 : 0;
}

/* ---------- اختيارات المستلم ---------- */
export const prefsSchema = z.object({ muted: z.array(z.string().regex(/^[a-z_]{2,20}$/)).max(30) });
const prefCol = (target) => (target.student_id ? "student_id" : "user_id");
export async function getPrefs(q, target) {
  const col = prefCol(target);
  const [r] = await q(`SELECT muted FROM notification_prefs WHERE ${col} = $1`, [target.student_id || target.user_id]);
  const rules = await getRules(q);
  const aud = target.student_id ? "parent" : "staff";
  const topics = TOPICS[aud];
  // الموضوع «إلزامي» إذا كانت كل أحداثه إلزامية (لا يمكن كتمه). «بعضه إلزامي» يُكتم غير الإلزامي فقط
  const topicOf = (e) => (aud === "parent" ? e.topic : staffTopic(e));
  const info = Object.fromEntries(Object.keys(topics).map((t) => {
    const evs = Object.entries(EVENTS).filter(([, e]) => (aud === "parent" ? e.audience !== "staff" : e.audience !== "parent") && topicOf(e) === t);
    const mand = evs.filter(([k]) => rules[k]?.mandatory).length;
    return [t, { name: topics[t], mandatory: evs.length > 0 && mand === evs.length, partly_mandatory: mand > 0 && mand < evs.length, events: evs.length }];
  }).filter(([, v]) => v.events > 0));
  return { muted: (r?.muted || []).filter((t) => info[t]), topics: info };
}
export async function setPrefs(q, target, { muted }) {
  const col = prefCol(target);
  const allowed = Object.keys(TOPICS[target.student_id ? "parent" : "staff"]);
  const clean = [...new Set(muted)].filter((t) => allowed.includes(t));
  await q(`INSERT INTO notification_prefs (tenant_id, ${col}, muted) VALUES (app_tenant(), $1, $2)
           ON CONFLICT (tenant_id, COALESCE(student_id, 0), COALESCE(user_id, 0)) DO UPDATE SET muted = EXCLUDED.muted`,
    [target.student_id || target.user_id, clean]);
  return getPrefs(q, target);
}

/** حسابات الإدارة (لإشعارات الطلبات والنظام) */
export async function adminUserIds(q) {
  return (await q("SELECT id FROM users WHERE role = 'admin' AND is_active")).map((u) => u.id);
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
      JSON.stringify(payload), { TTL: payload.priority === 1 ? 86400 : 3 * 86400, urgency: payload.priority === 1 ? "high" : "normal", timeout: 10_000 });
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
 * إرسال إشعار: نقطة الدخول الوحيدة لكل الأحداث. يُستدعى داخل معاملة المدرسة (q)، ولا يُرسل شيء إلا بعد نجاحها.
 * @param {{ event: string, students?: number[], users?: number[], title: string, body?: string, link?: string, sms?: string,
 *           urgent?: boolean, priority?: 1|2|3, dedupKey?: string, dedupMinutes?: number }} n
 * students: أولياء أمور هؤلاء الطلاب (كل طالب يصل لأجهزة ولي أمره فقط). users: حسابات منسوبين.
 * dedupKey: نفس المفتاح لنفس المستلم خلال dedupMinutes يحدّث الإشعار السابق بدل إنشاء جديد (لا تنبيه مكرر).
 */
export async function notify(q, n) {
  const e = EVENTS[n.event];
  if (!e) throw new Error(`حدث غير معروف: ${n.event}`);
  const none = { inbox: 0, merged: 0, push: 0, sms: 0, wa: 0 };
  const mods = await activeModules(q);
  if (!mods.notifications && !mods.sms && !mods.messaging) return none;
  const students = [...new Set((n.students || []).map(Number))].filter(Boolean);
  const users = [...new Set((n.users || []).map(Number))].filter(Boolean);
  if (!students.length && !users.length) return none;
  const rules = await getRules(q);
  const rule = rules[n.event];
  if (e.optIn && !rule.push && !rule.sms && !rule.wa) return none;
  const title = String(n.title).slice(0, 140);
  const body = n.body ? String(n.body).slice(0, 1000) : null;
  const priority = n.urgent ? 1 : (n.priority ?? e.priority ?? 3);
  // منع التكرار: مفتاح صريح (تعديل نفس الشيء) أو تلقائي (نفس النص لنفس المستلم خلال دقيقتين)
  const dedupKey = n.dedupKey ? `${n.event}:${n.dedupKey}`.slice(0, 200)
    : `${n.event}:${crypto.createHash("sha1").update(`${title}\n${body || ""}`).digest("base64url").slice(0, 16)}`;
  const windowMin = n.dedupKey ? (n.dedupMinutes ?? 15) : 2;

  // 1) مركز الإشعارات (داخل المنصة): يبقى دائمًا حتى لو لم يصل الإشعار للجوال
  let ids = [], merged = 0, freshStudents = students;
  if (mods.notifications) {
    // إشعار سابق لنفس الحدث ونفس المستلم خلال المدة: يُحدَّث ويعود غير مقروء، ولا يُنشأ تنبيه جديد
    const upd = await q(
      `UPDATE notifications SET title = $4, body = $5, link = $6, priority = LEAST(priority, $7::smallint), repeats = repeats + 1,
              updated_at = now(), read_at = NULL, archived_at = NULL
        WHERE dedup_key = $3 AND created_at > now() - make_interval(mins => $8)
          AND (student_id = ANY($1::bigint[]) OR user_id = ANY($2::bigint[]))
       RETURNING student_id, user_id`, [students, users, dedupKey, title, body, n.link || null, priority, windowMin]);
    merged = upd.length;
    const doneS = new Set(upd.filter((r) => r.student_id).map((r) => Number(r.student_id)));
    const doneU = new Set(upd.filter((r) => r.user_id).map((r) => Number(r.user_id)));
    const freshS = students.filter((s) => !doneS.has(s)), freshU = users.filter((u) => !doneU.has(u));
    freshStudents = freshS;
    if (freshS.length || freshU.length) {
      ids = (await q(
        `INSERT INTO notifications (tenant_id, student_id, user_id, kind, title, body, link, priority, category, dedup_key, created_by)
         SELECT app_tenant(), s, NULL::bigint, $3::text, $4::text, $5::text, $6::text, $7::smallint, $8::text, $9::text, NULLIF(current_setting('app.actor', true), '')
           FROM unnest($1::bigint[]) s WHERE EXISTS (SELECT 1 FROM students WHERE id = s)
         UNION ALL
         SELECT app_tenant(), NULL::bigint, u, $3::text, $4::text, $5::text, $6::text, $7::smallint, $8::text, $9::text, NULLIF(current_setting('app.actor', true), '')
           FROM unnest($2::bigint[]) u WHERE EXISTS (SELECT 1 FROM users WHERE id = u AND is_active)
         RETURNING id`, [freshS, freshU, n.event, title, body, n.link || null, priority, e.category, dedupKey])).map((r) => r.id);
    }
  }

  // 2) الإشعار على الجوال: طابور تسليم لكل جهاز نشط للمستلم، حسب اختيار المدرسة واختيار المستلم
  let push = 0;
  if (ids.length && rule.push && mods.notifications) push = await queuePush(q, ids, { event: n.event, e, rule, priority });

  // 3) الرسائل النصية: لأولياء الأمور فقط، حسب اختيار المدرسة والرصيد (لا تتكرر عند الدمج)
  let smsIds = [];
  if (mods.sms && rule?.sms && freshStudents.length) {
    smsIds = await queueSms(q, freshStudents, String(n.sms || [title, body].filter(Boolean).join(": ")), n.event);
  }

  // 4) قائمة واتساب: تُجهّز الرسائل ليرسلها الإداري من جواله (مجانًا)
  let wa = 0;
  if (mods.messaging && rule?.wa && freshStudents.length) {
    wa = await queueWhatsApp(q, freshStudents, [title, body].filter(Boolean).join("\n"), n.event);
  }

  const [{ tenant }] = await q("SELECT app_tenant() AS tenant");
  if (push) q.afterCommit?.(() => kickDeliveries());
  if (smsIds.length) q.afterCommit?.(() => deliver(tenant, { smsIds }));
  return { inbox: ids.length, merged, push, sms: smsIds.length, wa };
}

// حد الإشعارات على الجوال لكل مستلم في الساعة (غير العاجلة). الزائد يبقى في مركز الإشعارات فقط
export const PUSH_HOURLY_LIMIT = 30;

/** إضافة الإشعارات لطابور التسليم: جهاز × إشعار، مع اختيارات المستلم وساعات الهدوء وحد الإرسال والتجميع */
async function queuePush(q, ids, { event, e, rule, priority }) {
  const quiet = priority > 1 ? quietDelayMinutes(await getQuiet(q)) : 0;
  const topic = e.topic, sTopic = staffTopic(e);
  const rows = await q(
    `WITH target AS (
       SELECT n.id AS nid, n.student_id, n.user_id, p.id AS sid, p.endpoint
         FROM notifications n
         JOIN push_subscriptions p ON (p.student_id = n.student_id OR p.user_id = n.user_id)
         LEFT JOIN notification_prefs np ON (np.student_id = n.student_id OR np.user_id = n.user_id)
        WHERE n.id = ANY($1)
          AND ($4 OR np.id IS NULL OR NOT (CASE WHEN n.student_id IS NOT NULL THEN $5 ELSE $6 END = ANY(np.muted)))
     ), picked AS (
       -- إشعار عام لأكثر من ابن على نفس الجهاز: تنبيه واحد فقط
       SELECT DISTINCT ON (CASE WHEN $7 THEN endpoint ELSE sid::text || ':' || nid::text END) * FROM target ORDER BY
         CASE WHEN $7 THEN endpoint ELSE sid::text || ':' || nid::text END, nid
     ), recent AS (
       SELECT COALESCE(n.student_id, 0) AS st, COALESCE(n.user_id, 0) AS us, count(*)::int AS c
         FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE d.created_at > now() - interval '1 hour' AND d.status <> 'skipped' AND n.priority > 1
          AND (n.student_id IN (SELECT student_id FROM picked) OR n.user_id IN (SELECT user_id FROM picked))
        GROUP BY 1, 2
     )
     INSERT INTO notification_deliveries (tenant_id, notification_id, subscription_id, device, status, error, next_attempt_at)
     SELECT app_tenant(), p.nid, p.sid, substring(p.endpoint FROM '^https://([^/]+)'),
            CASE WHEN $2 > 1 AND COALESCE(r.c, 0) >= $8 THEN 'skipped' ELSE 'pending' END,
            CASE WHEN $2 > 1 AND COALESCE(r.c, 0) >= $8 THEN 'تجاوز حد الإشعارات في الساعة (بقي في مركز الإشعارات)' END,
            now() + make_interval(mins => $3)
       FROM picked p LEFT JOIN recent r ON r.st = COALESCE(p.student_id, 0) AND r.us = COALESCE(p.user_id, 0)
     ON CONFLICT DO NOTHING
     RETURNING status`,
    [ids, priority, quiet, Boolean(rule.mandatory), topic, sTopic, Boolean(e.collapse), PUSH_HOURLY_LIMIT]);
  return rows.filter((r) => r.status === "pending").length;
}

/**
 * إضافة رسائل لقائمة واتساب: رسالة لكل رقم (الإخوة رقم واحد)، ولا تكرار لنفس النص المنتظر.
 * vars: دالة اختيارية تعطي نص كل طالب (للرسائل بمتغيرات). @returns عدد الرسائل المضافة
 */
export async function queueWhatsApp(q, studentIds, text, kind, { perStudent = null } = {}) {
  const [{ dial, school }] = await q(`SELECT COALESCE((SELECT country_code FROM school_messages WHERE tenant_id = app_tenant()), '967') AS dial,
                                             (SELECT name FROM tenants WHERE id = app_tenant()) AS school`);
  const rows = await q(`SELECT s.id, s.full_name, s.guardian_phone, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
                         WHERE s.id = ANY($1) AND s.guardian_phone IS NOT NULL AND s.archived_at IS NULL ORDER BY c.name, s.full_name`, [studentIds]);
  const seen = new Set();
  let added = 0;
  for (const s of rows) {
    const ph = detectPhone(s.guardian_phone, dial);
    if (!ph?.intl || !/^[0-9]{8,15}$/.test(ph.intl)) continue;
    const msg = `${(perStudent ? perStudent(s) : text).trim()}\n— ${school}`.slice(0, 1500);
    const k = `${ph.intl}|${msg}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const [dup] = await q("SELECT 1 FROM wa_outbox WHERE status = 'pending' AND phone = $1 AND body = $2", [ph.intl, msg]);
    if (dup) continue;
    await q(`INSERT INTO wa_outbox (tenant_id, student_id, phone, body, kind, created_by)
             VALUES (app_tenant(), $1, $2, $3, $4, COALESCE(NULLIF(current_setting('app.actor', true), ''), 'النظام'))`, [s.id, ph.intl, msg, kind]);
    added++;
  }
  return added;
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
  const own = await schoolGatewayOn(q);        // بوابة المدرسة: بلا رصيد
  let balance = own ? Infinity : await smsBalance(q);
  const ids = [];
  const seen = new Set();   // الإخوة لهم رقم واحد: رسالة واحدة لنفس الرقم ونفس النص
  for (const s of rows) {
    const ph = detectPhone(s.guardian_phone, dial);
    if (!ph?.intl || !/^[0-9]{8,15}$/.test(ph.intl) || seen.has(ph.intl)) continue;
    seen.add(ph.intl);
    const enough = balance >= seg;
    const [m] = await q(
      `INSERT INTO sms_messages (tenant_id, student_id, to_phone, body, kind, segments, status, error, created_by, via)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, current_setting('app.actor', true), $8) RETURNING id`,
      [s.id, ph.intl, text, kind, seg, enough ? "queued" : "no_credit", enough ? null : "رصيد الرسائل لا يكفي", own ? "school" : "platform"]);
    if (!enough) continue;
    if (own) { ids.push(m.id); continue; }
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
export async function deliver(tenantId, { smsIds = [] }) {
  const results = { sms: 0, sms_failed: 0 };
  if (smsIds.length) {
    const msgs = await transaction({ tenantId, actor: "النظام" }, (q) => q("SELECT id, to_phone, body, segments, via FROM sms_messages WHERE id = ANY($1) AND status = 'queued'", [smsIds]));
    const platformGw = msgs.some((m) => m.via === "platform") ? await loadGateway() : null;
    const schoolGw = msgs.some((m) => m.via === "school") ? await transaction({ tenantId, actor: "النظام" }, loadSchoolGateway) : null;
    for (const m of msgs) {
      const gateway = m.via === "school" ? schoolGw : platformGw;
      let error = null;
      if (!gateway) error = "مزوّد الرسائل غير مهيأ";
      else {
        try { await transport.sms(gateway, { to: m.to_phone, message: m.body }); } catch (err) { error = String(err.message || err).slice(0, 300); }
      }
      await transaction({ tenantId, actor: "النظام" }, (q) => q(
        "UPDATE sms_messages SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() END WHERE id = $1",
        [m.id, error ? (gateway ? "failed" : "disabled") : "sent", error]));
      if (error && m.via === "school") results.sms_failed++;   // بوابة المدرسة: لا رصيد يُعاد
      else if (error) {
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

/* ---------- طابور التسليم للجوال (عامل في الخلفية) ---------- */
// كل تسليم: pending → processing → sent | retrying (بانتظار متزايد) | failed (مع السبب)
// الأخطاء المؤقتة (انقطاع، 429، 5xx) تُعاد تلقائيًا: 30ث، 1د، 2د، 4د، 8د، 16د ثم تفشل.
// الجهاز الذي ألغى الاشتراك (404/410) يُحذف فورًا، والجهاز الذي يفشل 8 مرات متتالية يُحذف.
export const MAX_ATTEMPTS = 6;
export const backoffSeconds = (attempt) => Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
const BATCH = 200, PARALLEL = 10;
export const deliveryStats = { runs: 0, sent: 0, failed: 0, retried: 0, removed_devices: 0, last_run_at: null, last_error: null };

// مفاتيح جهاز تالفة (يرفضها مولّد الإشعار قبل الإرسال): خطأ دائم، والجهاز يُحذف
const badKeys = (err) => !err?.statusCode && /public key|curve|p256dh|auth secret|subscription/i.test(String(err?.message || ""));
const errorText = (err) => {
  const c = err?.statusCode;
  if (badKeys(err)) return "مفاتيح الجهاز غير صالحة (يحتاج إعادة تفعيل الإشعارات)";
  if (c === 404 || c === 410) return "الجهاز ألغى الاشتراك أو أُزيل التطبيق";
  if (c === 413) return "محتوى الإشعار أكبر من المسموح";
  if (c === 429) return "مزوّد الإشعارات طلب الإبطاء";
  if (c >= 500) return `مزوّد الإشعارات غير متاح مؤقتًا (${c})`;
  if (c >= 400) return `رفض مزوّد الإشعارات الطلب (${c})`;
  return String(err?.message || err || "خطأ في الاتصال").slice(0, 200);
};
const retryable = (err) => { const c = err?.statusCode; return !badKeys(err) && (!c || c === 429 || c >= 500); };

/** معالجة تسليمات مدرسة واحدة: تُحجز بقفل (لا يرسلها عاملان معًا) ثم تُرسل خارج المعاملة */
async function processTenant(tenantId) {
  const ctx = { tenantId, actor: "النظام" };
  const jobs = await transaction(ctx, (q) => q(
    `WITH due AS (
       SELECT d.id FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE (d.status IN ('pending', 'retrying') AND d.next_attempt_at <= now())
           OR (d.status = 'processing' AND d.locked_until < now())
        ORDER BY n.priority, d.id LIMIT ${BATCH} FOR UPDATE OF d SKIP LOCKED
     )
     UPDATE notification_deliveries d SET status = 'processing', attempts = d.attempts + 1, locked_until = now() + interval '2 minutes'
       FROM due WHERE d.id = due.id
     RETURNING d.id, d.notification_id, d.subscription_id, d.attempts`));
  if (!jobs.length) return 0;
  const info = await transaction(ctx, async (q) => {
    const rows = await q(
      `SELECT d.id, n.id AS nid, n.kind, n.title, n.body, n.link, n.priority, n.student_id, n.user_id, n.read_at,
              p.id AS sid, p.endpoint, p.p256dh, p.auth
         FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
         LEFT JOIN push_subscriptions p ON p.id = d.subscription_id
        WHERE d.id = ANY($1)`, [jobs.map((j) => j.id)]);
    // عدد غير المقروء لكل مستلم (يظهر رقمًا على أيقونة التطبيق في الأجهزة التي تدعمه)
    const badge = new Map((await q(
      `SELECT COALESCE(student_id, 0) AS s, COALESCE(user_id, 0) AS u, count(*)::int AS c FROM notifications
        WHERE read_at IS NULL AND archived_at IS NULL AND (student_id = ANY($1) OR user_id = ANY($2)) GROUP BY 1, 2`,
      [rows.map((r) => r.student_id).filter(Boolean), rows.map((r) => r.user_id).filter(Boolean)])).map((b) => [`${b.s}:${b.u}`, b.c]));
    return rows.map((r) => ({ ...r, badge: badge.get(`${r.student_id || 0}:${r.user_id || 0}`) || 0 }));
  });
  const attempts = new Map(jobs.map((j) => [Number(j.id), j.attempts]));
  const results = [];
  const send = async (t) => {
    if (!t.sid) return results.push({ id: t.id, status: "failed", error: "الجهاز أُزيل قبل الإرسال" });
    const url = t.student_id ? `/${tenantId}/student?s=${t.student_id}&n=${t.nid}${t.link ? `#${t.link}` : ""}` : `/${tenantId}/idara?n=${t.nid}`;
    try {
      const res = await transport.push(t, { title: t.title, body: t.body || "", url, tag: `${t.kind}-${t.student_id || t.user_id}-${t.nid}`,
        urgent: t.priority === 1, priority: t.priority, badge: t.badge, kind: t.kind, nid: t.nid });
      results.push({ id: t.id, sid: t.sid, status: "sent", code: res?.statusCode ?? 201 });
    } catch (err) {
      const n = attempts.get(Number(t.id)) || 1;
      const gone = err?.statusCode === 404 || err?.statusCode === 410 || badKeys(err);
      const again = !gone && retryable(err) && n < MAX_ATTEMPTS;
      const wait = err?.statusCode === 429 && Number(err?.headers?.["retry-after"]) > 0 ? Math.min(3600, Number(err.headers["retry-after"])) : backoffSeconds(n);
      results.push({ id: t.id, sid: t.sid, status: again ? "retrying" : "failed", code: err?.statusCode ?? null, error: errorText(err), gone, wait });
    }
  };
  for (let i = 0; i < info.length; i += PARALLEL) await Promise.all(info.slice(i, i + PARALLEL).map(send));
  await transaction(ctx, async (q) => {
    for (const r of results) {
      await q(`UPDATE notification_deliveries SET status = $2, provider_status = $3, error = $4, locked_until = NULL,
                 sent_at = CASE WHEN $2 = 'sent' THEN now() END,
                 next_attempt_at = CASE WHEN $2 = 'retrying' THEN now() + make_interval(secs => $5) ELSE next_attempt_at END
               WHERE id = $1`, [r.id, r.status, r.code, r.error ?? null, r.wait ?? 0]);
    }
    const ok = results.filter((r) => r.status === "sent").map((r) => r.sid);
    const gone = results.filter((r) => r.gone).map((r) => r.sid);
    const bad = results.filter((r) => r.sid && !r.gone && r.status !== "sent").map((r) => r.sid);
    if (ok.length) await q("UPDATE push_subscriptions SET failures = 0, last_sent_at = now() WHERE id = ANY($1)", [ok]);
    if (bad.length) await q("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ANY($1)", [bad]);
    const removed = await q("DELETE FROM push_subscriptions WHERE id = ANY($1) OR failures >= 8 RETURNING id", [gone]);
    deliveryStats.removed_devices += removed.length;
  });
  for (const r of results) {
    if (r.status === "sent") deliveryStats.sent++;
    else if (r.status === "retrying") deliveryStats.retried++;
    else deliveryStats.failed++;
  }
  return results.length;
}

/** دورة واحدة: كل المدارس التي لديها تسليمات مستحقة. @returns عدد ما عولج */
export async function processDeliveries() {
  const tenants = await transaction({ platform: true, actor: "النظام" }, (q) => q(
    `SELECT DISTINCT tenant_id FROM notification_deliveries
      WHERE (status IN ('pending', 'retrying') AND next_attempt_at <= now()) OR (status = 'processing' AND locked_until < now())
      LIMIT 100`));
  let total = 0;
  for (const t of tenants) {
    try {
      let n;
      do { n = await processTenant(t.tenant_id); total += n; } while (n === BATCH);
    } catch (e) { deliveryStats.last_error = e.message; console.error(`[الإشعارات ${t.tenant_id}]`, e.message); }
  }
  deliveryStats.runs++;
  deliveryStats.last_run_at = new Date().toISOString();
  return total;
}

// تشغيل فوري بعد كل حدث، مع منع تشغيلين متزامنين (إن جاء حدث أثناء الدورة تُعاد بعدها)
let running = null, again = false;
export function kickDeliveries() {
  if (running) { again = true; return running; }
  running = (async () => {
    try { do { again = false; await processDeliveries(); } while (again); }
    catch (e) { deliveryStats.last_error = e.message; console.error("[الإشعارات]", e.message); }
    finally { running = null; }
  })();
  return running;
}
/** العامل الدوري: يلتقط المؤجل (ساعات الهدوء) وإعادة المحاولة. @returns دالة الإيقاف */
export function startDeliveryWorker(everyMs = 15_000) {
  const t = setInterval(() => { kickDeliveries(); }, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
export const deliveriesIdle = () => running || Promise.resolve();

/* ---------- مزوّد الرسائل ---------- */
export async function loadGateway() {
  const [g] = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT * FROM sms_gateway WHERE id = 1"));
  if (!g?.enabled || !g.url) return null;
  return { ...g, headers: g.headers_sealed ? openSecret(g.headers_sealed, "sms-gateway") : null };
}

/* ---------- بوابة المدرسة الخاصة (جوال أندرويد بشريحتها أو مزوّدها) ---------- */
// إعداد جاهز لتطبيق «SMS Gateway for Android» مفتوح المصدر بوضعه السحابي: الجوال يرسل من شريحته
export const ANDROID_PRESET = {
  url: "https://api.sms-gate.app/3rdparty/v1/message", method: "POST", content_type: "json",
  body_template: '{"textMessage":{"text":"{message}"},"phoneNumbers":["+{to}"]}', success_match: "",
};
const schoolAad = (tid) => `school-sms:${tid}`;
export const sealSchoolHeaders = (tid, obj) => sealSecret(JSON.stringify(obj), schoolAad(tid));
async function schoolGatewayOn(q) {
  const [g] = await q("SELECT enabled, url FROM school_sms_gateway WHERE tenant_id = app_tenant()");
  return Boolean(g?.enabled && g.url);
}
/** بوابة المدرسة جاهزة للإرسال (داخل معاملة المدرسة)، أو null */
export async function loadSchoolGateway(q) {
  const [g] = await q("SELECT * FROM school_sms_gateway WHERE tenant_id = app_tenant()");
  if (!g?.enabled || !g.url) return null;
  return { ...g, headers: g.headers_sealed ? openSecret(g.headers_sealed, schoolAad(g.tenant_id)) : null };
}
