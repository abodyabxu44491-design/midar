// منطق الاختبارات والدرجات
import { z, t } from "../../core/http/validate.js";
import { notFound } from "../../core/http/errors.js";

export const createSchema = z.object({
  class_id: t.id, subject_id: t.id,
  title: t.shortText("عنوان الاختبار"),
  exam_date: t.optDate,
  max_score: z.coerce.number().positive("الدرجة القصوى غير صحيحة").max(1000).multipleOf(0.25),
});
export const scoresSchema = z.object({
  scores: z.record(z.string().regex(/^\d+$/),
    z.union([z.coerce.number().min(0, "الدرجة لا تكون سالبة").max(1000).multipleOf(0.25), z.literal(""), z.null()])),
});

const SELECT = `SELECT e.id, e.title, e.exam_date, e.max_score, e.status, e.published_at, e.created_by,
    e.class_id, e.subject_id, e.term_id, tr.name AS term_name, c.name AS class_name, s.name AS subject_name,
    (SELECT count(*) FROM scores x WHERE x.exam_id = e.id AND x.score IS NOT NULL)::int AS graded
  FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects s ON s.id = e.subject_id
  LEFT JOIN terms tr ON tr.id = e.term_id`;

export const listAll = (q) => q(`${SELECT} ORDER BY e.id DESC LIMIT 500`);
export const listForTeacher = (q, teacherId) => q(
  `${SELECT} WHERE EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = $1 AND ta.class_id = e.class_id AND ta.subject_id = e.subject_id)
   ORDER BY e.id DESC LIMIT 500`, [teacherId]);

export async function get(q, id) {
  const [e] = await q("SELECT * FROM exams WHERE id = $1", [id]);
  if (!e) throw notFound("الاختبار غير موجود");
  return e;
}

export async function create(q, b, actor) {
  const [row] = await q(
    `INSERT INTO exams (tenant_id, class_id, subject_id, title, exam_date, max_score, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id`,
    [b.class_id, b.subject_id, b.title, b.exam_date, b.max_score, actor]);
  return row;
}

export const sheet = (q, exam) => q(
  `SELECT st.id, st.full_name AS name, sc.score
     FROM students st LEFT JOIN scores sc ON sc.student_id = st.id AND sc.exam_id = $1
    WHERE st.class_id = $2 AND st.archived_at IS NULL ORDER BY st.full_name`, [exam.id, exam.class_id]);

// حفظ الدرجات دفعة واحدة؛ قاعدة البيانات ترفض أي درجة أكبر من القصوى أو اختبار غير مسودة
export async function saveScores(q, exam, scores, actor) {
  const ids = Object.keys(scores).map(Number);
  const valid = new Set((await q("SELECT id FROM students WHERE class_id = $1 AND id = ANY($2::bigint[])", [exam.class_id, ids])).map((r) => Number(r.id)));
  let n = 0;
  for (const [sid, val] of Object.entries(scores)) {
    if (!valid.has(Number(sid))) continue;
    await q(
      `INSERT INTO scores (tenant_id, exam_id, student_id, score, updated_by) VALUES (app_tenant(), $1, $2, $3, $4)
       ON CONFLICT (exam_id, student_id) DO UPDATE SET score = EXCLUDED.score, updated_by = EXCLUDED.updated_by
       WHERE scores.score IS DISTINCT FROM EXCLUDED.score`,
      [exam.id, sid, val === "" || val === null ? null : val, actor]);
    n++;
  }
  return n;
}

export async function setStatus(q, exam, status) {
  await q("UPDATE exams SET status = $2 WHERE id = $1", [exam.id, status]);
}
