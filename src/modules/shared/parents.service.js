// حساب ولي الأمر الموحّد: حساب واحد في المدرسة (جوال + كلمة مرور) مرتبط بكل أبنائه عبر جدول ربط مستقل.
//   - الربط بمعرّفات ثابتة (parent_id ↔ student_id) لا بالاسم ولا بالصف: نقل الطالب لا يمس العلاقة.
//   - الطالب الواحد قد يرتبط بأكثر من ولي أمر (الأب والأم)، ولكلٍّ حسابه.
//   - فك الارتباط لا يحذف السجل (removed_at)، والطالب المؤرشف يبقى في السجل ويُعرض كـ«سابق».
//   - كل طلب لملف طالب يتحقق في الخادم أن الطالب مرتبط فعلًا بولي الأمر المسجّل (وإلا 403 بلا بيانات).
import { z, t } from "../../core/http/validate.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../core/http/errors.js";
import { hashPassword, verifyPassword, canonPassword } from "../../core/auth/password.js";
import { newTempPassword, safeEqual } from "../../core/auth/codes.js";
import { sealCredential, openCredential } from "../../core/auth/secret-box.js";
import { readSession } from "../../core/auth/sessions.js";
import { securityEvent, recentFailures, logEvent } from "../../core/audit.js";
import { normalizePhone } from "./students.service.js";
import { featureSettings } from "./feature-settings.service.js";
import { notify, adminUserIds, activeModules, pushPublicKey } from "./notify.service.js";

export const RELATIONS = { father: "الأب", mother: "الأم", guardian: "ولي الأمر", other: "آخر" };
const tenantOf = async (q) => (await q("SELECT app_tenant() AS t"))[0].t;

/* ======================= المدخلات ======================= */
const phone = z.string().trim().min(6).max(25).transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p || !/^\+?[0-9]{6,20}$/.test(p)) { ctx.addIssue({ code: "custom", message: "رقم الجوال غير صحيح" }); return z.NEVER; }
  return p;
});
const parentPassword = z.preprocess((v) => (typeof v === "string" ? canonPassword(v) : v),
  z.string().min(8, "كلمة المرور 8 أحرف أو أرقام على الأقل").max(200));
const relation = z.enum(["father", "mother", "guardian", "other"]);
// معرّف الطالب (مكتوبًا أو من رابط بطاقة ولي الأمر …?k=المعرّف)
const studentKeyOf = z.string().trim().max(400).transform((v, ctx) => {
  let k = v;
  if (/^https?:\/\//i.test(v)) { try { k = new URL(v).searchParams.get("k") || ""; } catch { k = ""; } }
  k = k.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z2-9]{8}$/.test(k)) { ctx.addIssue({ code: "custom", message: "معرّف الطالب غير صحيح" }); return z.NEVER; }
  return `${k.slice(0, 4)}-${k.slice(4)}`;
});

// اسم الدخول: بريد إلكتروني أو رقم جوال (يُقبل الحقل القديم phone أيضًا)
const emailOf = z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح").max(120);
const identifier = z.string().trim().min(3, "اكتب البريد الإلكتروني أو رقم الجوال").max(120).transform((v, ctx) => {
  if (v.includes("@")) {
    const e = emailOf.safeParse(v);
    if (!e.success) { ctx.addIssue({ code: "custom", message: "البريد الإلكتروني غير صحيح" }); return z.NEVER; }
    return { email: e.data };
  }
  const p = normalizePhone(v);
  if (!p || !/^\+?[0-9]{6,20}$/.test(p)) { ctx.addIssue({ code: "custom", message: "اكتب بريدًا إلكترونيًا صحيحًا أو رقم جوال صحيحًا" }); return z.NEVER; }
  return { phone: p };
});
const withIdentifier = (shape) => z.preprocess((v) => (v && typeof v === "object" && v.identifier == null && v.phone != null ? { ...v, identifier: v.phone } : v),
  z.object({ identifier, ...shape }));
export const loginSchema = withIdentifier({ password: z.string().min(1, "اكتب كلمة المرور").max(200) });
export const activateSchema = withIdentifier({ key: studentKeyOf, password: parentPassword, name: t.optText(120), relation: relation.optional() });
// إنشاء الحساب بنفسه: الاسم + البريد أو الجوال + كلمة المرور + معرّفات الأبناء (واحد على الأقل)
export const registerSchema = withIdentifier({ name: z.string().trim().min(2, "اكتب اسمك").max(120), password: parentPassword,
  keys: z.array(z.string().max(400)).min(1, "أضف معرّف ابن واحد على الأقل").max(20), relation: relation.optional() });
