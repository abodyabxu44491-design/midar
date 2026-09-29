// منطق الطلاب
import { z, t } from "../../core/http/validate.js";
import { badRequest, conflict, notFound } from "../../core/http/errors.js";
import { newStudentKey } from "../../core/auth/codes.js";
import { resolveClassForGrade } from "./structure.service.js";

// حقول الطالب الأساسية الجديدة (كلها اختيارية). "" أو null تعني المسح عند التعديل.
const blankToNull = (v) => (v === undefined ? undefined : v || null);
export const profileFields = {
  student_no: z.string().trim().max(30).optional().nullable().transform(blankToNull),
  birth_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ الميلاد غير صحيح"), z.literal(""), z.null()]).optional().transform(blankToNull),
  gender: z.union([z.enum(["male", "female"]), z.literal(""), z.null()]).optional().transform(blankToNull),
  student_phone: t.phone,
};
export const studentSchema = z.object({
  ...profileFields,
  name: t.name("اسم الطالب"),
  class_id: t.optId,
  grade_id: t.optId,   // بديل عن class_id في وضع "بدون شعب": يُحل تلقائيًا لشعبة الصف الافتراضية
  guardian_name: t.optText(120),
  guardian_phone: t.phone,
  fees_enabled: z.boolean().optional().default(false),
});
export const importSchema = z.object({ students: z.array(studentSchema).min(1, "لا يوجد طلاب").max(1000, "الحد 1000 طالب في المرة") });
export const updateSchema = z.object({
  ...profileFields,
  version: z.coerce.number().int().positive("رقم النسخة مطلوب"),
  name: t.name("اسم الطالب").optional(),
  class_id: t.optId,
  grade_id: t.optId,
  guardian_name: t.optText(120),
  guardian_phone: t.phone,
  fees_enabled: z.boolean().optional(),
});

/* ---------- تسهيلات الإدخال ---------- */
// تنظيف الاسم: مسافات زائدة وتطويل وحروف غير عربية/لاتينية
export const cleanName = (v) => String(v || "").replace(/\u0640/g, "").replace(/\s+/g, " ").trim();

// اسم ولي الأمر من اسم الطالب: يوسف محمد علي ← محمد علي
export function guardianFromStudent(fullName) {
  const parts = cleanName(fullName).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const rest = parts.slice(1).filter((w) => !["بن", "بنت", "ابن", "ال"].includes(w));
  return rest.length >= 2 ? rest.join(" ") : null;
}

/**
 * توحيد صيغة الجوال لأي دولة:
 *   +967 77 123 4567 / 00967771234567 → +967771234567
 *   0501234567 (محلي) → يبقى كما هو، ويُكمَّل برمز الدولة عند إرسال واتساب
 * تُحذف المسافات والرموز فقط، ولا يُفرض رمز دولة معيّن.
 */
export function normalizePhone(v) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits.replace(/\+/g, "")) return null;
  if (digits.startsWith("00")) return "+" + digits.slice(2).replace(/\+/g, "");
  if (digits.startsWith("+")) return "+" + digits.slice(1).replace(/\+/g, "");
  return digits.slice(0, 20);
}

export async function get(q, id, { includeArchived = false } = {}) {
  const [s] = await q(`SELECT * FROM students WHERE id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"}`, [id]);
  if (!s) throw notFound("الطالب غير موجود");
  return s;
}

async function ensureCapacity(q, tenant, adding) {
  const [r] = await q("SELECT count(*)::int AS n FROM students WHERE archived_at IS NULL");
  if (r.n + adding > tenant.max_students) throw badRequest(`تجاوزت حد الباقة (${tenant.max_students} طالب). تواصل مع إدارة المنصة للترقية.`);
}

