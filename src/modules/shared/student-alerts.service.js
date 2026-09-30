// تنبيهات الطالب: ملاحظات من الإدارة أو معلميه (سلوك، حضور، مستوى دراسي، صحة، ثناء).
// ما حُدد لولي الأمر يظهر في ملف الطالب، ويستطيع ولي الأمر تأكيد الاطلاع عليه.
import { z, t } from "../../core/http/validate.js";
import { notFound, forbidden } from "../../core/http/errors.js";

export const KINDS = ["note", "attendance", "behavior", "academic", "health", "praise"];
export const LEVELS = ["info", "warning", "urgent", "positive"];

export const alertSchema = z.object({
  kind: z.enum(KINDS).default("note"),
  level: z.enum(LEVELS).default("info"),
  title: z.string().trim().min(2, "اكتب عنوان التنبيه").max(120),
  body: t.optText(1000),
  for_parent: z.boolean().default(true),
});

const COLS = `a.id, a.kind, a.level, a.title, a.body, a.for_parent, a.created_by, a.acknowledged_at, a.created_at, a.teacher_id`;

export function list(q, studentId, { parentOnly = false, limit = 50 } = {}) {
  return q(
    `SELECT ${COLS} FROM student_alerts a WHERE a.student_id = $1 ${parentOnly ? "AND a.for_parent" : ""}
      ORDER BY a.created_at DESC LIMIT $2`, [studentId, limit]);
}

/** أحدث التنبيهات في المدرسة (لمتابعة الإدارة) */
export function recent(q, limit = 30) {
  return q(
    `SELECT ${COLS}, s.full_name AS student_name, c.name AS class_name
       FROM student_alerts a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
      ORDER BY a.created_at DESC LIMIT $1`, [limit]);
}

export async function create(q, studentId, b, { actor, teacherId = null }) {
  const [s] = await q("SELECT id FROM students WHERE id = $1 AND archived_at IS NULL", [studentId]);
  if (!s) throw notFound("الطالب غير موجود");
  const [row] = await q(
    `INSERT INTO student_alerts (tenant_id, student_id, kind, level, title, body, for_parent, created_by, teacher_id)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [studentId, b.kind, b.level, b.title, b.body ?? null, b.for_parent, actor, teacherId]);
  return row;
}

/** الحذف: الإدارة أي تنبيه، والمعلم ما كتبه هو فقط */
export async function remove(q, id, { teacherId = null } = {}) {
  const [a] = await q("SELECT teacher_id FROM student_alerts WHERE id = $1", [id]);
  if (!a) throw notFound("التنبيه غير موجود");
  if (teacherId && Number(a.teacher_id) !== Number(teacherId)) throw forbidden("تستطيع حذف تنبيهاتك فقط");
  await q("DELETE FROM student_alerts WHERE id = $1", [id]);
  return { ok: true };
}

export async function acknowledge(q, studentId, id) {
  const [row] = await q(
    `UPDATE student_alerts SET acknowledged_at = COALESCE(acknowledged_at, now())
      WHERE id = $1 AND student_id = $2 AND for_parent RETURNING acknowledged_at`, [id, studentId]);
  if (!row) throw notFound("التنبيه غير موجود");
  return row;
}