export const linkKeysSchema = z.object({ keys: z.array(z.string().max(400)).min(1).max(20), relation: relation.optional() });
export const linkKeySchema = z.object({ key: studentKeyOf, relation: relation.optional() });
export const requestSchema = z.object({ student_no: z.string().trim().min(1).max(30), student_name: z.string().trim().min(2).max(120),
  relation: relation.optional(), note: t.optText(300) });
export const passwordSchema = z.object({ current: z.string().min(1).max(200), next: parentPassword });
export const parentBody = z.object({ name: z.string().trim().min(2).max(120),
  phone: phone.optional().nullable().or(z.literal("").transform(() => null)),
  email: emailOf.optional().nullable().or(z.literal("").transform(() => null)),
  student_ids: z.array(t.id).max(50).optional(), relation: relation.optional() })
  .refine((b) => b.phone || b.email, { message: "اكتب رقم الجوال أو البريد الإلكتروني", path: ["phone"] });
export const linkBody = z.object({ student_id: t.id, relation: relation.optional(), can_view_fees: z.boolean().optional() });

/* ======================= الجلسة والتحقق ======================= */
/** ولي الأمر المسجّل في هذا الطلب (لهذه المدرسة فقط)، أو null */
export async function sessionParent(req, q, tenantId) {
  const s = await readSession(req, "parent");
  if (!s || s.tenant_id !== tenantId || !s.parent_id) return null;
  const [p] = await q("SELECT id, full_name, phone, email, status, must_change_password FROM parents WHERE id = $1", [s.parent_id]);
  return p && p.status === "active" ? p : null;
}

/** الطالب مرتبط فعلًا بولي الأمر (ونشط)؛ غير ذلك 403 بلا أي بيانات */
export async function linkedStudent(q, parentId, studentId) {
  const [s] = await q(
    `SELECT s.*, ps.relation AS link_relation, ps.can_view_fees AS link_can_view_fees
       FROM parent_students ps JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id = $1 AND ps.student_id = $2 AND ps.removed_at IS NULL`, [parentId, studentId]);
  if (!s) throw forbidden("هذا الطالب غير مرتبط بحسابك");
  if (s.status !== "active" || s.archived_at) throw forbidden("ملف هذا الطالب غير متاح حاليًا (غير مقيد في المدرسة)");
  // صلاحية الرسوم لهذه العلاقة: إن مُنعت، يُعامل الملف كأن الرسوم غير مفعّلة (لا تظهر ولا يُدفع منها)
  if (!s.link_can_view_fees) s.fees_enabled = false;
  return s;
}

/* ======================= الدخول ======================= */
const MAX_FAILS = 5, MAX_FAILS_ACCOUNT = 30, LOCK_MIN = 10;
const idText = (id) => id.email || id.phone;
/** الحساب بالبريد أو الجوال */
const findParent = async (q, id, cols = "id") => (id.email
  ? await q(`SELECT ${cols} FROM parents WHERE lower(email) = $1`, [id.email])
  : await q(`SELECT ${cols} FROM parents WHERE phone = $1`, [id.phone]))[0] || null;

export async function login(q, b, { ip }) {
  const tenant = await tenantOf(q);
  const who = idText(b.identifier);
  const ipKey = `${tenant}:${who}:${ip || "?"}`, acctKey = `${tenant}:${who}`;
  const p = await findParent(q, b.identifier, "id, full_name, password_hash, status, must_change_password");
  const ok = await verifyPassword(b.password, p?.password_hash, { temporary: Boolean(p?.must_change_password) });
  if ((await recentFailures(q, "parent_login_failed_ip", ipKey, LOCK_MIN)) >= MAX_FAILS
      || (await recentFailures(q, "parent_login_failed", acctKey, LOCK_MIN)) >= MAX_FAILS_ACCOUNT) {
    return { error: `تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة. حاول بعد ${LOCK_MIN} دقائق.`, status: 429 };
  }
  if (!p || !p.password_hash || p.status !== "active" || !ok) {
    return { fail: true, ipKey, acctKey, error: p?.status === "disabled" ? "الحساب موقوف. تواصل مع المدرسة." : "البريد أو رقم الجوال أو كلمة المرور غير صحيحة" };
  }
  await q("DELETE FROM security_events WHERE kind = 'parent_login_failed_ip' AND subject = $1", [ipKey]);
  await q("UPDATE parents SET last_login_at = now() WHERE id = $1", [p.id]);
  await logEvent(q, { tenantId: tenant, actor: p.full_name, action: "دخول ولي أمر" });
  return { parent: p };
}
/** تسجيل المحاولة الخاطئة في معاملة مستقلة (لا تُلغى مع رسالة الخطأ) */
export async function recordFailure(q, f, { ip }) {
  const tenant = await tenantOf(q);
  await securityEvent(q, { kind: "parent_login_failed_ip", subject: f.ipKey, tenantId: tenant, ip });
  await securityEvent(q, { kind: "parent_login_failed", subject: f.acctKey, tenantId: tenant, ip });
}

