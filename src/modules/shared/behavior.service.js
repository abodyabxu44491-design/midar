// السلوك والانضباط: بنود بنقاط، وتسجيل لطالب أو لمجموعة طلاب، ودرجة سلوك لكل طالب في الفصل الحالي
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict, forbidden } from "../../core/http/errors.js";
import { notify } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";

// بنود افتتاحية لكل مدرسة (تُعدَّل وتُضاف من الإعدادات)
const STARTER = [
  ["مشاركة متميزة", "positive", 5], ["إنجاز أو تفوق", "positive", 10], ["تعاون مع الزملاء", "positive", 3],
  ["الالتزام بالواجبات", "positive", 3], ["النظافة والترتيب", "positive", 2], ["مساعدة المعلم", "positive", 2],
  ["تأخر صباحي", "negative", 2], ["عدم إحضار الأدوات", "negative", 2], ["عدم أداء الواجب", "negative", 2],
  ["إزعاج داخل الفصل", "negative", 3], ["مخالفة الزي المدرسي", "negative", 2], ["استخدام الجوال", "negative", 5],
  ["عدم احترام الآخرين", "negative", 8], ["سلوك عدواني", "negative", 10],
];

export const categorySchema = z.object({
  name: t.shortText("اسم البند", 60),
  kind: z.enum(["positive", "negative"]),
  points: z.coerce.number().int().min(1, "النقاط من 1 إلى 100").max(100, "النقاط من 1 إلى 100"),
  is_active: z.boolean().optional(),
  sort: z.coerce.number().int().min(0).max(999).optional(),
});

export const recordSchema = z.object({
  student_ids: z.array(t.id).min(1, "اختر طالبًا على الأقل").max(200),
  category_id: t.optId,
  // بند غير مسجل: نوع ونقاط وعنوان يدوي
  kind: z.enum(["positive", "negative"]).optional(),
  points: z.coerce.number().int().min(1).max(100).optional(),
  title: z.string().trim().min(2).max(80).optional(),
  note: t.optText(500),
  day: t.optDate,
  notify_parent: z.boolean().default(true),
});

export const listQuery = z.object({
  class_id: t.optId, student_id: t.optId, kind: z.enum(["positive", "negative"]).optional(),
  from: t.optDate, to: t.optDate,
});

export async function categories(q, { activeOnly = false } = {}) {
  let rows = await q("SELECT id, name, kind, points, is_active, sort FROM behavior_categories ORDER BY kind DESC, sort, name");
  if (!rows.length) {
    for (const [i, [name, kind, points]] of STARTER.entries()) {
      await q("INSERT INTO behavior_categories (tenant_id, name, kind, points, sort) VALUES (app_tenant(), $1, $2, $3, $4) ON CONFLICT DO NOTHING", [name, kind, points, i]);
    }
    rows = await q("SELECT id, name, kind, points, is_active, sort FROM behavior_categories ORDER BY kind DESC, sort, name");
  }
  return activeOnly ? rows.filter((r) => r.is_active) : rows;
}

export async function addCategory(q, b) {
  const [dup] = await q("SELECT 1 FROM behavior_categories WHERE name = $1", [b.name]);
  if (dup) throw conflict("يوجد بند بنفس الاسم");
  const [row] = await q("INSERT INTO behavior_categories (tenant_id, name, kind, points, sort) VALUES (app_tenant(), $1, $2, $3, COALESCE($4, 100)) RETURNING id",
    [b.name, b.kind, b.points, b.sort ?? null]);
  return row;
}

export async function updateCategory(q, id, b) {
  const rows = await q(
    `UPDATE behavior_categories SET name = COALESCE($2, name), kind = COALESCE($3, kind), points = COALESCE($4, points),
            is_active = COALESCE($5, is_active), sort = COALESCE($6, sort) WHERE id = $1 RETURNING id`,
    [id, b.name ?? null, b.kind ?? null, b.points ?? null, b.is_active ?? null, b.sort ?? null]);
  if (!rows.length) throw notFound("البند غير موجود");
}

