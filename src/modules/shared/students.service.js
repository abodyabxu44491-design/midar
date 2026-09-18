// منطق الطلاب
import { z, t } from "../../core/http/validate.js";
import { badRequest, conflict, notFound } from "../../core/http/errors.js";
import { newStudentKey } from "../../core/auth/codes.js";

export const studentSchema = z.object({
  name: t.name("اسم الطالب"),
  class_id: t.optId,
  guardian_name: t.optText(120),
  guardian_phone: t.phone,
  fees_enabled: z.boolean().optional().default(false),
});
export const importSchema = z.object({ students: z.array(studentSchema).min(1, "لا يوجد طلاب").max(1000, "الحد 1000 طالب في المرة") });
export const updateSchema = z.object({
  version: z.coerce.number().int().positive("رقم النسخة مطلوب"),
  name: t.name("اسم الطالب").optional(),
  class_id: t.optId,
  guardian_name: t.optText(120),
  guardian_phone: t.phone,
  fees_enabled: z.boolean().optional(),
});

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
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = newStudentKey();
    const rows = await q(
      `INSERT INTO students (tenant_id, class_id, full_name, guardian_name, guardian_phone, access_key, fees_enabled)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, access_key) DO NOTHING
       RETURNING id, full_name AS name, access_key`,
      [s.class_id, s.name, s.guardian_name, s.guardian_phone, key, s.fees_enabled]);
    if (rows.length) return rows[0];
  }
  throw conflict("تعذر إنشاء معرّف فريد، أعد المحاولة");
}

export async function create(q, tenant, list) {
  // قفل صف المدرسة حتى لا تتجاوز عمليتان متزامنتان حد الباقة
  await q("SELECT id FROM tenants WHERE id = app_tenant() FOR UPDATE");
  await ensureCapacity(q, tenant, list.length);
  const out = [];
  for (const s of list) out.push(await insertOne(q, s));
  return out;
}

export async function update(q, id, b) {
  const s = await get(q, id);
  if (s.version !== b.version) throw conflict("تم تعديل بيانات هذا الطالب من شخص آخر. حدّث الصفحة ثم أعد المحاولة.");
  const next = {
    full_name: b.name ?? s.full_name,
    class_id: b.class_id !== undefined ? b.class_id : s.class_id,
    guardian_name: b.guardian_name !== undefined ? b.guardian_name : s.guardian_name,
    guardian_phone: b.guardian_phone !== undefined ? b.guardian_phone : s.guardian_phone,
    fees_enabled: b.fees_enabled ?? s.fees_enabled,
  };
  const [row] = await q(
    `UPDATE students SET full_name = $2, class_id = $3, guardian_name = $4, guardian_phone = $5, fees_enabled = $6
      WHERE id = $1 AND version = $7 RETURNING version`,
    [id, next.full_name, next.class_id, next.guardian_name, next.guardian_phone, next.fees_enabled, b.version]);
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