/* ======================= الربط ======================= */
/** ربط طالب بولي أمر (لا يكرر علاقة فعالة) */
export async function link(q, parentId, studentId, { actor, source = "admin", relation: rel = null, canViewFees = null } = {}) {
  const [s] = await q("SELECT id, full_name, status, archived_at FROM students WHERE id = $1", [studentId]);
  if (!s) throw notFound("الطالب غير موجود");
  const rows = await q(
    `INSERT INTO parent_students (tenant_id, parent_id, student_id, relation, source, created_by, can_view_fees)
     VALUES (app_tenant(), $1, $2, COALESCE($3, 'guardian'), $4, $5, COALESCE($6, true))
     ON CONFLICT (tenant_id, parent_id, student_id) WHERE removed_at IS NULL DO NOTHING RETURNING id`,
    [parentId, studentId, rel, source, actor, canViewFees]);
  if (!rows.length && (rel || canViewFees !== null)) {
    await q(`UPDATE parent_students SET relation = COALESCE($3, relation), can_view_fees = COALESCE($4, can_view_fees)
              WHERE parent_id = $1 AND student_id = $2 AND removed_at IS NULL`, [parentId, studentId, rel, canViewFees]);
  }
  // طلب معلق لنفس الطالب: يُغلق بالموافقة
  await q(`UPDATE parent_link_requests SET status = 'approved', decided_by = $3, decided_at = now()
            WHERE parent_id = $1 AND student_id = $2 AND status = 'pending'`, [parentId, studentId, actor]);
  return { linked: rows.length > 0, student: { id: s.id, name: s.full_name } };
}
/** فك الارتباط: السجل يبقى للتاريخ، واشتراكات إشعار ولي الأمر لهذا الطالب تُزال */
export async function unlink(q, parentId, studentId, { actor }) {
  const rows = await q(`UPDATE parent_students SET removed_at = now(), removed_by = $3
                         WHERE parent_id = $1 AND student_id = $2 AND removed_at IS NULL RETURNING id`, [parentId, studentId, actor]);
  if (!rows.length) throw notFound("الطالب غير مرتبط بهذا الحساب");
  await q("DELETE FROM push_subscriptions WHERE parent_id = $1 AND student_id = $2", [parentId, studentId]);
  return { ok: true };
}

const KEY_FAILS = 10, KEY_LOCK_MIN = 30;
const keyLock = async (q, ip) => {
  const subject = `${await tenantOf(q)}:${ip || "?"}`;
  return { subject, locked: (await recentFailures(q, "parent_activate_failed", subject, KEY_LOCK_MIN)) >= KEY_FAILS };
};
const keyFail = async (q, subject, ip) => securityEvent(q, { kind: "parent_activate_failed", subject, tenantId: await tenantOf(q), ip });
const LOCKED = { error: `تم إيقاف المحاولة مؤقتًا بسبب محاولات خاطئة كثيرة. حاول بعد ${KEY_LOCK_MIN} دقيقة.`, status: 429 };
const isActive = (s) => s && s.status === "active" && !s.archived_at;
const guardianOf = (s, id) => Boolean(id.phone) && safeEqual(normalizePhone(s.guardian_phone) || "", id.phone);
const isLinked = async (q, parentId, studentId) => (await q(
  "SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2 AND removed_at IS NULL", [parentId, studentId])).length > 0;

/** معرّفات مكتوبة أو روابط بطاقات ← طلاب (مع موضع كل معرّف غير صحيح) */
async function studentsByKeys(q, raw) {
  const found = [], invalid = [], seen = new Set();
  for (const [i, v] of raw.entries()) {
    const k = studentKeyOf.safeParse(String(v || ""));
    if (!k.success) { if (String(v || "").trim()) invalid.push(i); continue; }
    if (seen.has(k.data)) continue;
    seen.add(k.data);
    const [s] = await q("SELECT id, full_name, guardian_phone, guardian_name, status, archived_at FROM students WHERE access_key = $1", [k.data]);
    if (isActive(s)) found.push(s); else invalid.push(i);
  }
  return { found, invalid };
}
const keysError = (invalid) => ({ error: invalid.length === 1 ? "أحد المعرّفات غير صحيح أو الطالب غير مقيد. تأكد منه." : "بعض المعرّفات غير صحيحة أو الطلاب غير مقيدين. تأكد منها.",
  invalid, status: 400 });

