// بوابة مِدار الذكية (المرحلة الأولى) — التصميم الكامل في docs/SMART_GATE.md
//
//   1) رمز الحضور: 128 بت عشوائي لكل طالب، مستقل عن معرّف ولي الأمر ورقم الطالب. يُحفظ في القاعدة كبصمة (للبحث)
//      ونسخة مشفرة (لإعادة طباعة البطاقة فقط). يُلغى ويُعاد إصداره دون أن يتأثر دخول ولي الأمر.
//   2) جهاز البوابة: الإدارة تنشئ رابطًا لمرة واحدة وترسله للحارس ← جواله يقترن به ← الإدارة توافق ← يأخذ سرًا خاصًا به.
//      لا يستطيع أي مستخدم تحويل جواله إلى بوابة بنفسه، والإدارة توقف أي جهاز فورًا.
//   3) كل مسح حدث مستقل بهوية من الجهاز (event_id): إعادة الإرسال لا تكرر الأثر، والمرفوض يُحفظ بسببه.
//   4) سجل حضور واحد لكل طالب في اليوم. حاضر حتى وقت التأخر، متأخر بعده (بعدد الدقائق)، ولا تسجيل خارج النافذة.
//   5) بعد الإغلاق: «لم يسجل حضور» قائمة محسوبة (لا غياب بعد) ← مراجعة واستثناءات ← اعتماد الغياب ← إشعار ولي الأمر.
import crypto from "node:crypto";
import net from "node:net";
import { z, t } from "../../core/http/validate.js";
import { badRequest, conflict, notFound, unauthorized } from "../../core/http/errors.js";
import { sealSecret, openSecret } from "../../core/auth/secret-box.js";
import { transaction } from "../../core/db/pool.js";
import { notify, getQuiet, adminUserIds } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";
import { dayStatus, mark } from "./attendance.service.js";

/* ======================= الوقت بتوقيت المدرسة ======================= */
const hmFmt = new Map();
function local(date, tz) {
  let f = hmFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    hmFmt.set(tz, f);
  }
  return { day: date.toLocaleDateString("en-CA", { timeZone: tz }), hm: f.format(date) };
}
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const time12 = (date, tz) => new Intl.DateTimeFormat("ar", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
export const schoolToday = async (q) => local(new Date(), (await getQuiet(q)).timezone);

/* ======================= رموز الحضور ======================= */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";          // Crockford Base32: بلا I وL وO وU
const TOKEN_RE = /^A1[0-9A-HJKMNP-TV-Z]{26}$/;
export function newAttendanceToken() {
  let n = BigInt(`0x${crypto.randomBytes(16).toString("hex")}`), s = "";
  for (let i = 0; i < 26; i++) { s = ALPHABET[Number(n & 31n)] + s; n >>= 5n; }
  return `A1${s}`;
}
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest();
const tenantOf = async (q) => (await q("SELECT app_tenant() AS t"))[0].t;
const aad = (tenant, studentId) => `att:${tenant}:${studentId}`;

/** إصدار رمز جديد (يلغي النشط إن وُجد) */
export async function issueToken(q, studentId, { actor, reason = null } = {}) {
  const [s] = await q("SELECT id FROM students WHERE id = $1 AND status = 'active' AND archived_at IS NULL", [studentId]);
  if (!s) throw notFound("الطالب غير موجود أو غير مقيد");
  const [old] = await q(
    `UPDATE attendance_credentials SET status = 'revoked', revoked_by = $2, revoked_at = now(), revoke_reason = $3
      WHERE student_id = $1 AND kind = 'qr' AND status = 'active' RETURNING version`, [studentId, actor, reason || "إعادة إصدار"]);
  const [{ v }] = await q("SELECT COALESCE(max(version), 0)::int AS v FROM attendance_credentials WHERE student_id = $1 AND kind = 'qr'", [studentId]);
  const token = newAttendanceToken();
  await q(`INSERT INTO attendance_credentials (tenant_id, student_id, kind, token_hash, token_enc, version, issued_by)
           VALUES (app_tenant(), $1, 'qr', $2, $3, $4, $5)`,
  [studentId, hashToken(token), sealSecret(token, aad(await tenantOf(q), studentId)), v + 1, actor]);
  return { token, version: v + 1, replaced: Boolean(old) };
}

/** تعطيل بطاقة (مفقودة مثلًا) دون إصدار بديل */
export async function disableToken(q, studentId, { actor, reason }) {
  const rows = await q(
    `UPDATE attendance_credentials SET status = 'revoked', revoked_by = $2, revoked_at = now(), revoke_reason = $3
      WHERE student_id = $1 AND kind = 'qr' AND status = 'active' RETURNING id`, [studentId, actor, reason || "تعطيل"]);
  if (!rows.length) throw notFound("لا توجد بطاقة حضور فعالة لهذا الطالب");
  return { ok: true };
}

/**
 * كل طالب مقيد له رمز، ورموز غير المقيدين (منقول، منسحب، مؤرشف) تُلغى.
 * تُستدعى عند فتح البطاقات وفي المهمة الدورية، فالطالب الجديد يأخذ رمزه تلقائيًا.
 */
export async function ensureTokens(q, { actor = "النظام", studentIds = null } = {}) {
  await q(`UPDATE attendance_credentials c SET status = 'revoked', revoked_by = $1, revoked_at = now(), revoke_reason = 'الطالب غير مقيد'
            FROM students s WHERE s.id = c.student_id AND c.status = 'active' AND (s.status <> 'active' OR s.archived_at IS NOT NULL)`, [actor]);
  const missing = await q(
    `SELECT s.id FROM students s WHERE s.status = 'active' AND s.archived_at IS NULL
        AND ($1::bigint[] IS NULL OR s.id = ANY($1::bigint[]))
        AND NOT EXISTS (SELECT 1 FROM attendance_credentials c WHERE c.student_id = s.id AND c.kind = 'qr' AND c.status = 'active')`,
    [studentIds]);
  for (const s of missing) await issueToken(q, s.id, { actor });
  return missing.length;
}

/** نص رمز QR لبطاقة طالب (يُصدر رمزًا إن لم يوجد، ويعيد الإصدار إن تعذّر فك النسخة المحفوظة) */
export async function cardTokens(q, studentIds, { actor = "النظام" } = {}) {
  await ensureTokens(q, { actor, studentIds });
  const tenant = await tenantOf(q);
  const rows = await q(
    `SELECT student_id, token_enc, version, issued_at FROM attendance_credentials
      WHERE student_id = ANY($1::bigint[]) AND kind = 'qr' AND status = 'active'`, [studentIds]);
  const out = new Map();
  for (const r of rows) {
    let token = openSecret(r.token_enc, aad(tenant, r.student_id)), version = r.version;
    if (!token) ({ token, version } = await issueToken(q, r.student_id, { actor, reason: "تعذّر قراءة الرمز المحفوظ" }));
    out.set(Number(r.student_id), { token, version });
  }
  return out;
}
export const cardUrl = (base, school, token) => `${base}/q/${school}/${token}`;

/**
 * قراءة ما في رمز QR: بطاقة حضور (رابط …/q/<المدرسة>/<الرمز> أو الرمز نفسه)،
 * أو بطاقة ولي الأمر القديمة (…/<المدرسة>?k=المعرّف) إن سمحت المدرسة بها في الفترة الانتقالية.
 */
export function parseCode(raw, school) {
  const code = String(raw || "").trim();
  if (/^https?:\/\//i.test(code)) {
    let u;
    try { u = new URL(code); } catch { return { error: "bad_format" }; }
    const seg = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    if (seg[0] === "q" && seg.length >= 3) {
      if (seg[1].toLowerCase() !== school) return { error: "other_school" };
      return TOKEN_RE.test(seg[2].toUpperCase()) ? { token: seg[2].toUpperCase() } : { error: "bad_format" };
    }
    const k = u.searchParams.get("k");
    if (seg[0] && k) {
      if (seg[0].toLowerCase() !== school) return { error: "other_school" };
      return legacyKey(k);
    }
    return { error: "bad_format" };
  }
  const up = code.toUpperCase();
  if (TOKEN_RE.test(up)) return { token: up };
  return legacyKey(up);
}
function legacyKey(k) {
  const key = String(k).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z2-9]{8}$/.test(key) ? { legacy: `${key.slice(0, 4)}-${key.slice(4)}` } : { error: "bad_format" };
}

/* ======================= الإعدادات ونافذة اليوم ======================= */
/**
 * نافذة الحضور ليوم: اليوم الاستثنائي (أوقات خاصة) يتقدم على أوقات المرحلة، وأوقات المرحلة تتقدم على العامة.
 * stageId = null: نافذة المدرسة كلها (أبكر بداية وآخر إغلاق بين المراحل) — للمتابعة والإغلاق.
 */