// إنشاء طالب مع معرّف فريد (يُعاد التوليد تلقائيًا في حالة التصادم النادر)
async function insertOne(q, s) {
  const classId = s.class_id ?? (s.grade_id ? await resolveClassForGrade(q, s.grade_id) : null);
  const name = cleanName(s.name);
  const phone = normalizePhone(s.guardian_phone);
  // اسم ولي الأمر: المكتوب، أو من سجل أخ له بنفس الجوال، أو من اسم الطالب
  let guardian = cleanName(s.guardian_name) || null;
  if (!guardian && phone) {
    const [sibling] = await q(
      "SELECT guardian_name FROM students WHERE guardian_phone = $1 AND guardian_name IS NOT NULL ORDER BY id DESC LIMIT 1", [phone]);
    guardian = sibling?.guardian_name || null;
  }
  if (!guardian) guardian = guardianFromStudent(name);

  for (let attempt = 0; attempt < 5; attempt++) {
    const key = newStudentKey();
    const rows = await q(
      `INSERT INTO students (tenant_id, class_id, full_name, guardian_name, guardian_phone, access_key, fees_enabled,
                             student_no, birth_date, gender, student_phone)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, access_key) DO NOTHING
       RETURNING id, full_name AS name, guardian_name, guardian_phone, access_key, student_no`,
      [classId, name, guardian, phone, key, s.fees_enabled ?? false, s.student_no ?? null, s.birth_date ?? null,
       s.gender ?? null, normalizePhone(s.student_phone)]);
    if (rows.length) return rows[0];
  }
  throw conflict("تعذر إنشاء معرّف فريد، أعد المحاولة");
}

// بيانات ولي أمر مسجّل مسبقًا بنفس الجوال (لربط الإخوة)
export async function guardianByPhone(q, phone) {
  const p = normalizePhone(phone);
  if (!p) return { phone: null, guardian_name: null, siblings: [] };
  const rows = await q(
    `SELECT s.id, s.full_name AS name, s.guardian_name, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.guardian_phone = $1 AND s.status = 'active' ORDER BY s.full_name LIMIT 10`, [p]);
  return { phone: p, guardian_name: rows[0]?.guardian_name || null, siblings: rows.map(({ id, name, class_name }) => ({ id, name, class_name })) };
}

export async function create(q, tenant, list) {
  // قفل صف المدرسة حتى لا تتجاوز عمليتان متزامنتان حد الباقة
  await q("SELECT id FROM tenants WHERE id = app_tenant() FOR UPDATE");
  await ensureCapacity(q, tenant, list.length);
  await ensureStudentNos(q, list.map((x) => x.student_no));
  const out = [];
  for (const s of list) out.push(await insertOne(q, s));
  return out;
}

/** رقم الطالب لا يتكرر داخل المدرسة (وداخل الدفعة نفسها) */
export async function ensureStudentNos(q, numbers, exceptId = null) {
  const list = numbers.filter(Boolean);
  if (new Set(list).size !== list.length) throw badRequest("رقم الطالب مكرر داخل البيانات المرسلة");
  if (!list.length) return;
  const [dup] = await q("SELECT student_no FROM students WHERE student_no = ANY($1::text[]) AND ($2::bigint IS NULL OR id <> $2) LIMIT 1", [list, exceptId]);
  if (dup) throw conflict(`رقم الطالب «${dup.student_no}» مستخدم لطالب آخر`);
}