/** ربط مجموعة طلاب بالحساب: مباشرة إن سمحت المدرسة، وإلا طلبات تراجعها الإدارة */
async function attach(q, parent, list, { settings, actor, relation: rel = null }) {
  const linked = [], requested = [], already = [];
  for (const s of list) {
    if (settings.link_by_key) {
      const r = await link(q, parent.id, s.id, { actor, source: "key", relation: rel });
      (r.linked ? linked : already).push(s.full_name);
    } else {
      const r = await openRequest(q, parent, s, { relation: rel });
      (r.already ? already : requested).push(s.full_name);
    }
  }
  return { linked, requested, already };
}
/** الإخوة المسجلون بنفس الجوال: فقط إن أثبت ولي الأمر أن الجوال جواله (معرّف ابن مسجّل بنفس الجوال) */
async function linkSiblings(q, parent, id, students, settings, actor) {
  if (!settings.auto_link_siblings || !settings.link_by_key || !students.some((s) => guardianOf(s, id))) return [];
  const out = [];
  for (const x of await q("SELECT id, full_name FROM students WHERE guardian_phone = $1 AND status = 'active' AND archived_at IS NULL", [id.phone])) {
    if ((await link(q, parent.id, x.id, { actor, source: "auto" })).linked) out.push(x.full_name);
  }
  return out;
}

/**
 * إنشاء ولي الأمر حسابه بنفسه (بلا تدخل الإدارة): الاسم + البريد أو الجوال + كلمة المرور + معرّفات أبنائه.
 *  - المعرّفات تُثبت أن هؤلاء أبناؤه؛ يلزم معرّف صحيح واحد على الأقل، وأي معرّف خاطئ يُرفض الطلب كله ليصححه.
 *  - البريد/الجوال فريد في المدرسة. حساب أنشأته الإدارة ولم يُستخدم بعد يُستلم بإثبات الملكية (معرّف ابن مرتبط به أو مسجّل بنفس الجوال).
 */
export async function register(q, b, { ip }) {
  const settings = await featureSettings(q, "parents");
  if (!settings.self_activation) throw forbidden("إنشاء الحسابات يتم من المدرسة. تواصل معها لاستلام بيانات الدخول.");
  const lock = await keyLock(q, ip);
  if (lock.locked) return LOCKED;
  const { found, invalid } = await studentsByKeys(q, b.keys);
  if (invalid.length || !found.length) {
    await keyFail(q, lock.subject, ip);
    return keysError(invalid.length ? invalid : [0]);
  }
  const id = b.identifier, actor = "تسجيل ذاتي";
  const existing = await findParent(q, id, "id, full_name, phone, email, last_login_at, must_change_password, source");
  let parent;
  if (existing) {
    // حساب من الإدارة لم يُفعَّل بعد: يستلمه صاحبه بإثبات أن أحد الأبناء ابنه
    const unused = existing.must_change_password && !existing.last_login_at;
    let owns = false;
    for (const s of found) if (guardianOf(s, id) || (await isLinked(q, existing.id, s.id))) owns = true;
    if (!unused || !owns) {
      return { error: `يوجد حساب بهذا ${id.email ? "البريد" : "الرقم"}. سجّل الدخول، أو استخدم «نسيت كلمة المرور».`, status: 409, exists: true };
    }
    await q(`UPDATE parents SET full_name = $2, password_hash = $3, must_change_password = false, initial_password_enc = NULL,
                    password_changed_at = now() WHERE id = $1`, [existing.id, b.name, await hashPassword(b.password)]);
    await q("DELETE FROM sessions WHERE parent_id = $1", [existing.id]);
    parent = { id: existing.id, full_name: b.name, phone: existing.phone, email: existing.email };
  } else {
    const [p] = await q(`INSERT INTO parents (tenant_id, full_name, phone, email, password_hash, must_change_password, password_changed_at, created_by, source)
                         VALUES (app_tenant(), $1, $2, $3, $4, false, now(), $5, 'self') RETURNING id, full_name, phone, email`,
    [b.name, id.phone || null, id.email || null, await hashPassword(b.password), actor]);
    parent = p;
  }
  const out = await attach(q, parent, found, { settings, actor, relation: b.relation || null });
  const siblings = id.phone ? await linkSiblings(q, parent, id, found, settings, actor) : [];
  await logEvent(q, { tenantId: await tenantOf(q), actor: b.name, action: existing ? "تفعيل حساب ولي أمر" : "إنشاء حساب ولي أمر" });
  return { parent_id: parent.id, ...out, siblings };
}