export async function windowFor(q, day, stageId = null) {
  const s = await featureSettings(q, "gate");
  const [d] = await q(
    `SELECT mode, state, to_char(open_at, 'HH24:MI') AS open_at, to_char(late_after, 'HH24:MI') AS late_after,
            to_char(close_at, 'HH24:MI') AS close_at, finalized_by, finalized_at, absent_count, absence_notified_at, note
       FROM attendance_days WHERE day = $1`, [day]);
  const custom = d?.mode === "custom_hours";
  let w = custom ? { open_at: d.open_at, late_after: d.late_after, close_at: d.close_at }
    : { open_at: s.open_at, late_after: s.late_after, close_at: s.close_at };
  if (!custom) {
    const stages = await q(`SELECT stage_id, to_char(open_at, 'HH24:MI') AS open_at, to_char(late_after, 'HH24:MI') AS late_after,
                                   to_char(close_at, 'HH24:MI') AS close_at FROM attendance_stage_hours`);
    const own = stageId ? stages.find((x) => Number(x.stage_id) === Number(stageId)) : null;
    if (own) w = { open_at: own.open_at, late_after: own.late_after, close_at: own.close_at };
    else if (!stageId && stages.length) {
      w = { ...w, open_at: [w.open_at, ...stages.map((x) => x.open_at)].sort()[0],
        close_at: [w.close_at, ...stages.map((x) => x.close_at)].sort().at(-1) };
    }
  }
  return {
    ...w, mode: d?.mode || "normal", state: d?.state || "open", note: d?.note || null,
    finalized_by: d?.finalized_by || null, finalized_at: d?.finalized_at || null, absent_count: d?.absent_count ?? null,
    absence_notified_at: d?.absence_notified_at || null, settings: s,
  };
}
export const stageHoursBody = z.object({ stage_id: t.id,
  open_at: z.string().regex(/^\d\d:\d\d$/), late_after: z.string().regex(/^\d\d:\d\d$/), close_at: z.string().regex(/^\d\d:\d\d$/) });
export async function listStageHours(q) {
  return q(`SELECT st.id AS stage_id, st.name, to_char(h.open_at, 'HH24:MI') AS open_at, to_char(h.late_after, 'HH24:MI') AS late_after,
                   to_char(h.close_at, 'HH24:MI') AS close_at
              FROM stages st LEFT JOIN attendance_stage_hours h ON h.stage_id = st.id ORDER BY st.sort_order, st.id`);
}
export async function setStageHours(q, b) {
  if (!(b.open_at <= b.late_after && b.late_after < b.close_at)) throw badRequest("الأوقات: البداية ≤ وقت التأخر < الإغلاق");
  const [st] = await q("SELECT id FROM stages WHERE id = $1", [b.stage_id]);
  if (!st) throw notFound("المرحلة غير موجودة");
  await q(`INSERT INTO attendance_stage_hours (tenant_id, stage_id, open_at, late_after, close_at) VALUES (app_tenant(), $1, $2, $3, $4)
           ON CONFLICT (tenant_id, stage_id) DO UPDATE SET open_at = EXCLUDED.open_at, late_after = EXCLUDED.late_after, close_at = EXCLUDED.close_at`,
  [b.stage_id, b.open_at, b.late_after, b.close_at]);
  return { ok: true };
}
export async function clearStageHours(q, stageId) {
  await q("DELETE FROM attendance_stage_hours WHERE stage_id = $1", [stageId]);
  return { ok: true };
}
/** مرحلة اليوم الآن: قبل البداية، مفتوح، مغلق (بانتظار المراجعة)، معتمد */
const phaseOf = (win, hm, isToday, isPast) => {
  if (win.state === "finalized") return "finalized";
  if (isPast || win.state === "closed") return "closed";
  if (!isToday) return "before";
  if (hm < win.open_at) return "before";
  return hm <= win.close_at ? "open" : "closed";
};

/* ======================= الأجهزة ======================= */
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest();
const sameHash = (a, b) => Boolean(a && b && a.length === b.length && crypto.timingSafeEqual(a, b));
export const PAIR_HOURS = 24;
// بيانات الجهاز التعريفية (تظهر للإدارة لتعرف الجوال)
const pairInfo = z.object({ ua: z.string().max(200).optional(), platform: z.string().max(60).optional(), screen: z.string().max(30).optional(),
  lang: z.string().max(20).optional() }).default({});

export const gateBody = z.object({ name: z.string().trim().min(2).max(60), location: t.optText(120), is_active: z.boolean().optional(),
  direction: z.enum(["in", "out", "both"]).optional(),
  geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radius_m: z.number().int().min(50).max(5000) }).nullable().optional() });
export const deviceBody = z.object({ name: z.string().trim().min(2).max(60), gate_id: t.id });

