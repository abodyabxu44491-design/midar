// طلبات الالتحاق: يرسلها ولي الأمر من صفحة المدرسة، وتراجعها الإدارة
import { z, t } from "../../core/http/validate.js";
import { notFound, badRequest } from "../../core/http/errors.js";
import * as students from "./students.service.js";

export const requestSchema = z.object({
  student_name: t.name("اسم الطالب"),
  grade_wanted: t.optText(60),
  birth_date: t.optDate,
  guardian_name: t.name("اسم ولي الأمر"),
  guardian_phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح"),
  note: t.optText(1000),
});
export const reviewSchema = z.object({
  decision: z.enum(["contacted", "accepted", "rejected"]),
  class_id: t.optId,          // عند القبول: الفصل الذي يُسجَّل فيه
  note: t.optText(300),
});

export const list = (q) => q(
  `SELECT a.id, a.student_name, a.grade_wanted, a.birth_date, a.guardian_name, a.guardian_phone, a.note,
          a.status, a.review_note, a.student_id, a.created_at, s.access_key
     FROM admissions a LEFT JOIN students s ON s.id = a.student_id
    ORDER BY a.status = 'new' DESC, a.id DESC LIMIT 300`);

// القبول ينشئ ملف الطالب مباشرة بمعرّفه، ويربطه بالطلب
export async function review(q, id, b, tenant, actor) {
  const [a] = await q("SELECT * FROM admissions WHERE id = $1 FOR UPDATE", [id]);
  if (!a) throw notFound("الطلب غير موجود");
  if (a.status === "accepted") throw badRequest("الطلب مقبول مسبقًا وأُنشئ له ملف طالب");

  if (b.decision !== "accepted") {
    await q("UPDATE admissions SET status = $2, review_note = $3 WHERE id = $1", [id, b.decision, b.note]);
    return { status: b.decision };
  }
  const [created] = await students.create(q, tenant, [{
    name: a.student_name, class_id: b.class_id, guardian_name: a.guardian_name,
    guardian_phone: a.guardian_phone, fees_enabled: false,
  }]);
  await q("UPDATE admissions SET status = 'accepted', student_id = $2, review_note = $3 WHERE id = $1", [id, created.id, b.note]);
  return { status: "accepted", student: created, actor };
}