/**
 * استعادة كلمة المرور (أو التفعيل بالطريقة السابقة): البريد/الجوال + معرّف أحد الأبناء.
 *  - الحساب موجود: يلزم أن يكون الطالب مرتبطًا به (أو الجوال جوال ولي أمره المسجل لدى المدرسة).
 *  - لا حساب: يُنشأ فقط إن كان الجوال جوال ولي الأمر المسجل لدى المدرسة لهذا الطالب.
 * كلمة المرور الجديدة تُخرج كل الأجهزة السابقة.
 */
export async function activate(q, b, { ip }) {
  const settings = await featureSettings(q, "parents");
  if (!settings.self_activation) throw forbidden("استعادة الحساب تتم من المدرسة. تواصل معها.");
  const lock = await keyLock(q, ip);
  if (lock.locked) return LOCKED;
  const id = b.identifier;
  const [s] = await q("SELECT id, full_name, guardian_phone, guardian_name, status, archived_at FROM students WHERE access_key = $1", [b.key]);
  let p = await findParent(q, id);
  const ok = s && (guardianOf(s, id) || (p && (await isLinked(q, p.id, s.id))));
  if (!ok) {
    await keyFail(q, lock.subject, ip);
    return { error: "المعرّف لا يطابق بيانات هذا الحساب. تأكد من البريد أو الجوال ومن معرّف الابن." };
  }
  if (!isActive(s)) return { error: "الطالب غير مقيد حاليًا في المدرسة" };
  const hash = await hashPassword(b.password);
  if (p) {
    await q(`UPDATE parents SET password_hash = $2, must_change_password = false, initial_password_enc = NULL, password_changed_at = now(),
                    full_name = COALESCE(NULLIF($3, ''), full_name) WHERE id = $1`, [p.id, hash, b.name || ""]);
    await q("DELETE FROM sessions WHERE parent_id = $1", [p.id]);   // كلمة مرور جديدة: كل الأجهزة السابقة تخرج
  } else {
    [p] = await q(`INSERT INTO parents (tenant_id, full_name, phone, password_hash, must_change_password, password_changed_at, created_by, source)
                   VALUES (app_tenant(), $1, $2, $3, false, now(), 'تفعيل ذاتي', 'self') RETURNING id`,
    [b.name || s.guardian_name || "ولي الأمر", id.phone, hash]);
  }
  await link(q, p.id, s.id, { actor: "تفعيل ذاتي", source: "key", relation: b.relation || null });
  const siblings = id.phone ? (await linkSiblings(q, { id: p.id }, id, [s], settings, "تفعيل ذاتي")).length : 0;
  return { parent_id: p.id, siblings };
}

/** إضافة عدة أبناء دفعة واحدة من داخل الحساب (معرّفات أو روابط بطاقات) */
export async function addChildren(q, parent, b, { ip }) {
  const settings = await featureSettings(q, "parents");
  const lock = await keyLock(q, ip);
  if (lock.locked) return LOCKED;
  const { found, invalid } = await studentsByKeys(q, b.keys);
  if (invalid.length || !found.length) { await keyFail(q, lock.subject, ip); return keysError(invalid.length ? invalid : [0]); }
  return attach(q, parent, found, { settings, actor: parent.full_name, relation: b.relation || null });
}

