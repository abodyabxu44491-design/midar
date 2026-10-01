// تحضير الدروس: خطة أسبوعية لكل شعبة ومادة يكتبها المعلم، ويعتمدها المدير أو يعيدها بملاحظة
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, forbidden, conflict } from "../../core/http/errors.js";
import { notify } from "./notify.service.js";

const txt = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
export const planSchema = z.object({
  class_id: t.id, subject_id: t.id, week_start: t.date,
  topic: t.shortText("موضوع الدرس", 200),
  objectives: txt(2000), content: txt(4000), activities: txt(2000), assessment: txt(1000), homework: txt(1000), resources: txt(1000),
  submit: z.boolean().default(false),
});
export const STATUS = { draft: "مسودة", submitted: "مرسلة للمراجعة", approved: "معتمدة", returned: "معادة للتعديل" };

// بداية الأسبوع الدراسي (الأحد) لأي تاريخ
export const weekOf = (day) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };

const SELECT = `SELECT p.id, p.teacher_id, t.full_name AS teacher, p.class_id, c.name AS class_name, p.subject_id, s.name AS subject,
    p.week_start::text, p.topic, p.objectives, p.content, p.activities, p.assessment, p.homework, p.resources,
    p.status, p.review_note, p.reviewed_by, p.reviewed_at, p.updated_at
  FROM lesson_plans p JOIN teachers t ON t.id = p.teacher_id JOIN classes c ON c.id = p.class_id JOIN subjects s ON s.id = p.subject_id`;

export const list = (q, { teacherId = null, week = null, status = null } = {}) => q(
  `${SELECT} WHERE ($1::bigint IS NULL OR p.teacher_id = $1) AND ($2::date IS NULL OR p.week_start = $2) AND ($3::text IS NULL OR p.status = $3)
   ORDER BY p.week_start DESC, c.name, s.name LIMIT 500`, [teacherId, week, status]);

export async function save(q, teacherId, b, id = null) {
  const [ok] = await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3", [teacherId, b.class_id, b.subject_id]);
  if (!ok) throw forbidden("هذه الشعبة أو المادة غير مسندة لك");
  const week = weekOf(b.week_start);
  const status = b.submit ? "submitted" : "draft";
  const vals = [b.topic, b.objectives, b.content, b.activities, b.assessment, b.homework, b.resources, status];
  if (id) {
    const [cur] = await q("SELECT status, teacher_id FROM lesson_plans WHERE id = $1", [id]);
    if (!cur || Number(cur.teacher_id) !== Number(teacherId)) throw notFound("الخطة غير موجودة");
    if (cur.status === "approved") throw conflict("الخطة معتمدة ولا تُعدّل");
    await q(`UPDATE lesson_plans SET class_id = $2, subject_id = $3, week_start = $4, topic = $5, objectives = $6, content = $7, activities = $8,
      assessment = $9, homework = $10, resources = $11, status = $12 WHERE id = $1`, [id, b.class_id, b.subject_id, week, ...vals]);
    return { id, status };
  }
  const [dup] = await q("SELECT id FROM lesson_plans WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3 AND week_start = $4", [teacherId, b.class_id, b.subject_id, week]);
  if (dup) throw conflict("يوجد تحضير لهذه الشعبة والمادة في هذا الأسبوع. افتحه وعدّله.");
  const [row] = await q(`INSERT INTO lesson_plans (tenant_id, teacher_id, class_id, subject_id, week_start, topic, objectives, content, activities, assessment, homework, resources, status)
    VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`, [teacherId, b.class_id, b.subject_id, week, ...vals]);
  return { id: row.id, status };
}

export async function remove(q, teacherId, id) {
  const rows = await q("DELETE FROM lesson_plans WHERE id = $1 AND teacher_id = $2 AND status IN ('draft', 'returned') RETURNING id", [id, teacherId]);
  if (!rows.length) throw notFound("الخطة غير موجودة أو مرسلة");
}

export const reviewSchema = z.object({ approve: z.boolean(), note: t.optText(1000) });
export async function review(q, id, { approve, note }, actor) {
  const [p] = await q("SELECT p.status, p.topic, p.teacher_id, c.name AS class_name FROM lesson_plans p JOIN classes c ON c.id = p.class_id WHERE p.id = $1", [id]);
  if (!p) throw notFound("الخطة غير موجودة");
  if (p.status !== "submitted") throw badRequest("الخطة ليست مرسلة للمراجعة");
  if (!approve && !note) throw badRequest("اكتب سبب الإعادة ليعدّل المعلم");
  await q("UPDATE lesson_plans SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1",
    [id, approve ? "approved" : "returned", note ?? null, actor]);
  const users = await q("SELECT id FROM users WHERE teacher_id = $1", [p.teacher_id]);
  await notify(q, { event: "lesson_plan", users: users.map((u) => u.id), title: approve ? "اعتُمد تحضيرك" : "أُعيد تحضيرك للتعديل",
    body: `${p.topic} — ${p.class_name}${note ? ` — ${note}` : ""}` });
}

/** متابعة الإدارة: لكل معلم ومادة وشعبة هل سلّم تحضير الأسبوع */
export async function coverage(q, week) {
  return q(
    `SELECT a.teacher_id, t.full_name AS teacher, a.class_id, c.name AS class_name, a.subject_id, s.name AS subject, p.id AS plan_id, p.status
       FROM teacher_assignments a JOIN teachers t ON t.id = a.teacher_id JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
       LEFT JOIN lesson_plans p ON p.teacher_id = a.teacher_id AND p.class_id = a.class_id AND p.subject_id = a.subject_id AND p.week_start = $1
      ORDER BY t.full_name, c.name, s.name`, [week]);
}
