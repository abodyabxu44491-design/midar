// منطق الحضور (مشترك بين الإدارة والمعلم)
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";

export const STATUSES = ["present", "absent", "late", "excused"];
const LABEL = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "غياب بعذر" };

export const listQuery = z.object({ class_id: t.id, date: t.date });
export const markSchema = z.object({
  date: t.date,
  reason: t.optText(300),
  // يمكن تسجيل طالب واحد أو فصل كامل دفعة واحدة
  entries: z.array(z.object({ student_id: t.id, status: z.enum(STATUSES) })).min(1).max(500),
});

// withContact: جوال ولي الأمر لأزرار التنبيه (للإدارة فقط، لا يُرسل لبوابة المعلم)
export async function listForClass(q, classId, day, { withContact = false } = {}) {
  return q(
    `SELECT s.id, s.full_name AS name, a.status${withContact ? ", s.guardian_phone, s.guardian_name, s.access_key" : ""}
       FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $2
      WHERE s.class_id = $1 AND s.archived_at IS NULL
      ORDER BY s.full_name`,
    [classId, day],
  );
}

/**
 * يسجل الحضور داخل معاملة واحدة. تعديل حالة مسجلة سابقًا يتطلب سببًا.
 * @param allowedClass دالة تتحقق أن الفصل مسموح للمستخدم
 */
export async function mark(q, { date, reason, entries }, { actor, allowedClass }) {
  if (date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw badRequest("لا يمكن تسجيل حضور لتاريخ مستقبلي");
  const ids = entries.map((e) => e.student_id);
  const students = await q("SELECT id, class_id, full_name FROM students WHERE id = ANY($1::bigint[]) AND archived_at IS NULL", [ids]);
  if (students.length !== new Set(ids).size) throw notFound("أحد الطلاب غير موجود");
  for (const s of students) if (!(await allowedClass(s.class_id))) throw badRequest(`الطالب ${s.full_name} ليس ضمن فصولك`);

  const existing = new Map((await q("SELECT student_id, status FROM attendance WHERE day = $1 AND student_id = ANY($2::bigint[])", [date, ids]))
    .map((r) => [Number(r.student_id), r.status]));
  const changes = entries.filter((e) => existing.has(e.student_id) && existing.get(e.student_id) !== e.status);
  if (changes.length && !reason) throw badRequest("اكتب سبب تعديل الحضور المسجل سابقًا");

  for (const e of entries) {
    await q(
      `INSERT INTO attendance (tenant_id, student_id, day, status, note, recorded_by)
       VALUES (app_tenant(), $1, $2, $3, $4, $5)
       ON CONFLICT (student_id, day) DO UPDATE
         SET status = EXCLUDED.status, note = COALESCE(EXCLUDED.note, attendance.note), recorded_by = EXCLUDED.recorded_by
         WHERE attendance.status IS DISTINCT FROM EXCLUDED.status`,
      [e.student_id, date, e.status, existing.has(e.student_id) && changes.includes(e) ? `تعديل من ${LABEL[existing.get(e.student_id)]}: ${reason}` : null, actor],
    );
  }
  return { saved: entries.length, changed: changes.length };
}