/** إضافة ابن من داخل الحساب بمعرّفه: ربط مباشر إن سمحت المدرسة، وإلا طلب يُراجع */
export async function addChildByKey(q, parent, b) {
  const settings = await featureSettings(q, "parents");
  const [s] = await q("SELECT id, full_name, status, archived_at FROM students WHERE access_key = $1", [b.key]);
  if (!s || s.status !== "active" || s.archived_at) throw notFound("لا يوجد طالب مقيد بهذا المعرّف");
  if (settings.link_by_key) {
    const r = await link(q, parent.id, s.id, { actor: parent.full_name, source: "key", relation: b.relation || null });
    return { linked: true, already: !r.linked, student: r.student };
  }
  return openRequest(q, parent, s, b);
}
/** طلب ربط برقم الطالب واسمه (بلا معرّف): يصل للإدارة للموافقة دائمًا */
export async function requestChild(q, parent, b) {
  const settings = await featureSettings(q, "parents");
  if (!settings.allow_requests) throw forbidden("طلبات الربط غير متاحة. اطلب من المدرسة ربط ابنك بحسابك.");
  const [s] = await q("SELECT id, full_name FROM students WHERE student_no = $1 AND status = 'active' AND archived_at IS NULL", [b.student_no]);
  // لا نكشف وجود الطالب: الطلب يُسجَّل فقط إن تطابق الرقم والاسم، والرد واحد في الحالتين
  const first = (n) => String(n || "").trim().split(/\s+/)[0];
  if (s && first(s.full_name) === first(b.student_name)) await openRequest(q, parent, s, b);
  return { requested: true };
}
async function openRequest(q, parent, s, b) {
  const [linked] = await q("SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2 AND removed_at IS NULL", [parent.id, s.id]);
  if (linked) return { linked: true, already: true, student: { id: s.id, name: s.full_name } };
  const rows = await q(`INSERT INTO parent_link_requests (tenant_id, parent_id, student_id, relation, note)
                        VALUES (app_tenant(), $1, $2, COALESCE($3, 'guardian'), $4) ON CONFLICT DO NOTHING RETURNING id`,
  [parent.id, s.id, b.relation || null, b.note || null]);
  if (rows.length) {
    await notify(q, { event: "request", users: await adminUserIds(q), title: "طلب ربط ابن بحساب ولي أمر",
      body: `${parent.full_name} (${parent.phone || parent.email}) يطلب ربط ${s.full_name} بحسابه.`, link: "parents", dedupKey: `link:${rows[0].id}` });
  }
  return { linked: false, requested: true };
}

/* ======================= لوحة الأسرة ======================= */
/** الأبناء: النشطون أولًا، ثم السابقون (منقول، متخرج، مؤرشف) للاطلاع على السجل فقط */
export async function children(q, parentId) {
  const settings = await featureSettings(q, "parents");
  const rows = await q(
    `SELECT s.id, s.full_name AS name, s.status, s.archived_at IS NOT NULL AS archived, s.photo IS NOT NULL AS has_photo,
            c.name AS class_name, gr.name AS grade_name, ps.relation, ps.can_view_fees,
            a.status AS today_status, a.first_in_at, a.minutes_late, a.last_out_at,
            (SELECT json_build_object('title', n.title, 'at', n.created_at, 'kind', n.kind) FROM notifications n
              WHERE n.student_id = s.id AND n.archived_at IS NULL ORDER BY n.created_at DESC LIMIT 1) AS last_notification,
            (SELECT count(*)::int FROM notifications n WHERE n.student_id = s.id AND n.read_at IS NULL AND n.archived_at IS NULL) AS unread
       FROM parent_students ps JOIN students s ON s.id = ps.student_id
       LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN grades gr ON gr.id = c.grade_id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.day = (now() AT TIME ZONE COALESCE((SELECT timezone FROM school_notify), 'Asia/Aden'))::date
      WHERE ps.parent_id = $1 AND ps.removed_at IS NULL
      ORDER BY (s.status = 'active' AND s.archived_at IS NULL) DESC, s.full_name`, [parentId]);
  for (const r of rows) r.active = r.status === "active" && !r.archived;
  return settings.show_inactive ? rows : rows.filter((r) => r.active);
}
/** ملخص اليوم وآخر التنبيهات لكل الأبناء (اسم الطالب مع كل تنبيه، والإعلان العام مرة واحدة) */
export async function dashboard(q, parent) {
  const kids = await children(q, parent.id);
  const ids = kids.filter((k) => k.active).map((k) => k.id);
  const recent = ids.length ? await q(
    `SELECT DISTINCT ON (COALESCE(n.dedup_key, n.id::text)) n.id, n.student_id, n.kind, n.title, n.body, n.link, n.priority, n.category,
            n.created_at, n.read_at, s.full_name AS student_name
       FROM notifications n JOIN students s ON s.id = n.student_id
      WHERE n.student_id = ANY($1::bigint[]) AND n.archived_at IS NULL AND n.created_at > now() - interval '14 days'
      ORDER BY COALESCE(n.dedup_key, n.id::text), n.created_at DESC`, [ids]) : [];
  recent.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");
  const pending = await q(
    `SELECT r.id, s.full_name AS name, r.created_at FROM parent_link_requests r JOIN students s ON s.id = r.student_id
      WHERE r.parent_id = $1 AND r.status = 'pending' ORDER BY r.id DESC`, [parent.id]);
  const settings = await featureSettings(q, "parents");
  return { parent: { id: parent.id, name: parent.full_name, phone: parent.phone, email: parent.email, must_change_password: parent.must_change_password },
    school: school?.name || "", children: kids, notifications: recent.slice(0, 30), pending_requests: pending,
    can: { link_by_key: settings.link_by_key, requests: settings.allow_requests },
    push_key: (await activeModules(q)).notifications ? pushPublicKey() : null };
}