export async function listGates(q) {
  return q(`SELECT g.id, g.name, g.location, g.is_active, g.direction, g.geo_lat, g.geo_lng, g.geo_radius_m,
                   (SELECT count(*)::int FROM gate_devices d WHERE d.gate_id = g.id AND d.status IN ('active', 'pending', 'pairing')) AS devices
              FROM gates g ORDER BY g.id`);
}
export async function saveGate(q, id, b) {
  const geo = b.geo === undefined ? undefined : b.geo;
  if (id) {
    const [g] = await q(
      `UPDATE gates SET name = $2, location = $3, is_active = COALESCE($4, is_active), direction = COALESCE($5, direction),
              geo_lat = CASE WHEN $6 THEN $7 ELSE geo_lat END, geo_lng = CASE WHEN $6 THEN $8 ELSE geo_lng END,
              geo_radius_m = CASE WHEN $6 THEN $9 ELSE geo_radius_m END
        WHERE id = $1 RETURNING id`,
      [id, b.name, b.location ?? null, b.is_active ?? null, b.direction ?? null, geo !== undefined, geo?.lat ?? null, geo?.lng ?? null, geo?.radius_m ?? null]);
    if (!g) throw notFound("البوابة غير موجودة");
    return g;
  }
  const [g] = await q(
    `INSERT INTO gates (tenant_id, name, location, direction, geo_lat, geo_lng, geo_radius_m) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id`,
    [b.name, b.location ?? null, b.direction || "in", geo?.lat ?? null, geo?.lng ?? null, geo?.radius_m ?? null]);
  if (!g) throw conflict("توجد بوابة بهذا الاسم");
  return g;
}
export async function deleteGate(q, id) {
  const [{ n }] = await q("SELECT count(*)::int AS n FROM gate_devices WHERE gate_id = $1 AND status <> 'revoked'", [id]);
  if (n) throw conflict("أوقف أجهزة هذه البوابة أو انقلها أولًا");
  await q("DELETE FROM gate_devices WHERE gate_id = $1", [id]);
  const rows = await q("DELETE FROM gates WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("البوابة غير موجودة");
  return { ok: true };
}
/** أول بوابة تُنشأ تلقائيًا باسم «البوابة الرئيسية» */
export async function defaultGate(q) {
  const [g] = await q("SELECT id FROM gates ORDER BY id LIMIT 1");
  if (g) return g.id;
  return (await saveGate(q, null, { name: "البوابة الرئيسية" })).id;
}

const ONLINE_MS = 90_000;
export async function listDevices(q) {
  const rows = await q(
    `SELECT d.id, d.public_id, d.name, d.status, d.gate_id, g.name AS gate_name, d.fingerprint, d.app_version,
            d.last_seen_at, d.last_sync_at, d.clock_skew_ms, d.pending_events, d.pair_expires_at, d.created_by, d.approved_by, d.approved_at,
            d.created_at, host(d.last_ip) AS last_ip, d.geo_lat, d.geo_lng, d.geo_accuracy_m, d.geo_at,
            g.geo_lat AS gate_lat, g.geo_lng AS gate_lng, g.geo_radius_m
       FROM gate_devices d JOIN gates g ON g.id = d.gate_id
      WHERE d.status <> 'revoked' OR d.updated_at > now() - interval '30 days'
      ORDER BY d.status = 'revoked', d.id`);
  const now = Date.now();
  for (const d of rows) {
    d.online = Boolean(d.last_seen_at && now - new Date(d.last_seen_at).getTime() < ONLINE_MS);
    d.pair_expired = d.status === "pairing" && (!d.pair_expires_at || new Date(d.pair_expires_at) < new Date());
    d.distance_m = d.gate_lat !== null && d.geo_lat !== null ? Math.round(distanceM(d.gate_lat, d.gate_lng, d.geo_lat, d.geo_lng)) : null;
    d.outside = d.distance_m !== null && d.distance_m > d.geo_radius_m + Math.min(d.geo_accuracy_m || 0, 500);
    for (const k of ["geo_lat", "geo_lng", "gate_lat", "gate_lng"]) delete d[k];
    delete d.pair_expires_at;
  }
  return rows;
}

/** جهاز جديد: يعيد رمز الاقتران مرة واحدة فقط (يُبنى منه رابط الحارس) */
export async function createDevice(q, b, { actor }) {
  const [g] = await q("SELECT id FROM gates WHERE id = $1 AND is_active", [b.gate_id]);
  if (!g) throw notFound("البوابة غير موجودة أو موقوفة");
  const publicId = crypto.randomBytes(12).toString("base64url");
  const code = crypto.randomBytes(15).toString("base64url");
  const [d] = await q(
    `INSERT INTO gate_devices (tenant_id, public_id, gate_id, name, status, pair_code_hash, pair_expires_at, created_by)
     VALUES (app_tenant(), $1, $2, $3, 'pairing', $4, now() + make_interval(hours => $5), $6) RETURNING id`,
    [publicId, b.gate_id, b.name, sha(code), PAIR_HOURS, actor]);
  return { id: d.id, public_id: publicId, code };
}
/** رابط جديد لجهاز (فقد الحارس جواله أو انتهت صلاحية الرابط): السر القديم يبطل فورًا */
export async function rePair(q, id) {
  const code = crypto.randomBytes(15).toString("base64url");
  const [d] = await q(
    `UPDATE gate_devices SET status = 'pairing', secret_hash = NULL, pair_code_hash = $2, pair_expires_at = now() + make_interval(hours => $3),
            approved_by = NULL, approved_at = NULL
      WHERE id = $1 AND status <> 'revoked' RETURNING public_id`, [id, sha(code), PAIR_HOURS]);
  if (!d) throw notFound("الجهاز غير موجود");
  return { id, public_id: d.public_id, code };
}
/* ---------- ربط أي جوال برمز قصير ---------- */
// الإدارة تُظهر رمزًا من 6 أرقام (ورمز QR) صالحًا لمدة ولعدد جوالات تحددهما. الحارس يكتبه في صفحة البوابة.
// الحماية: صلاحية قصيرة + عدد محدد + قفل بعد 10 محاولات خاطئة من الجهاز (و100 على المدرسة) خلال 30 دقيقة.
export const joinCodeBody = z.object({
  gate_id: t.id.optional(),
  minutes: z.coerce.number().int().min(10).max(24 * 60).default(60),
  max_devices: z.coerce.number().int().min(1).max(50).default(1),
  auto_approve: z.boolean().default(false),
});
const joinAad = (tenant) => `gate-join:${tenant}`;
const tenantId = async (q) => (await q("SELECT app_tenant() AS t"))[0].t;
export async function createJoinCode(q, b, { actor }) {
  const [g] = await q("SELECT id, name FROM gates WHERE id = $1 AND is_active", [b.gate_id]);
  if (!g) throw notFound("البوابة غير موجودة أو موقوفة");
  const tenant = await tenantId(q);
  // رمز لا يتكرر مع رمز صالح آخر في نفس المدرسة
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const [dup] = await q("SELECT 1 FROM gate_join_codes WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > now()", [sha(code)]);
    if (dup) continue;
    const [r] = await q(
      `INSERT INTO gate_join_codes (tenant_id, gate_id, code_hash, code_enc, expires_at, max_devices, auto_approve, created_by)
       VALUES (app_tenant(), $1, $2, $3, now() + make_interval(mins => $4), $5, $6, $7) RETURNING id, expires_at`,
      [g.id, sha(code), sealSecret(code, joinAad(tenant)), b.minutes, b.max_devices, b.auto_approve, actor]);
    return { id: r.id, code, expires_at: r.expires_at, gate_name: g.name, max_devices: b.max_devices, auto_approve: b.auto_approve };
  }
  throw conflict("تعذر إنشاء رمز جديد الآن. حاول مرة أخرى.");
}
/** الرموز الصالحة الآن (مع الرمز نفسه لتعيد الإدارة عرضه) والجوالات التي انضمت بكل رمز */
export async function listJoinCodes(q) {
  const tenant = await tenantId(q);
  const rows = await q(
    `SELECT c.id, c.code_enc, c.expires_at, c.max_devices, c.used_count, c.auto_approve, c.created_by, c.created_at, g.name AS gate_name,
            COALESCE(json_agg(json_build_object('id', d.id, 'name', d.name, 'status', d.status) ORDER BY d.id) FILTER (WHERE d.id IS NOT NULL), '[]') AS devices
       FROM gate_join_codes c JOIN gates g ON g.id = c.gate_id
       LEFT JOIN gate_devices d ON d.join_code_id = c.id AND d.status <> 'revoked'
      WHERE c.revoked_at IS NULL AND c.expires_at > now() AND c.used_count < c.max_devices
      GROUP BY c.id, g.name ORDER BY c.id DESC`);
  for (const r of rows) {
    try { r.code = openSecret(r.code_enc, joinAad(tenant)); } catch { r.code = null; }
    delete r.code_enc;
  }
  return rows;
}
export async function revokeJoinCode(q, id) {
  const rows = await q("UPDATE gate_join_codes SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id", [id]);
  if (!rows.length) throw notFound("الرمز غير موجود أو أُلغي");
  return { ok: true };
}
export const joinBody = z.object({
  code: z.string().trim().transform((v) => v.replace(/[\s-]/g, "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)))
    .pipe(z.string().regex(/^\d{6}$/, "الرمز 6 أرقام")),
  name: z.string().trim().min(2, "اكتب اسمًا للجوال").max(60),
  info: pairInfo,
  app_version: z.string().max(40).optional(),
});
const JOIN_FAILS_IP = 10, JOIN_FAILS_SCHOOL = 100, JOIN_LOCK_MIN = 30;
/**
 * الحارس يكتب الرمز: يصير جواله جهاز بوابة ويأخذ سره مرة واحدة.
 * يعيد { error } (بدل رمي خطأ) عند الرمز الخاطئ حتى تُحفظ المحاولة في نفس المعاملة.
 */
export async function joinWithCode(q, b, { ip }) {
  const tenant = await tenantId(q);
  const ipSubject = `${tenant}:${ip || "?"}`;
  const fails = await q(`SELECT count(*) FILTER (WHERE subject = $1)::int AS ip, count(*)::int AS school FROM security_events
                          WHERE kind = 'gate_join_failed' AND tenant_id = $2 AND created_at > now() - make_interval(mins => $3)`,
  [ipSubject, tenant, JOIN_LOCK_MIN]);
  if (fails[0].ip >= JOIN_FAILS_IP || fails[0].school >= JOIN_FAILS_SCHOOL) {
    return { status: 429, error: `محاولات خاطئة كثيرة. انتظر ${JOIN_LOCK_MIN} دقيقة ثم أعد المحاولة، أو اطلب من الإدارة رابطًا مباشرًا.` };
  }
  // القفل على الصف يمنع تجاوز العدد المسموح عند انضمام جوالين في نفس اللحظة
  const [c] = await q(
    `SELECT id, gate_id, max_devices, used_count, auto_approve, created_by FROM gate_join_codes
      WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [sha(b.code)]);
  if (!c || c.used_count >= c.max_devices) {
    await q("INSERT INTO security_events (kind, subject, tenant_id, ip) VALUES ('gate_join_failed', $1, $2, $3)", [ipSubject, tenant, ip || null]);
    return { status: 401, error: c ? "اكتمل عدد الجوالات المسموح بهذا الرمز. اطلب رمزًا جديدًا من الإدارة." : "الرمز غير صحيح أو انتهت صلاحيته. تأكد منه أو اطلب رمزًا جديدًا من الإدارة." };
  }
  const publicId = crypto.randomBytes(12).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  const status = c.auto_approve ? "active" : "pending";
  const [d] = await q(
    `INSERT INTO gate_devices (tenant_id, public_id, gate_id, name, status, secret_hash, fingerprint, app_version, last_seen_at, last_ip,
                               created_by, approved_by, approved_at, join_code_id)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, $12) RETURNING id`,
    [publicId, c.gate_id, b.name, status, sha(secret), JSON.stringify(b.info || {}), b.app_version || null, ip || null,
      `${c.created_by} (رمز الربط)`, c.auto_approve ? `${c.created_by} (رمز الربط)` : null, c.auto_approve ? new Date() : null, c.id]);
  await q("UPDATE gate_join_codes SET used_count = used_count + 1 WHERE id = $1", [c.id]);
  await q("DELETE FROM security_events WHERE kind = 'gate_join_failed' AND subject = $1", [ipSubject]);
  await notify(q, { event: "gate", users: await adminUserIds(q),
    title: c.auto_approve ? `جوال جديد يعمل على البوابة: ${b.name}` : `جوال بانتظار موافقتك: ${b.name}`,
    body: c.auto_approve ? "انضم برمز الربط وصار جاهزًا للمسح. تستطيع إيقافه من «الحضور ← البوابة»." : "انضم برمز الربط. وافق عليه من «الحضور ← البوابة» ليبدأ المسح.",
    link: "attendance", dedupKey: `join:${d.id}` });
  return { device: publicId, secret, status };
}

const STATE_MOVES = {
  approve: [["pending"], "active", "الجهاز ليس بانتظار الموافقة"],
  disable: [["active", "pending"], "disabled", "الجهاز ليس مفعّلًا"],
  enable: [["disabled"], "active", "الجهاز ليس موقوفًا"],
  revoke: [["pairing", "pending", "active", "disabled"], "revoked", "الجهاز ملغى من قبل"],
};
export async function setDeviceState(q, id, action, { actor }) {
  const [from, to, msg] = STATE_MOVES[action] || [];
  if (!to) throw badRequest("إجراء غير معروف");
  const [d] = await q(
    `UPDATE gate_devices SET status = $2,
            approved_by = CASE WHEN $2 = 'active' AND approved_by IS NULL THEN $4 ELSE approved_by END,
            approved_at = CASE WHEN $2 = 'active' AND approved_at IS NULL THEN now() ELSE approved_at END,
            secret_hash = CASE WHEN $2 = 'revoked' THEN NULL ELSE secret_hash END,
            pair_code_hash = CASE WHEN $2 = 'revoked' THEN NULL ELSE pair_code_hash END
      WHERE id = $1 AND status = ANY($3::text[]) AND (status <> 'disabled' OR secret_hash IS NOT NULL) RETURNING id`, [id, to, from, actor]);
  if (!d) throw conflict(msg);
  return { ok: true, status: to };
}
export async function updateDevice(q, id, b) {
  const [g] = await q("SELECT id FROM gates WHERE id = $1", [b.gate_id]);
  if (!g) throw notFound("البوابة غير موجودة");
  const [d] = await q("UPDATE gate_devices SET name = $2, gate_id = $3 WHERE id = $1 AND status <> 'revoked' RETURNING id", [id, b.name, b.gate_id]);
  if (!d) throw notFound("الجهاز غير موجود");
  return { ok: true };
}

/* ---------- من جهة الجهاز ---------- */
export const pairBody = z.object({
  device: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/), code: z.string().regex(/^[A-Za-z0-9_-]{16,60}$/),
  info: pairInfo,
  app_version: z.string().max(40).optional(),
});
/** الحارس يفتح الرابط: الجهاز يقترن (بانتظار موافقة الإدارة) ويأخذ سره مرة واحدة */
export async function pair(q, b, { ip }) {
  const [d] = await q("SELECT id, status, pair_code_hash, pair_expires_at FROM gate_devices WHERE public_id = $1", [b.device]);
  if (!d || d.status !== "pairing" || !sameHash(d.pair_code_hash, sha(b.code))) throw unauthorized("رابط البوابة غير صالح أو استُخدم من قبل. اطلب رابطًا جديدًا من الإدارة.");
  if (!d.pair_expires_at || new Date(d.pair_expires_at) < new Date()) throw unauthorized("انتهت صلاحية رابط البوابة. اطلب رابطًا جديدًا من الإدارة.");
  const secret = crypto.randomBytes(32).toString("base64url");
  await q(`UPDATE gate_devices SET status = 'pending', secret_hash = $2, pair_code_hash = NULL, pair_expires_at = NULL,
                  fingerprint = $3, app_version = $4, last_seen_at = now(), last_ip = $5 WHERE id = $1`,
  [d.id, sha(secret), JSON.stringify(b.info || {}), b.app_version || null, ip || null]);
  const admins = await adminUserIds(q);
  await notify(q, { event: "gate", users: admins, title: "جهاز بوابة بانتظار موافقتك",
    body: "فتح الحارس رابط البوابة. وافق على الجهاز من «الحضور ← البوابة» ليبدأ المسح.", link: "attendance", dedupKey: `pair:${d.id}`, dedupMinutes: 60 });
  return { secret, status: "pending" };
}

/** مصادقة الجهاز من الترويسة: لا جلسة مستخدم، والمدرسة من الرابط فقط */
export async function authDevice(q, publicId, secret) {
  if (!publicId || !secret) throw unauthorized("جهاز غير معروف");
  const [d] = await q(
    `SELECT d.id, d.public_id, d.name, d.status, d.gate_id, d.secret_hash, g.name AS gate_name, g.is_active AS gate_active,
            g.direction, g.geo_lat AS gate_lat, g.geo_lng AS gate_lng, g.geo_radius_m, d.geo_lat, d.geo_lng, d.geo_accuracy_m, d.geo_at
       FROM gate_devices d JOIN gates g ON g.id = d.gate_id WHERE d.public_id = $1`, [publicId]);
  if (!d || !sameHash(d.secret_hash, sha(secret))) throw unauthorized("جهاز غير معروف أو أُلغي. اطلب رابطًا جديدًا من الإدارة.");
  delete d.secret_hash;
  return d;
}

export const heartbeatBody = z.object({
  client_ts: z.coerce.number().int().positive().optional(), app_version: z.string().max(40).optional(),
  pending: z.coerce.number().int().min(0).max(100000).optional(),
  geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }).optional(),
});
/** نبض الجهاز: الحالة، ووقت الخادم (لتصحيح ساعة الجهاز)، ونافذة اليوم، وعداد البوابة */
export async function heartbeat(q, device, b, { ip }) {
  const now = new Date();
  const skew = b.client_ts ? now.getTime() - b.client_ts : null;
  await q(`UPDATE gate_devices SET last_seen_at = now(), last_ip = $2, app_version = COALESCE($3, app_version),
                  clock_skew_ms = COALESCE($4, clock_skew_ms), pending_events = COALESCE($5, pending_events),
                  last_sync_at = CASE WHEN $5 = 0 THEN now() ELSE last_sync_at END WHERE id = $1`,
  [device.id, ip || null, b.app_version || null, skew === null ? null : Math.max(-2e9, Math.min(2e9, skew)), b.pending ?? null]);
  if (b.geo) {
    await q("UPDATE gate_devices SET geo_lat = $2, geo_lng = $3, geo_accuracy_m = $4, geo_at = now() WHERE id = $1",
      [device.id, b.geo.lat, b.geo.lng, Math.round(b.geo.accuracy)]);
    Object.assign(device, { geo_lat: b.geo.lat, geo_lng: b.geo.lng, geo_accuracy_m: Math.round(b.geo.accuracy), geo_at: now });
  }
  const { timezone } = await getQuiet(q);
  const { day, hm } = local(now, timezone);
  const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");
  const out = { status: device.status, device: device.name, gate: device.gate_name, school: school?.name || "", server_time: now.getTime(), day, timezone };
  if (device.status !== "active") return out;
  const win = await windowFor(q, day);
  const ds = await dayStatus(q, day);
  const [{ n }] = await q("SELECT count(*)::int AS n FROM attendance WHERE day = $1 AND first_in_at IS NOT NULL AND gate_id = $2", [day, device.gate_id]);
  const [{ all }] = await q("SELECT count(*)::int AS all FROM attendance WHERE day = $1 AND first_in_at IS NOT NULL", [day]);
  const s = win.settings;
  const place = await placeCheck(q, device, s, { ip, offline: false });
  return { ...out, window: { open_at: win.open_at, late_after: win.late_after, close_at: win.close_at },
    phase: noSchool(ds, win) ? "no_school" : phaseOf(win, hm, true, false), no_school_reason: noSchool(ds, win), count_gate: n, count_all: all,
    direction: device.direction, roster_version: await rosterVersion(q),
    want_location: s.location_mode !== "off" && device.gate_lat !== null && device.gate_lat !== undefined,
    place_warning: place ? REASONS[place] : null };
}
const noSchool = (ds, win) => (win.mode === "no_attendance" ? (win.note || "لا يُسجل حضور اليوم")
  : ds.holiday ? `إجازة: ${ds.holiday.name}` : !ds.study_day ? "ليس يوم دراسة" : null);

/* ======================= قائمة الجهاز (للعمل بلا اتصال) ======================= */
// الجهاز يحفظ بصمات الرموز فقط (لا يمكن صنع بطاقة منها) مع الاسم والشعبة، فيعرف الطالب ويقرر وهو بلا اتصال.
// لا جوالات ولا صور ولا بيانات أولياء أمور.
export async function rosterVersion(q) {
  const [r] = await q(
    `SELECT md5(concat_ws('|', (SELECT max(id) FROM attendance_credentials), (SELECT count(*) FROM attendance_credentials WHERE status = 'active'),
            (SELECT max(updated_at) FROM students), (SELECT max(updated_at) FROM classes))) AS v`);
  return r.v.slice(0, 16);
}
export async function roster(q) {
  const rows = await q(
    `SELECT encode(c.token_hash, 'hex') AS h, s.id AS sid, s.full_name AS name, cl.name AS cls, gr.stage_id AS stage
       FROM attendance_credentials c JOIN students s ON s.id = c.student_id AND s.status = 'active' AND s.archived_at IS NULL
       LEFT JOIN classes cl ON cl.id = s.class_id LEFT JOIN grades gr ON gr.id = cl.grade_id
      WHERE c.status = 'active'`);
  const stages = await q(`SELECT stage_id, to_char(open_at, 'HH24:MI') AS open_at, to_char(late_after, 'HH24:MI') AS late_after,
                                 to_char(close_at, 'HH24:MI') AS close_at FROM attendance_stage_hours`);
  return { version: await rosterVersion(q), students: rows, stage_hours: stages };
}

/* ---------- الحماية من التسجيل خارج المدرسة: الشبكة والموقع ---------- */
const distanceM = (a1, o1, a2, o2) => {
  const R = 6371000, rad = (x) => (Number(x) * Math.PI) / 180;
  const d = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
};
export const parseNetworks = (txt) => String(txt || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
/** قائمة شبكات المدرسة: عنوان مفرد أو نطاق (82.114.160.0/24). يرمي خطأ عند عنوان غير صالح */
export function networkList(txt) {
  const list = new net.BlockList();
  for (const n of parseNetworks(txt)) {
    const [addr, bits] = n.split("/");
    const type = net.isIPv4(addr) ? "ipv4" : net.isIPv6(addr) ? "ipv6" : null;
    if (!type) throw badRequest(`عنوان شبكة غير صحيح: ${n}`);
    if (bits === undefined) list.addAddress(addr, type);
    else {
      const p = Number(bits);
      if (!Number.isInteger(p) || p < 0 || p > (type === "ipv4" ? 32 : 128)) throw badRequest(`عنوان شبكة غير صحيح: ${n}`);
      list.addSubnet(addr, p, type);
    }
  }
  return list;
}
const ipInside = (list, ip) => {
  const a = String(ip || "").replace(/^::ffff:/, "");
  return net.isIPv4(a) ? list.check(a, "ipv4") : net.isIPv6(a) ? list.check(a, "ipv6") : true;
};
/** يعيد سبب المخالفة أو null: خارج شبكة المدرسة (للمسح المباشر) أو بعيد عن موقع البوابة */
async function placeCheck(q, device, s, { ip, offline }) {
  if (s.location_mode === "off") return null;
  const nets = parseNetworks(s.allowed_networks);
  if (nets.length && !offline && ip) {
    let list;
    try { list = networkList(s.allowed_networks); } catch { list = null; }
    if (list && !ipInside(list, ip)) return "outside_network";
  }
  if (device.gate_lat !== null && device.gate_lat !== undefined && device.geo_lat !== null && device.geo_lat !== undefined
      && device.geo_at && Date.now() - new Date(device.geo_at).getTime() < 3 * 3600_000) {
    const d = distanceM(device.gate_lat, device.gate_lng, device.geo_lat, device.geo_lng);
    if (d > device.geo_radius_m + Math.min(device.geo_accuracy_m || 0, 500)) return "outside_geofence";
  }
  return null;
}

/* ======================= معالجة المسح ======================= */
export const REASONS = {
  bad_format: "هذا الرمز ليس بطاقة حضور",
  other_school: "هذه البطاقة لمدرسة أخرى",
  unknown_token: "بطاقة غير معروفة",
  revoked_token: "هذه البطاقة ملغاة — راجع الإدارة",
  legacy_disabled: "بطاقة قديمة — اطبع بطاقة الحضور الجديدة",
  student_inactive: "الطالب غير مقيد حاليًا",
  outside_year: "خارج السنة الدراسية الحالية",
  no_school_day: "لا يوجد دوام اليوم",
  before_window: "لم يبدأ وقت تسجيل الحضور بعد",
  outside_window: "انتهى وقت تسجيل الحضور",
  clock_invalid: "وقت الجهاز غير صحيح",
  too_old: "المسح قديم جدًا ولم يُقبل",
  device_inactive: "الجهاز غير مفعّل",
  gate_inactive: "البوابة موقوفة",
  outside_network: "الجهاز خارج شبكة المدرسة",
  outside_geofence: "الجهاز بعيد عن موقع البوابة",
  no_arrival: "لم يُسجَّل حضوره اليوم — لا يمكن تسجيل انصرافه",
};
const MAX_OFFLINE_HOURS = 12;
export const scanBody = z.object({
  event_id: z.string().uuid(),
  code: z.string().trim().min(4).max(400),
  client_ts: z.coerce.number().int().positive().optional(),
  offline: z.boolean().default(false),
  skew_ms: z.coerce.number().int().min(-2e9).max(2e9).optional(),
  direction: z.enum(["in", "out"]).default("in"),
  source: z.enum(["qr", "nfc"]).default("qr"),
});
export const batchBody = z.object({ events: z.array(scanBody).min(1).max(200) });

async function eventResult(q, ev, tz) {
  const [s] = ev.student_id ? await q(
    `SELECT s.id, s.full_name AS name, c.name AS class_name, a.status, a.minutes_late FROM students s
       LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $2
      WHERE s.id = $1`, [ev.student_id, ev.day]) : [];
  return {
    event_id: ev.event_id, result: ev.result, reason: ev.reason, message: ev.reason ? REASONS[ev.reason] || ev.reason : null,
    student: s ? { id: s.id, name: s.name, class_name: s.class_name } : null,
    status: s?.status || null, minutes_late: s?.minutes_late ?? null,
    time: time12(new Date(ev.effective_ts), tz), offline: ev.offline, suspicious: ev.suspicious || null, day: ev.day,
    direction: ev.direction || "in",
  };
}

/**
 * مسح بطاقة من جهاز بوابة. يتحقق في الخادم من كل شيء (لا يعتمد على قرار الجهاز)،
 * ويحفظ الحدث دائمًا (حتى المرفوض)، ويكتب سجل الحضور مرة واحدة فقط في اليوم.
 */
export async function processScan(q, device, ev, { school, actor, ip = null }) {
  const { timezone } = await getQuiet(q);
  const [done] = await q("SELECT * FROM attendance_events WHERE event_id = $1", [ev.event_id]);
  if (done) return { ...(await eventResult(q, done, timezone)), replay: true };

  const now = new Date();
  // الوقت المعتمد: وقت الخادم عند الاتصال، ووقت الجهاز مصححًا بفرق ساعته عند المزامنة بعد انقطاع
  let effective = now, reason = null, suspicious = null;
  if (ev.offline && ev.client_ts) {
    effective = new Date(ev.client_ts + (ev.skew_ms ?? 0));
    if (ev.skew_ms === undefined) suspicious = "no_clock_ref";
    if (effective.getTime() > now.getTime() + 120_000) { reason = "clock_invalid"; effective = now; }
    else if (now.getTime() - effective.getTime() > MAX_OFFLINE_HOURS * 3600_000) reason = "too_old";
  }
  const { day, hm } = local(effective, timezone);
  const settings = await featureSettings(q, "gate");
  let student = null, credentialId = null, kind = ev.source === "nfc" ? "nfc" : "qr";
  // الاتجاه حسب البوابة: بوابة دخول فقط أو انصراف فقط تفرض اتجاهها، و«الاثنين» تأخذ اختيار الحارس
  const direction = device.direction === "out" ? "out" : device.direction === "both" ? (ev.direction || "in") : "in";

  if (!reason && device.status !== "active") reason = "device_inactive";
  if (!reason && !device.gate_active) reason = "gate_inactive";
  if (!reason) {
    const place = await placeCheck(q, device, settings, { ip, offline: ev.offline });
    if (place && settings.location_mode === "block") reason = place;
    else if (place) suspicious = place;
  }
  if (!reason) {
    const p = parseCode(ev.code, school);
    if (p.error) reason = p.error;
    else if (p.token) {
      const [c] = await q("SELECT id, student_id, status FROM attendance_credentials WHERE token_hash = $1", [hashToken(p.token)]);
      if (!c) reason = "unknown_token";
      else {
        credentialId = c.id;
        student = c.student_id;
        if (c.status !== "active") { reason = "revoked_token"; suspicious = "revoked_card"; }
      }
    } else {
      kind = "legacy";
      if (!settings.legacy_cards) reason = "legacy_disabled";
      else {
        const [s] = await q("SELECT id FROM students WHERE access_key = $1", [p.legacy]);
        if (!s) reason = "unknown_token"; else student = s.id;
      }
    }
  }
  let st = null;
  if (student) {
    [st] = await q(`SELECT s.id, s.full_name, s.status, s.archived_at, c.name AS class_name, gr.stage_id FROM students s
                      LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN grades gr ON gr.id = c.grade_id WHERE s.id = $1`, [student]);
    if (!reason && (!st || st.status !== "active" || st.archived_at)) reason = "student_inactive";
  }
  let win = null;
  if (!reason) {
    const [year] = await q("SELECT start_date, end_date FROM academic_years WHERE is_current LIMIT 1");
    if (year && (day < year.start_date || day > year.end_date)) reason = "outside_year";
  }
  if (!reason) {
    const ds = await dayStatus(q, day);
    win = await windowFor(q, day, st?.stage_id ?? null);
    if (win.mode === "no_attendance" || ds.holiday || !ds.study_day) reason = "no_school_day";
    else if (direction === "out") {
      // الانصراف: بعد بداية الدوام في نفس اليوم فقط (لا يرتبط بنافذة تسجيل الحضور)
      if (hm < win.open_at) reason = "before_window";
    } else {
      const today = local(now, timezone).day;
      const phase = phaseOf(win, hm, day === today, day < today);
      // حدث وصل بعد انقطاع: يُقبل إن كان وقته داخل النافذة ولم يُعتمد اليوم بعد
      const inWindow = hm >= win.open_at && hm <= win.close_at;
      if (hm < win.open_at) reason = "before_window";
      else if (!inWindow || phase === "finalized" || (!ev.offline && phase !== "open")) reason = "outside_window";
    }
  }

  let result = "rejected", attendanceId = null, notifyKind = null, minutesLate = null, newStatus = null;
  if (!reason && direction === "out") {
    const [prev] = await q("SELECT id, status, last_out_at FROM attendance WHERE student_id = $1 AND day = $2 FOR UPDATE", [student, day]);
    if (!prev || prev.status === "absent") reason = "no_arrival";
    else {
      attendanceId = prev.id;
      if (prev.last_out_at && Math.abs(effective - new Date(prev.last_out_at)) < 120_000) result = "duplicate";
      else {
        await q("UPDATE attendance SET last_out_at = $2, out_gate_id = $3 WHERE id = $1", [prev.id, effective, device.gate_id]);
        result = "departed"; notifyKind = "departed";
      }
    }
  } else if (!reason) {
    const late = hm > win.late_after;
    minutesLate = late ? toMin(hm) - toMin(win.late_after) : null;
    newStatus = late ? "late" : "present";
    const [prev] = await q("SELECT id, status, source, first_in_at FROM attendance WHERE student_id = $1 AND day = $2 FOR UPDATE", [student, day]);
    // نفس البطاقة من بوابة أخرى خلال ثوانٍ: مشبوه (صورة بطاقة مثلًا)
    const [near] = await q(
      `SELECT gate_id FROM attendance_events WHERE student_id = $1 AND day = $2 AND result <> 'rejected' AND gate_id IS DISTINCT FROM $3
          AND abs(extract(epoch FROM (effective_ts - $4::timestamptz))) <= $5 LIMIT 1`,
      [student, day, device.gate_id, effective, settings.suspicious_seconds]);
    if (near) suspicious = "two_gates";
    if (!prev) {
      const [a] = await q(
        `INSERT INTO attendance (tenant_id, student_id, day, status, note, recorded_by, source, gate_id, device_id, first_in_at, minutes_late, offline)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, 'gate', $6, $7, $8, $9, $10) RETURNING id`,
        [student, day, newStatus, `بوابة: ${device.gate_name}`, actor, device.gate_id, device.id, effective, minutesLate, Boolean(ev.offline)]);
      attendanceId = a.id; result = newStatus; notifyKind = newStatus;
    } else if (prev.status === "absent") {
      // سُجّل غائبًا (من المعلم مثلًا) ثم وصل: يتحول لحاضر/متأخر، ويُحفظ التغيير في سجل التعديلات
      await q(`UPDATE attendance SET status = $2, source = 'gate', gate_id = $3, device_id = $4, first_in_at = $5, minutes_late = $6, offline = $7,
                      excuse = NULL, recorded_by = $8, note = $9 WHERE id = $1`,
      [prev.id, newStatus, device.gate_id, device.id, effective, minutesLate, Boolean(ev.offline), actor, `وصل عند ${device.gate_name} بعد تسجيله غائبًا`]);
      await q(`INSERT INTO attendance_audit (tenant_id, student_id, day, actor, old_status, new_status, old_source, new_source, reason, device)
               VALUES (app_tenant(), $1, $2, $3, 'absent', $4, $5, 'gate', 'وصل عند البوابة', $6)`,
      [student, day, actor, newStatus, prev.source, device.name]);
      attendanceId = prev.id; result = newStatus; notifyKind = newStatus;
    } else if (["present", "late"].includes(prev.status)) {
      attendanceId = prev.id; result = "duplicate";
      // حدث أبكر وصل متأخرًا (جهاز كان بلا اتصال): يُعتمد الوقت الأبكر لسجلات البوابة، دون إشعار ثانٍ
      if (prev.source === "gate" && prev.first_in_at && effective < new Date(prev.first_in_at)) {
        await q("UPDATE attendance SET first_in_at = $2, status = $3, minutes_late = $4, gate_id = $5, device_id = $6 WHERE id = $1",
          [prev.id, effective, newStatus, minutesLate, device.gate_id, device.id]);
      }
    } else {
      // مستأذن / بعذر / رحلة / نشاط: تبقى الحالة ويُحفظ وقت الدخول للمعلومية
      attendanceId = prev.id; result = "kept";
      if (!prev.first_in_at) await q("UPDATE attendance SET first_in_at = $2, gate_id = $3, device_id = $4 WHERE id = $1", [prev.id, effective, device.gate_id, device.id]);
    }
  }

  const [row] = await q(
    `INSERT INTO attendance_events (tenant_id, event_id, day, device_id, gate_id, credential_id, student_id, kind, client_ts, effective_ts,
                                    offline, result, reason, suspicious, review_state, attendance_id, direction)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING *`,
    [ev.event_id, day, device.id, device.gate_id, credentialId, st ? student : null, kind, ev.client_ts ? new Date(ev.client_ts) : null,
      effective, Boolean(ev.offline), result, reason, suspicious, suspicious ? "open" : null, attendanceId, direction]);
  if (!row) {
    const [same] = await q("SELECT * FROM attendance_events WHERE event_id = $1", [ev.event_id]);
    return { ...(await eventResult(q, same, timezone)), replay: true };
  }

  if (notifyKind && st) {
    const at = time12(effective, timezone);
    if (notifyKind === "present" && settings.notify_present) {
      await notify(q, { event: "arrival", students: [student], title: `وصل ${st.full_name} المدرسة`,
        body: `سُجّل حضوره عند ${device.gate_name} الساعة ${at}.`, link: "attendance", dedupKey: `${student}:${day}:arrival`, dedupMinutes: 24 * 60 });
    } else if (notifyKind === "departed" && settings.notify_departure) {
      await notify(q, { event: "departure", students: [student], title: `انصرف ${st.full_name} من المدرسة`,
        body: `سُجّل انصرافه عند ${device.gate_name} الساعة ${at}.`, link: "attendance", dedupKey: `${student}:${day}:departure`, dedupMinutes: 12 * 60 });
    } else if (notifyKind === "late" && settings.notify_late) {
      await notify(q, { event: "late", students: [student], title: `تأخر: ${st.full_name}`,
        body: `وصل المدرسة الساعة ${at} متأخرًا ${minutesLate} دقيقة.`, link: "attendance", dedupKey: `${student}:${day}:late`, dedupMinutes: 24 * 60 });
    }
  }
  return eventResult(q, row, timezone);
}

/* ======================= اليوم: المتابعة والمراجعة والاعتماد ======================= */
export async function daySummary(q, day) {
  const { timezone } = await getQuiet(q);
  const now = local(new Date(), timezone);
  const ds = await dayStatus(q, day);
  const win = await windowFor(q, day);
  const [c] = await q(
    `SELECT count(*)::int AS students,
            count(a.id)::int AS recorded,
            count(a.id) FILTER (WHERE a.status = 'present')::int AS present,
            count(a.id) FILTER (WHERE a.status = 'late')::int AS late,
            count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
            count(a.id) FILTER (WHERE a.status = 'excused')::int AS excused,
            count(a.id) FILTER (WHERE a.status = 'permitted')::int AS permitted,
            count(a.id) FILTER (WHERE a.status IN ('trip', 'activity'))::int AS out_of_school,
            count(a.id) FILTER (WHERE a.source = 'gate')::int AS by_gate,
            count(a.id) FILTER (WHERE a.source IN ('manual', 'teacher'))::int AS by_hand,
            count(a.id) FILTER (WHERE a.last_out_at IS NOT NULL)::int AS departed
       FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $1
      WHERE s.status = 'active' AND s.archived_at IS NULL`, [day]);
  const gates = await q(
    `SELECT g.id, g.name, count(a.id)::int AS n FROM gates g LEFT JOIN attendance a ON a.gate_id = g.id AND a.day = $1
      GROUP BY g.id ORDER BY g.id`, [day]);
  const [{ suspicious }] = await q("SELECT count(*)::int AS suspicious FROM attendance_events WHERE day = $1 AND review_state = 'open'", [day]);
  const off = noSchool(ds, win);
  const phase = off ? "no_school" : phaseOf(win, now.hm, day === now.day, day < now.day);
  return {
    day, today: now.day, now: now.hm, phase, no_school_reason: off,
    window: { open_at: win.open_at, late_after: win.late_after, close_at: win.close_at, mode: win.mode, note: win.note },
    state: win.state, finalized_by: win.finalized_by, finalized_at: win.finalized_at, absence_notified_at: win.absence_notified_at,
    absence_notify_at: win.settings.absence_notify_at,
    counts: { ...c, unrecorded: c.students - c.recorded, suspicious }, gates,
    rate: c.recorded ? Math.round(((c.present + c.late) / Math.max(1, c.recorded - c.excused - c.permitted - c.out_of_school)) * 1000) / 10 : null,
  };
}

export const feedQuery = z.object({ date: t.date, after: z.coerce.number().int().min(0).default(0), gate_id: t.id.optional() });
/** آخر المسحات (مباشر): الطالب، الشعبة، الوقت، النتيجة، البوابة */
export async function feed(q, { date, after, gate_id }) {
  const { timezone } = await getQuiet(q);
  const rows = await q(
    `SELECT e.id, e.result, e.reason, e.suspicious, e.offline, e.effective_ts, e.kind, e.direction, s.full_name AS name, c.name AS class_name,
            g.name AS gate_name, d.name AS device_name, a.minutes_late
       FROM attendance_events e LEFT JOIN students s ON s.id = e.student_id LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN gates g ON g.id = e.gate_id LEFT JOIN gate_devices d ON d.id = e.device_id
       LEFT JOIN attendance a ON a.id = e.attendance_id
      WHERE e.day = $1 AND e.id > $2 AND ($3::bigint IS NULL OR e.gate_id = $3)
      ORDER BY e.id DESC LIMIT 60`, [date, after, gate_id ?? null]);
  for (const r of rows) { r.time = time12(new Date(r.effective_ts), timezone); r.message = r.reason ? REASONS[r.reason] || r.reason : null; }
  return rows;
}

/** «لم يسجل حضور»: الطلاب المقيدون بلا سجل في هذا اليوم (محسوبة — لا تُكتب غيابًا قبل الاعتماد) */
export async function unrecorded(q, day) {
  return q(
    `SELECT s.id, s.full_name AS name, s.class_id, c.name AS class_name, gr.name AS grade_name, st.name AS stage_name,
            (SELECT e.reason FROM attendance_events e WHERE e.student_id = s.id AND e.day = $1 AND e.result = 'rejected'
              ORDER BY e.id DESC LIMIT 1) AS last_rejected
       FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN grades gr ON gr.id = c.grade_id LEFT JOIN stages st ON st.id = gr.stage_id
      WHERE s.status = 'active' AND s.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.day = $1)
      ORDER BY st.sort_order NULLS LAST, gr.sort_order NULLS LAST, c.sort_order NULLS LAST, c.id, s.full_name`, [day]);
}

export const exceptionsBody = z.object({
  date: t.date,
  reason: z.string().trim().min(2).max(200),
  status: z.enum(["present", "late", "excused", "permitted", "trip", "activity"]),
  excuse: t.optText(200),
  student_ids: z.array(t.id).min(1).max(1000),
});
/** استثناءات المراجعة (جماعية): رحلة، نشاط، بعذر، مستأذن، أو حاضر يدويًا — بسبب إلزامي، وتُدقَّق */
export async function setExceptions(q, b, { actor, ip, device }) {
  const win = await windowFor(q, b.date);
  if (win.state === "finalized") throw conflict("اعتُمد غياب هذا اليوم. عدّل الطالب من شاشة الحضور بسبب.");
  return mark(q, { date: b.date, reason: b.reason, entries: b.student_ids.map((id) => ({ student_id: id, status: b.status, excuse: b.excuse })) },
    { actor, allowedClass: async () => true, source: "manual", ip, device, forceReason: true });
}

export const finalizeBody = z.object({ date: t.date });
/** اعتماد الغياب: المتبقون في «لم يسجل حضور» يُكتبون غائبين، ثم يُبلَّغ أولياء أمورهم في وقت الإشعار المضبوط */
export async function finalizeDay(q, day, { actor }) {
  const sum = await daySummary(q, day);
  if (sum.phase === "no_school") throw badRequest(sum.no_school_reason);
  if (sum.phase === "finalized") throw conflict("اعتُمد غياب هذا اليوم من قبل");
  if (sum.phase !== "closed") throw conflict(`لم ينتهِ وقت الحضور بعد (يُغلق ${sum.window.close_at})`);
  const rows = await q(
    `INSERT INTO attendance (tenant_id, student_id, day, status, note, recorded_by, source, reviewed_by)
     SELECT app_tenant(), s.id, $1, 'absent', 'لم يسجل حضورًا (اعتماد المراجعة)', $2, 'review', $2
       FROM students s WHERE s.status = 'active' AND s.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.day = $1)
     ON CONFLICT (student_id, day) DO NOTHING RETURNING student_id`, [day, actor]);
  await q(`INSERT INTO attendance_days (tenant_id, day, state, closed_at, finalized_by, finalized_at, absent_count)
           VALUES (app_tenant(), $1, 'finalized', now(), $2, now(), $3)
           ON CONFLICT (tenant_id, day) DO UPDATE SET state = 'finalized', closed_at = COALESCE(attendance_days.closed_at, now()),
             finalized_by = EXCLUDED.finalized_by, finalized_at = now(), absent_count = EXCLUDED.absent_count`, [day, actor, rows.length]);
  const { timezone } = await getQuiet(q);
  const now = local(new Date(), timezone);
  let notified = 0;
  if (day < now.day || now.hm >= sum.absence_notify_at) notified = await notifyAbsences(q, day);
  return { absent: rows.length, notified, notify_at: notified ? null : sum.absence_notify_at };
}

/** إشعار الغياب المعتمد (مرة واحدة لليوم) */
export async function notifyAbsences(q, day) {
  const [d] = await q("SELECT state, absence_notified_at FROM attendance_days WHERE day = $1 FOR UPDATE", [day]);
  if (!d || d.state !== "finalized" || d.absence_notified_at) return 0;
  const settings = await featureSettings(q, "gate");
  const rows = settings.notify_absent ? await q(
    `SELECT s.id, s.full_name FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE a.day = $1 AND a.status = 'absent' AND a.source = 'review'`, [day]) : [];
  for (const s of rows) {
    await notify(q, { event: "absence", students: [s.id], urgent: true, title: `غياب: ${s.full_name}`,
      body: `لم يحضر ${s.full_name} إلى المدرسة اليوم ${day}. إن كان لديه عذر أرسله من ملف الطالب.`,
      link: "attendance", dedupKey: `${s.id}:${day}:absent`, dedupMinutes: 24 * 60 });
  }
  await q("UPDATE attendance_days SET absence_notified_at = now() WHERE day = $1", [day]);
  return rows.length;
}

export const dayModeBody = z.object({
  date: t.date, mode: z.enum(["normal", "custom_hours", "no_attendance"]), note: t.optText(200),
  open_at: z.string().regex(/^\d\d:\d\d$/).optional(), late_after: z.string().regex(/^\d\d:\d\d$/).optional(), close_at: z.string().regex(/^\d\d:\d\d$/).optional(),
});
/** يوم استثنائي: أوقات خاصة (اختبارات) أو بلا حضور (رحلة عامة، فعالية) */
export async function setDayMode(q, b) {
  const custom = b.mode === "custom_hours";
  if (custom && !(b.open_at && b.late_after && b.close_at && b.open_at <= b.late_after && b.late_after < b.close_at)) {
    throw badRequest("الأوقات: البداية ≤ وقت التأخر < الإغلاق");
  }
  const [d] = await q("SELECT state FROM attendance_days WHERE day = $1", [b.date]);
  if (d?.state === "finalized") throw conflict("اعتُمد غياب هذا اليوم");
  await q(`INSERT INTO attendance_days (tenant_id, day, mode, open_at, late_after, close_at, note)
           VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, day) DO UPDATE SET mode = EXCLUDED.mode, open_at = EXCLUDED.open_at,
             late_after = EXCLUDED.late_after, close_at = EXCLUDED.close_at, note = EXCLUDED.note`,
  [b.date, b.mode, custom ? b.open_at : null, custom ? b.late_after : null, custom ? b.close_at : null, b.note ?? null]);
  return { ok: true };
}

export async function suspiciousList(q, day) {
  const { timezone } = await getQuiet(q);
  const rows = await q(
    `SELECT e.id, e.suspicious, e.reason, e.result, e.effective_ts, e.review_state, s.full_name AS name, c.name AS class_name, g.name AS gate_name, d.name AS device_name
       FROM attendance_events e LEFT JOIN students s ON s.id = e.student_id LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN gates g ON g.id = e.gate_id LEFT JOIN gate_devices d ON d.id = e.device_id
      WHERE e.day = $1 AND e.suspicious IS NOT NULL ORDER BY e.id DESC LIMIT 200`, [day]);
  for (const r of rows) r.time = time12(new Date(r.effective_ts), timezone);
  return rows;
}
export async function reviewSuspicious(q, id, state, { actor }) {
  const rows = await q("UPDATE attendance_events SET review_state = $2, reviewed_by = $3 WHERE id = $1 AND suspicious IS NOT NULL RETURNING id", [id, state, actor]);
  if (!rows.length) throw notFound("الحدث غير موجود");
  return { ok: true };
}

/* ======================= المهمة الدورية (كل 5 دقائق) ======================= */
/** لكل مدرسة فيها بوابة: إغلاق النافذة وتنبيه الإدارة بالمراجعة، والاعتماد التلقائي إن فُعّل، وإرسال إشعارات الغياب في وقتها */
export async function gateTickTenant(q) {
  const [{ n }] = await q("SELECT count(*)::int AS n FROM gates");
  if (!n) return null;
  const { timezone } = await getQuiet(q);
  const { day, hm } = local(new Date(), timezone);
  const sum = await daySummary(q, day);
  const out = { day, phase: sum.phase };
  if (sum.phase === "closed" && sum.state === "open") {
    await q(`INSERT INTO attendance_days (tenant_id, day, state, closed_at) VALUES (app_tenant(), $1, 'closed', now())
             ON CONFLICT (tenant_id, day) DO UPDATE SET state = 'closed', closed_at = now() WHERE attendance_days.state = 'open'`, [day]);
    await notify(q, { event: "gate", users: await adminUserIds(q), title: `لم يسجل حضور: ${sum.counts.unrecorded} طالب`,
      body: "انتهى وقت الحضور. راجع القائمة وسجّل الاستثناءات ثم اعتمد الغياب ليصل أولياء الأمور.", link: "attendance",
      dedupKey: `review:${day}`, dedupMinutes: 24 * 60 });
    out.closed = true;
  }
  const s = await featureSettings(q, "gate");
  // جهاز بوابة مفعّل انقطع أثناء نافذة الحضور: تنبيه الإدارة مرة واحدة لليوم لكل جهاز
  if (sum.phase === "open") {
    const lost = await q(
      `UPDATE gate_devices SET offline_alerted_on = $1
        WHERE status = 'active' AND last_seen_at IS NOT NULL AND last_seen_at < now() - make_interval(mins => $2)
          AND last_seen_at > now() - interval '18 hours' AND offline_alerted_on IS DISTINCT FROM $1::date
        RETURNING name`, [day, s.device_offline_alert_min]);
    if (lost.length) {
      await notify(q, { event: "gate", users: await adminUserIds(q), title: `جهاز بوابة غير متصل: ${lost.map((d) => d.name).join("، ")}`,
        body: "لم يتصل الجهاز منذ دقائق أثناء وقت الحضور. المسحات تُحفظ عليه وتُرسل عند عودة الاتصال، لكن تأكد من الشبكة والبطارية.",
        link: "attendance", dedupKey: `device-offline:${day}:${lost.map((d) => d.name).join(",")}`, dedupMinutes: 12 * 60 });
      out.offline_devices = lost.length;
    }
  }
  if (s.auto_finalize && sum.phase === "closed" && hm >= s.absence_notify_at) {
    out.finalized = await finalizeDay(q, day, { actor: "النظام" });
  }
  if (sum.state === "finalized" && !sum.absence_notified_at && hm >= sum.absence_notify_at) out.notified = await notifyAbsences(q, day);
  // طالب جديد يأخذ رمز حضوره تلقائيًا
  out.tokens = await ensureTokens(q);
  return out;
}
export async function runGateTick() {
  const tenants = await transaction({ platform: true, actor: "النظام" }, (q) =>
    q("SELECT id FROM tenants WHERE status = 'active' AND emergency_locked_at IS NULL"));
  for (const t of tenants) {
    try { await transaction({ tenantId: t.id, actor: "النظام" }, gateTickTenant); } catch (e) { console.error(`[البوابة ${t.id}]`, e.message); }
  }
}

/* ======================= السجلات (تصفية) ======================= */
export const recordsQuery = z.object({
  date: t.date, stage_id: t.id.optional(), grade_id: t.id.optional(), class_id: t.id.optional(), gate_id: t.id.optional(),
  status: z.enum(["present", "late", "absent", "excused", "permitted", "trip", "activity", "unrecorded"]).optional(),
  source: z.enum(["gate", "manual", "teacher", "review", "sync", "import", "excuse"]).optional(),
  from: z.string().regex(/^\d\d:\d\d$/).optional(), to: z.string().regex(/^\d\d:\d\d$/).optional(),
  q: z.string().trim().max(60).optional(), offline: z.enum(["1"]).optional(),
});
/** سجلات يوم بكل التصفيات: المرحلة، الصف، الشعبة، البوابة، الحالة، المصدر، وقت الوصول، اسم الطالب */
export async function records(q, f) {
  const { timezone } = await getQuiet(q);
  const rows = await q(
    `SELECT s.id, s.full_name AS name, c.name AS class_name, gr.name AS grade_name, st.name AS stage_name,
            a.status, a.source, a.first_in_at, a.last_out_at, a.minutes_late, a.offline, a.excuse, a.recorded_by,
            g.name AS gate_name, og.name AS out_gate_name,
            to_char(a.first_in_at AT TIME ZONE $2, 'HH24:MI') AS in_hm
       FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN grades gr ON gr.id = c.grade_id LEFT JOIN stages st ON st.id = gr.stage_id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $1
       LEFT JOIN gates g ON g.id = a.gate_id LEFT JOIN gates og ON og.id = a.out_gate_id
      WHERE s.status = 'active' AND s.archived_at IS NULL
        AND ($3::bigint IS NULL OR st.id = $3) AND ($4::bigint IS NULL OR gr.id = $4) AND ($5::bigint IS NULL OR c.id = $5)
        AND ($6::bigint IS NULL OR a.gate_id = $6)
        AND ($7::text IS NULL OR ($7 = 'unrecorded' AND a.id IS NULL) OR a.status = $7)
        AND ($8::text IS NULL OR a.source = $8)
        AND ($9::text IS NULL OR to_char(a.first_in_at AT TIME ZONE $2, 'HH24:MI') >= $9)
        AND ($10::text IS NULL OR to_char(a.first_in_at AT TIME ZONE $2, 'HH24:MI') <= $10)
        AND ($11::text IS NULL OR s.full_name ILIKE '%' || $11 || '%')
        AND ($12::boolean IS NULL OR a.offline = $12)
      ORDER BY a.first_in_at NULLS LAST, st.sort_order NULLS LAST, gr.sort_order NULLS LAST, c.id, s.full_name
      LIMIT 2000`,
    [f.date, timezone, f.stage_id ?? null, f.grade_id ?? null, f.class_id ?? null, f.gate_id ?? null, f.status ?? null, f.source ?? null,
      f.from ?? null, f.to ?? null, f.q || null, f.offline ? true : null]);
  for (const r of rows) {
    r.in_time = r.first_in_at ? time12(new Date(r.first_in_at), timezone) : null;
    r.out_time = r.last_out_at ? time12(new Date(r.last_out_at), timezone) : null;
    delete r.in_hm;
  }
  return rows;
}