export async function update(q, id, b) {
  const s = await get(q, id);
  if (b.student_no !== undefined && b.student_no !== s.student_no) await ensureStudentNos(q, [b.student_no], id);
  if (s.version !== b.version) throw conflict("تم تعديل بيانات هذا الطالب من شخص آخر. حدّث الصفحة ثم أعد المحاولة.");
  const resolvedClassId = b.class_id !== undefined ? b.class_id
    : b.grade_id !== undefined ? await resolveClassForGrade(q, b.grade_id) : s.class_id;
  const next = {
    full_name: b.name ? cleanName(b.name) : s.full_name,
    class_id: resolvedClassId,
    guardian_name: b.guardian_name !== undefined ? b.guardian_name : s.guardian_name,
    guardian_phone: b.guardian_phone !== undefined ? normalizePhone(b.guardian_phone) : s.guardian_phone,
    fees_enabled: b.fees_enabled ?? s.fees_enabled,
    student_no: b.student_no !== undefined ? b.student_no : s.student_no,
    birth_date: b.birth_date !== undefined ? b.birth_date : s.birth_date,
    gender: b.gender !== undefined ? b.gender : s.gender,
    student_phone: b.student_phone !== undefined ? normalizePhone(b.student_phone) : s.student_phone,
  };
  const [row] = await q(
    `UPDATE students SET full_name = $2, class_id = $3, guardian_name = $4, guardian_phone = $5, fees_enabled = $6,
            student_no = $8, birth_date = $9, gender = $10, student_phone = $11
      WHERE id = $1 AND version = $7 RETURNING version`,
    [id, next.full_name, next.class_id, next.guardian_name, next.guardian_phone, next.fees_enabled, b.version,
     next.student_no, next.birth_date, next.gender, next.student_phone]);
  if (!row) throw conflict("تم تعديل بيانات هذا الطالب من شخص آخر. حدّث الصفحة ثم أعد المحاولة.");
  return row;
}

export async function regenerateKey(q, id) {
  await get(q, id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = newStudentKey();
    const rows = await q(
      `UPDATE students SET access_key = $2 WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM students WHERE access_key = $2) RETURNING access_key`, [id, key]);
    if (rows.length) return rows[0].access_key;
  }
  throw conflict("تعذر إنشاء معرّف جديد، أعد المحاولة");
}

export const STATUSES = ["active", "graduated", "transferred", "withdrawn"];
export const STATUS_LABEL = {
  active: "على رأس القيد", graduated: "متخرج", transferred: "منقول لمدرسة أخرى", withdrawn: "منسحب",
};
export const statusSchema = z.object({
  status: z.enum(STATUSES),
  note: t.optText(300),
});

// تغيير حالة الطالب: الأرشفة تتبع الحالة تلقائيًا في قاعدة البيانات
export async function setStatus(q, tenant, id, { status, note }) {
  const s = await get(q, id, { includeArchived: true });
  if (status === "active" && s.status !== "active") {
    await q("SELECT id FROM tenants WHERE id = app_tenant() FOR UPDATE");
    await ensureCapacity(q, tenant, 1);
  }
  await q("UPDATE students SET status = $2, status_note = $3 WHERE id = $1", [id, status, note ?? null]);
  return { status };
}


/* ---------- الصورة ---------- */
const MAGIC = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];
export const photoSchema = z.object({ data_url: z.string().max(220_000, "الصورة كبيرة").regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "صيغة الصورة غير مدعومة") });

/** تُحفظ الصورة المصغّرة فقط (تُصغَّر في المتصفح إلى ≈ 320px). التحقق من نوعها الحقيقي من محتواها لا من اسمها. */
export async function setPhoto(q, id, dataUrl) {
  await get(q, id);
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (buf.length > 150_000) throw badRequest("الصورة كبيرة (الحد 150 كيلوبايت بعد التصغير)");
  const type = MAGIC.find(([, ok]) => buf.length > 12 && ok(buf))?.[0];
  if (!type) throw badRequest("الملف ليس صورة صالحة");
  await q("UPDATE students SET photo = $2, photo_type = $3 WHERE id = $1", [id, buf, type]);
}
export async function removePhoto(q, id) {
  await get(q, id);
  await q("UPDATE students SET photo = NULL, photo_type = NULL WHERE id = $1", [id]);
}
export async function getPhoto(q, id) {
  const [r] = await q("SELECT photo, photo_type FROM students WHERE id = $1", [id]);
  if (!r?.photo) throw notFound("لا توجد صورة");
  return r;
}

/* ---------- إحصائيات الصفحة الرئيسية ---------- */
export async function stats(q) {
  const [r] = await q(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE status = 'active' AND created_at >= now() - interval '30 days')::int AS new_30d
       FROM students`);
  return r;
}