export async function changePassword(q, parent, b) {
  if (canonPassword(b.next) === canonPassword(b.current)) throw badRequest("اختر كلمة مرور مختلفة عن الحالية");
  const [p] = await q("SELECT password_hash, must_change_password FROM parents WHERE id = $1", [parent.id]);
  if (!(await verifyPassword(b.current, p.password_hash, { temporary: p.must_change_password }))) throw unauthorized("كلمة المرور الحالية غير صحيحة");
  await q(`UPDATE parents SET password_hash = $2, must_change_password = false, initial_password_enc = NULL, password_changed_at = now()
            WHERE id = $1`, [parent.id, await hashPassword(b.next)]);
  return { ok: true };
}

/* ======================= الإدارة ======================= */
export async function listParents(q, { search = "" } = {}) {
  const rows = await q(
    `SELECT p.id, p.full_name AS name, p.phone, p.email, p.source, p.status, p.must_change_password, p.last_login_at, p.created_at,
            p.password_hash IS NOT NULL AS has_password,
            COALESCE(json_agg(json_build_object('id', s.id, 'name', s.full_name, 'class_name', c.name, 'relation', ps.relation,
              'active', s.status = 'active' AND s.archived_at IS NULL) ORDER BY s.full_name) FILTER (WHERE s.id IS NOT NULL), '[]') AS children
       FROM parents p
       LEFT JOIN parent_students ps ON ps.parent_id = p.id AND ps.removed_at IS NULL
       LEFT JOIN students s ON s.id = ps.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE ($1 = '' OR p.full_name ILIKE '%' || $1 || '%' OR p.phone LIKE '%' || $1 || '%' OR p.email ILIKE '%' || $1 || '%'
             OR EXISTS (SELECT 1 FROM parent_students x JOIN students y ON y.id = x.student_id
                         WHERE x.parent_id = p.id AND x.removed_at IS NULL AND y.full_name ILIKE '%' || $1 || '%'))
      GROUP BY p.id ORDER BY p.full_name LIMIT 500`, [search]);
  return rows;
}
async function issueTemp(q, parentId) {
  const temp = newTempPassword();
  await q(`UPDATE parents SET password_hash = $2, must_change_password = true, initial_password_enc = $3 WHERE id = $1`,
    [parentId, await hashPassword(temp), sealCredential(temp, await tenantOf(q))]);
  await q("DELETE FROM sessions WHERE parent_id = $1", [parentId]);
  return temp;
}
export async function createParent(q, b, { actor }) {
  await assertUnique(q, b, 0);
  const [p] = await q(`INSERT INTO parents (tenant_id, full_name, phone, email, created_by) VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id`,
    [b.name, b.phone, b.email || null, actor]);
  for (const sid of b.student_ids || []) await link(q, p.id, sid, { actor, relation: b.relation || null });
  const password = await issueTemp(q, p.id);
  return { id: p.id, credentials: { phone: b.phone || b.email, password } };
}
/** الجوال والبريد كلاهما فريد في المدرسة (لا حسابات مكررة) */
async function assertUnique(q, b, id) {
  if (b.phone && (await q("SELECT 1 FROM parents WHERE phone = $1 AND id <> $2", [b.phone, id])).length) {
    throw conflict("يوجد حساب ولي أمر بهذا الجوال. افتحه وأضف له الأبناء بدل إنشاء حساب مكرر.");
  }
  if (b.email && (await q("SELECT 1 FROM parents WHERE lower(email) = $1 AND id <> $2", [b.email, id])).length) {
    throw conflict("يوجد حساب ولي أمر بهذا البريد الإلكتروني.");
  }
}
export async function updateParent(q, id, b) {
  await assertUnique(q, b, id);
  const rows = await q("UPDATE parents SET full_name = $2, phone = $3, email = $4 WHERE id = $1 RETURNING id", [id, b.name, b.phone || null, b.email || null]);
  if (!rows.length) throw notFound("الحساب غير موجود");
  return { ok: true };
}
export async function getParent(q, id) {
  const [p] = await q(`SELECT id, full_name AS name, phone, email, status, must_change_password, initial_password_enc, last_login_at, created_at, created_by, source
                         FROM parents WHERE id = $1`, [id]);
  if (!p) throw notFound("الحساب غير موجود");
  p.initial_password = p.must_change_password && p.initial_password_enc ? openCredential(p.initial_password_enc, await tenantOf(q)) : null;
  delete p.initial_password_enc;
  p.children = await q(
    `SELECT s.id, s.full_name AS name, c.name AS class_name, ps.relation, ps.can_view_fees, ps.source, ps.created_at,
            s.status = 'active' AND s.archived_at IS NULL AS active
       FROM parent_students ps JOIN students s ON s.id = ps.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE ps.parent_id = $1 AND ps.removed_at IS NULL ORDER BY s.full_name`, [id]);
  p.history = await q(
    `SELECT s.full_name AS name, ps.created_at, ps.removed_at, ps.removed_by FROM parent_students ps JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id = $1 AND ps.removed_at IS NOT NULL ORDER BY ps.removed_at DESC LIMIT 50`, [id]);
  return p;
}
export async function setStatus(q, id, status) {
  const rows = await q("UPDATE parents SET status = $2 WHERE id = $1 RETURNING id", [id, status]);
  if (!rows.length) throw notFound("الحساب غير موجود");
  if (status === "disabled") await q("DELETE FROM sessions WHERE parent_id = $1", [id]);
  return { ok: true };
}
export async function resetPassword(q, id) {
  const [p] = await q("SELECT phone, email FROM parents WHERE id = $1", [id]);
  if (!p) throw notFound("الحساب غير موجود");
  return { phone: p.phone || p.email, password: await issueTemp(q, id) };
}
export async function parentsOfStudent(q, studentId) {
  return q(`SELECT p.id, p.full_name AS name, p.phone, p.email, p.status, ps.relation, ps.can_view_fees, p.last_login_at
              FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
             WHERE ps.student_id = $1 AND ps.removed_at IS NULL ORDER BY p.full_name`, [studentId]);
}

