// الجدول الدراسي: حصص الصفوف، مع منع تعارض المعلمين من قاعدة البيانات نفسها
import { z, t } from "../../core/http/validate.js";
import { conflict, badRequest } from "../../core/http/errors.js";

export const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

export const slotSchema = z.object({
  class_id: t.id,
  day: z.coerce.number().int().min(0).max(6),
  period: z.coerce.number().int().min(1).max(10),
  subject_id: t.optId,          // فارغ = حذف الحصة
  teacher_id: t.optId,
  room: t.optText(30),
});

const SELECT = `SELECT s.id, s.class_id, s.day, s.period, s.room, s.subject_id, s.teacher_id,
    sub.name AS subject, t.full_name AS teacher, c.name AS class_name
  FROM timetable_slots s
  JOIN subjects sub ON sub.id = s.subject_id
  JOIN classes c ON c.id = s.class_id
  LEFT JOIN teachers t ON t.id = s.teacher_id`;

export const forClass = (q, classId) => q(`${SELECT} WHERE s.class_id = $1 ORDER BY s.day, s.period`, [classId]);
export const forTeacher = (q, teacherId) => q(`${SELECT} WHERE s.teacher_id = $1 ORDER BY s.day, s.period`, [teacherId]);
export const forToday = (q, teacherId) => q(
  `${SELECT} WHERE s.teacher_id = $1 AND s.day = CASE extract(dow FROM CURRENT_DATE)::int WHEN 0 THEN 0 ELSE extract(dow FROM CURRENT_DATE)::int END
   ORDER BY s.period`, [teacherId]);
export const forAllClasses = (q) => q(`${SELECT} ORDER BY c.id, s.day, s.period`);

// حفظ حصة واحدة (أو حذفها عند عدم إرسال المادة)
export async function setSlot(q, b) {
  if (!b.subject_id) {
    await q("DELETE FROM timetable_slots WHERE class_id = $1 AND day = $2 AND period = $3", [b.class_id, b.day, b.period]);
    return { deleted: true };
  }
  if (b.teacher_id) {
    // تحقق مبكر برسالة واضحة (والقيد في القاعدة هو الضمان الأخير)
    const [clash] = await q(
      `SELECT c.name FROM timetable_slots s JOIN classes c ON c.id = s.class_id
        WHERE s.teacher_id = $1 AND s.day = $2 AND s.period = $3 AND s.class_id <> $4`,
      [b.teacher_id, b.day, b.period, b.class_id]);
    if (clash) throw conflict(`المعلم لديه حصة في ${clash.name} بنفس الوقت`);
    const [assigned] = await q(
      "SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3",
      [b.teacher_id, b.class_id, b.subject_id]);
    if (!assigned) throw badRequest("هذه المادة غير مسندة لهذا المعلم في هذا الصف");
  }
  const [row] = await q(
    `INSERT INTO timetable_slots (tenant_id, class_id, day, period, subject_id, teacher_id, room)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (class_id, day, period)
     DO UPDATE SET subject_id = EXCLUDED.subject_id, teacher_id = EXCLUDED.teacher_id, room = EXCLUDED.room
     RETURNING id`,
    [b.class_id, b.day, b.period, b.subject_id, b.teacher_id, b.room]);
  return row;
}

export async function clearClass(q, classId) {
  const rows = await q("DELETE FROM timetable_slots WHERE class_id = $1 RETURNING id", [classId]);
  return rows.length;
}
