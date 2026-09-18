// الواجبات: المعلم ينشئها ويرصد التسليم، وولي الأمر يتابعها في ملف الطالب
import { z, t } from "../../core/http/validate.js";
import { notFound } from "../../core/http/errors.js";

export const createSchema = z.object({
  class_id: t.id,
  subject_id: t.id,
  title: t.shortText("عنوان الواجب"),
  details: t.optText(2000),
  due_date: t.optDate,
});
export const markSchema = z.object({
  entries: z.array(z.object({ student_id: t.id, submitted: z.boolean(), note: t.optText(300) })).min(1).max(500),
});

const SELECT = `SELECT a.id, a.class_id, a.subject_id, a.teacher_id, a.title, a.details, a.due_date, a.created_by, a.created_at,
    c.name AS class_name, s.name AS subject, t.full_name AS teacher,
    (SELECT count(*) FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.submitted)::int AS submitted_count,
    (SELECT count(*) FROM students st WHERE st.class_id = a.class_id AND st.archived_at IS NULL)::int AS class_size
  FROM assignments a
  JOIN classes c ON c.id = a.class_id
  JOIN subjects s ON s.id = a.subject_id
  LEFT JOIN teachers t ON t.id = a.teacher_id`;

export const listAll = (q) => q(`${SELECT} ORDER BY a.due_date DESC NULLS LAST, a.id DESC LIMIT 300`);
export const listForTeacher = (q, teacherId) => q(`${SELECT} WHERE a.teacher_id = $1 ORDER BY a.id DESC LIMIT 300`, [teacherId]);
export const listForStudent = (q, student) => q(
  `SELECT a.id, a.title, a.details, a.due_date, s.name AS subject, t.full_name AS teacher,
          COALESCE(sub.submitted, false) AS submitted
     FROM assignments a JOIN subjects s ON s.id = a.subject_id
     LEFT JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = $1
    WHERE a.class_id = $2 ORDER BY a.due_date DESC NULLS LAST, a.id DESC LIMIT 40`,
  [student.id, student.class_id]);

export async function get(q, id) {
  const [a] = await q("SELECT * FROM assignments WHERE id = $1", [id]);
  if (!a) throw notFound("الواجب غير موجود");
  return a;
}

export async function create(q, b, { teacherId = null, actor }) {
  const [row] = await q(
    `INSERT INTO assignments (tenant_id, class_id, subject_id, teacher_id, title, details, due_date, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [b.class_id, b.subject_id, teacherId, b.title, b.details, b.due_date, actor]);
  return row;
}

export const sheet = (q, assignment) => q(
  `SELECT st.id, st.full_name AS name, COALESCE(sub.submitted, false) AS submitted, sub.note
     FROM students st LEFT JOIN assignment_submissions sub ON sub.assignment_id = $1 AND sub.student_id = st.id
    WHERE st.class_id = $2 AND st.archived_at IS NULL ORDER BY st.full_name`,
  [assignment.id, assignment.class_id]);

export async function markSubmissions(q, assignment, entries, actor) {
  for (const e of entries) {
    const [st] = await q("SELECT id FROM students WHERE id = $1 AND class_id = $2", [e.student_id, assignment.class_id]);
    if (!st) continue;
    await q(
      `INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submitted, note, marked_by)
       VALUES (app_tenant(), $1, $2, $3, $4, $5)
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET submitted = EXCLUDED.submitted, note = EXCLUDED.note, marked_by = EXCLUDED.marked_by`,
      [assignment.id, e.student_id, e.submitted, e.note, actor]);
  }
  return entries.length;
}

export const remove = (q, id) => q("DELETE FROM assignments WHERE id = $1 RETURNING id", [id]);