/**
 * إنشاء حسابات أولياء الأمور تلقائيًا من أرقام الجوال المسجلة: حساب واحد لكل رقم، مرتبط بكل الطلاب المسجلين به.
 * لا يكرر حسابًا موجودًا (يضيف له الأبناء الناقصين فقط). كلمات المرور المؤقتة تُعاد مرة واحدة للطباعة أو الإرسال.
 */
export async function autoCreate(q, { actor }) {
  const groups = await q(
    `SELECT guardian_phone AS phone, (array_agg(guardian_name ORDER BY id DESC) FILTER (WHERE guardian_name IS NOT NULL))[1] AS name,
            array_agg(id ORDER BY id) AS ids
       FROM students WHERE status = 'active' AND archived_at IS NULL AND guardian_phone IS NOT NULL AND guardian_phone <> ''
      GROUP BY guardian_phone`);
  let created = 0, linked = 0;
  const credentials = [];
  for (const g of groups) {
    const p = normalizePhone(g.phone);
    if (!p || !/^\+?[0-9]{6,20}$/.test(p)) continue;
    let [parent] = await q("SELECT id, full_name, password_hash FROM parents WHERE phone = $1", [p]);
    if (!parent) {
      [parent] = await q(`INSERT INTO parents (tenant_id, full_name, phone, created_by) VALUES (app_tenant(), $1, $2, $3) RETURNING id, full_name`,
        [g.name || "ولي الأمر", p, actor]);
      created++;
      credentials.push({ name: parent.full_name, phone: p, password: await issueTemp(q, parent.id), children: g.ids.length });
    }
    for (const sid of g.ids) if ((await link(q, parent.id, Number(sid), { actor, source: "auto" })).linked) linked++;
  }
  return { created, linked, credentials };
}

export async function listRequests(q) {
  return q(`SELECT r.id, r.relation, r.note, r.status, r.created_at, p.id AS parent_id, p.full_name AS parent_name, p.phone, p.email,
                   s.id AS student_id, s.full_name AS student_name, c.name AS class_name, s.guardian_phone
              FROM parent_link_requests r JOIN parents p ON p.id = r.parent_id JOIN students s ON s.id = r.student_id
              LEFT JOIN classes c ON c.id = s.class_id
             WHERE r.status = 'pending' ORDER BY r.id`);
}
export async function decideRequest(q, id, approve, { actor }) {
  const [r] = await q("SELECT parent_id, student_id, relation FROM parent_link_requests WHERE id = $1 AND status = 'pending'", [id]);
  if (!r) throw notFound("الطلب غير موجود أو تمت مراجعته");
  if (approve) await link(q, r.parent_id, r.student_id, { actor, source: "request", relation: r.relation });
  else await q("UPDATE parent_link_requests SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1", [id, actor]);
  return { ok: true };
}