// بند مستخدم في سجلات لا يُحذف (يوقف فقط) حتى يبقى تاريخ الطلاب واضحًا
export async function removeCategory(q, id) {
  const [used] = await q("SELECT 1 FROM behavior_records WHERE category_id = $1 LIMIT 1", [id]);
  if (used) { await q("UPDATE behavior_categories SET is_active = false WHERE id = $1", [id]); return { deactivated: true }; }
  const rows = await q("DELETE FROM behavior_categories WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("البند غير موجود");
  return { deleted: true };
}

/**
 * تسجيل سلوك لطالب أو أكثر.
 * @param {{teacherId?: number|null, actor: string, allowedClass?: (classId:number)=>Promise<boolean>}} ctx
 */
export async function record(q, b, ctx) {
  let kind, points, title;
  if (b.category_id) {
    const [c] = await q("SELECT name, kind, points FROM behavior_categories WHERE id = $1 AND is_active", [b.category_id]);
    if (!c) throw notFound("البند غير موجود");
    ({ kind } = c); title = c.name; points = kind === "positive" ? c.points : -c.points;
  } else {
    if (!b.kind || !b.points || !b.title) throw badRequest("اختر بندًا، أو اكتب العنوان والنوع والنقاط");
    kind = b.kind; title = b.title; points = kind === "positive" ? b.points : -b.points;
  }
  const day = b.day || new Date().toISOString().slice(0, 10);
  if (day > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw badRequest("لا يمكن التسجيل بتاريخ مستقبلي");
  const students = await q("SELECT id, full_name, class_id FROM students WHERE id = ANY($1) AND archived_at IS NULL", [b.student_ids]);
  if (students.length !== new Set(b.student_ids).size) throw notFound("أحد الطلاب غير موجود");
  if (ctx.allowedClass) for (const s of students) if (!(await ctx.allowedClass(s.class_id))) throw forbidden(`الطالب ${s.full_name} ليس ضمن فصولك`);
  const ids = [];
  for (const s of students) {
    const [r] = await q(
      `INSERT INTO behavior_records (tenant_id, student_id, category_id, kind, points, title, note, day, teacher_id, recorded_by)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [s.id, b.category_id ?? null, kind, points, title, b.note ?? null, day, ctx.teacherId ?? null, ctx.actor]);
    ids.push(r.id);
  }
  const settings = await featureSettings(q, "behavior");
  if (b.notify_parent && settings.show_parent) {
    for (const s of students) {
      await notify(q, { event: "behavior", students: [s.id],
        title: kind === "positive" ? `إنجاز: ${title}` : `ملاحظة سلوك: ${title}`,
        body: `${s.full_name}: ${points > 0 ? "+" : ""}${points} نقطة${b.note ? ` — ${b.note}` : ""}`, link: "behavior" });
    }
  }
  return { created: ids.length, ids };
}

export async function remove(q, id, { teacherId = null } = {}) {
  const [r] = await q("SELECT teacher_id FROM behavior_records WHERE id = $1", [id]);
  if (!r) throw notFound("السجل غير موجود");
  if (teacherId && Number(r.teacher_id) !== Number(teacherId)) throw forbidden("تستطيع حذف ما سجلته أنت فقط");
  await q("DELETE FROM behavior_records WHERE id = $1", [id]);
}

export const list = (q, f, { teacherId = null } = {}) => q(
  `SELECT r.id, r.student_id, s.full_name AS student, c.name AS class_name, r.kind, r.points, r.title, r.note, r.day,
          r.recorded_by, r.teacher_id, r.created_at
     FROM behavior_records r JOIN students s ON s.id = r.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE ($1::bigint IS NULL OR s.class_id = $1) AND ($2::bigint IS NULL OR r.student_id = $2)
      AND ($3::text IS NULL OR r.kind = $3) AND ($4::date IS NULL OR r.day >= $4) AND ($5::date IS NULL OR r.day <= $5)
      AND ($6::bigint IS NULL OR s.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = $6))
    ORDER BY r.day DESC, r.id DESC LIMIT 500`,
  [f.class_id ?? null, f.student_id ?? null, f.kind ?? null, f.from ?? null, f.to ?? null, teacherId]);

/** ملخص الفصل الحالي لكل طالب: الإيجابي والسلبي والدرجة */
export async function summary(q, { class_id = null, teacherId = null } = {}) {
  const { base_score, warn_below } = await featureSettings(q, "behavior");
  const rows = await q(
    `SELECT s.id, s.full_name AS name, c.name AS class_name,
            COALESCE(sum(r.points) FILTER (WHERE r.points > 0), 0)::int AS positive,
            COALESCE(-sum(r.points) FILTER (WHERE r.points < 0), 0)::int AS negative,
            count(r.id)::int AS records
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN behavior_records r ON r.student_id = s.id AND (r.term_id IS NOT DISTINCT FROM current_term() OR current_term() IS NULL)
      WHERE s.archived_at IS NULL AND ($1::bigint IS NULL OR s.class_id = $1)
        AND ($2::bigint IS NULL OR s.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = $2))
      GROUP BY s.id, c.name, c.id ORDER BY c.id, s.full_name`, [class_id, teacherId]);
  return { base_score, warn_below, students: rows.map((r) => ({ ...r, score: base_score + r.positive - r.negative })) };
}

/** ملف سلوك طالب (لولي الأمر والإدارة) */
export async function forStudent(q, studentId) {
  const { base_score, warn_below } = await featureSettings(q, "behavior");
  const records = await q(
    `SELECT id, kind, points, title, note, day, recorded_by, (term_id IS NOT DISTINCT FROM current_term() OR current_term() IS NULL) AS current
       FROM behavior_records WHERE student_id = $1 ORDER BY day DESC, id DESC LIMIT 100`, [studentId]);
  const cur = records.filter((r) => r.current);
  const positive = cur.filter((r) => r.points > 0).reduce((a, r) => a + r.points, 0);
  const negative = cur.filter((r) => r.points < 0).reduce((a, r) => a - r.points, 0);
  return { base_score, warn_below, positive, negative, score: base_score + positive - negative,
    records: records.map(({ current, ...r }) => r) };
}
