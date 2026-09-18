// إعدادات صفحة المدرسة العامة: كل عنصر اختياري وتتحكم به إدارة المدرسة
import { z } from "../../core/http/validate.js";

export const FIELDS = [
  "access_mode", "show_classes", "show_student_names", "show_search", "show_teachers",
  "show_class_counts", "show_announcements", "public_fee_badges", "show_timetable", "show_admissions",
  "profile_show_grades", "profile_show_attendance", "profile_show_teachers", "profile_show_timetable", "profile_show_homework",
];

export const settingsSchema = z.object({
  access_mode: z.enum(["code", "open"]),
  show_classes: z.boolean(),
  show_student_names: z.boolean(),
  show_search: z.boolean(),
  show_teachers: z.boolean(),
  show_class_counts: z.boolean(),
  show_announcements: z.boolean(),
  public_fee_badges: z.boolean(),
  show_timetable: z.boolean(),
  show_admissions: z.boolean(),
  profile_show_grades: z.boolean(),
  profile_show_attendance: z.boolean(),
  profile_show_teachers: z.boolean(),
  profile_show_timetable: z.boolean(),
  profile_show_homework: z.boolean(),
}).partial();

// تُنشأ تلقائيًا عند أول قراءة (بالقيم الافتراضية المتحفظة)
export async function getSettings(q) {
  const [row] = await q(
    `INSERT INTO school_public_settings (tenant_id) VALUES (app_tenant())
     ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
     RETURNING ${FIELDS.join(", ")}`);
  return row;
}

export async function updateSettings(q, patch) {
  await getSettings(q);
  const keys = FIELDS.filter((f) => patch[f] !== undefined);
  if (!keys.length) return getSettings(q);
  const sets = keys.map((f, i) => `${f} = $${i + 1}`).join(", ");
  const [row] = await q(
    `UPDATE school_public_settings SET ${sets} WHERE tenant_id = app_tenant() RETURNING ${FIELDS.join(", ")}`,
    keys.map((f) => patch[f]));
  return row;
}
