// صلاحيات المعلم: ما أُسند له فقط
export const teachesClass = async (q, teacherId, classId) =>
  (await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 LIMIT 1", [teacherId, classId])).length > 0;

export const teachesPair = async (q, teacherId, classId, subjectId) =>
  (await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3", [teacherId, classId, subjectId])).length > 0;

export const myLoad = (q, teacherId) => q(
  `SELECT a.class_id, a.subject_id, c.name AS class_name, s.name AS subject_name
     FROM teacher_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id
    WHERE a.teacher_id = $1 ORDER BY c.id, s.id`, [teacherId]);
