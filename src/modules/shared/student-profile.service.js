// ملف الطالب الكامل: مصدر واحد لما يراه ولي الأمر (بمعرّف الطالب) وما تراه الإدارة (بدون رمز)
import { studentSummary, listInvoices, listPayments } from "./finance.service.js";
import { listAccounts, claimsForStudent } from "./payments.service.js";
import { getSettings } from "./public-settings.service.js";
import { forClass } from "./timetable.service.js";
import { listForStudent } from "./homework.service.js";
import { current } from "./academic.service.js";
import { list as listFields, valuesOf } from "./custom-fields.service.js";
import { logoId } from "./school-logo.service.js";
import { list as listAlerts } from "./student-alerts.service.js";
import { studentExtras } from "./student-extras.service.js";
import { buildReportCard } from "./reports.service.js";

const mask = (phone) => (phone ? phone.replace(/\s/g, "").replace(/.(?=.{3})/g, "•") : null);
const ALL_ON = { profile_show_grades: true, profile_show_attendance: true, profile_show_teachers: true,
  profile_show_timetable: true, profile_show_homework: true };

/**
 * @param {object} s صف الطالب من قاعدة البيانات
 * @param {{admin?: boolean}} opts admin=true: كل الأقسام + جوال غير مقنّع + حقول الطالب الإضافية، ولا يُعاد أي معرّف دخول
 */
export async function buildProfile(q, tenant, s, { admin = false } = {}) {
  const parentSettings = await getSettings(q);
  const settings = admin ? { ...parentSettings, ...ALL_ON } : parentSettings;
  const [cls] = s.class_id ? await q("SELECT name FROM classes WHERE id = $1", [s.class_id]) : [];
  const attendance = settings.profile_show_attendance
    ? await q(`SELECT day::text AS day, status, excuse, parent_excuse, parent_excuse_state,
                      (status IN ('absent', 'late') AND day >= CURRENT_DATE - 30 AND parent_excuse_state IS DISTINCT FROM 'accepted') AS can_excuse
                 FROM attendance WHERE student_id = $1 ORDER BY day DESC LIMIT 180`, [s.id]) : [];
  // تنبيه الغياب التلقائي: غياب بلا عذر خلال 30 يومًا بلغ الحد الذي حددته المدرسة
  const threshold = parentSettings.absence_alert_threshold;
  const recentAbsent = attendance.filter((a) => a.status === "absent" && a.day >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).length;
  const absenceWarning = settings.profile_show_attendance && threshold && recentAbsent >= threshold
    ? { absent: recentAbsent, threshold } : null;
  const alerts = (await listAlerts(q, s.id, { parentOnly: !admin, limit: 30 }))
    .map(({ teacher_id, for_parent, ...a }) => (admin ? { ...a, teacher_id, for_parent } : { ...a, for_parent }));
  const term = await current(q);
  const grades = settings.profile_show_grades ? await q(
    `SELECT e.title, e.exam_date, e.max_score, sub.name AS subject, sc.score, gc.name AS component
       FROM exams e JOIN scores sc ON sc.exam_id = e.id AND sc.student_id = $1 JOIN subjects sub ON sub.id = e.subject_id
       LEFT JOIN grade_components gc ON gc.id = e.component_id
      WHERE e.status = 'published' AND sc.score IS NOT NULL ORDER BY e.exam_date DESC NULLS LAST, e.id DESC`, [s.id]) : [];
  // معلم واحد بكل مواده في الفصل، وصورته للإدارة دائمًا ولولي الأمر إن فعّلت المدرسة نشر صور المعلمين
  const teachers = settings.profile_show_teachers ? await q(
    `SELECT t.full_name AS teacher, string_agg(DISTINCT sub.name, '، ' ORDER BY sub.name) AS subject,
            CASE WHEN $2 AND t.photo IS NOT NULL
                 THEN 'data:' || t.photo_type || ';base64,' || replace(encode(t.photo, 'base64'), E'\n', '') END AS photo
       FROM teacher_assignments a JOIN teachers t ON t.id = a.teacher_id JOIN subjects sub ON sub.id = a.subject_id
      WHERE a.class_id = $1 GROUP BY t.id ORDER BY min(sub.name)`, [s.class_id, admin || parentSettings.show_teacher_photos]) : [];
  const news = await q(
    "SELECT title, body, created_at FROM announcements WHERE class_id IS NULL OR class_id = $1 ORDER BY id DESC LIMIT 20", [s.class_id]);

  let fees = null;
  if (s.fees_enabled) {
    fees = {
      ...(await studentSummary(q, s.id)),
      invoices: (await listInvoices(q, "i.student_id = $1", [s.id])).map(({ student_name, class_name, student_id, guardian_phone, access_key, ...i }) => i),
      receipts: await listPayments(q, s.id),
      claims: await claimsForStudent(q, s.id),
      accounts: (await listAccounts(q, { activeOnly: true })).map(({ is_active, ...a }) => a),
      payment_note: (await q("SELECT payment_note FROM tenants WHERE id = app_tenant()"))[0].payment_note,
    };
  }
  const student = { id: s.id, name: s.full_name, class_name: cls?.name || "غير محدد", guardian_name: s.guardian_name,
    guardian_phone: admin ? s.guardian_phone : mask(s.guardian_phone), since: s.created_at };
  if (admin) {
    Object.assign(student, { student_no: s.student_no, birth_date: s.birth_date, gender: s.gender, student_phone: s.student_phone,
      status: s.status, status_note: s.status_note, has_photo: Boolean(s.photo), version: s.version, class_id: s.class_id });
  }
  return {
    school: tenant.name, school_id: tenant.id, school_logo: await logoId(q), currency: tenant.currency, admin, student,
    custom: await customValues(q, s.id, admin),
    settings: { ...settings, allow_parent_excuses: settings.allow_parent_excuses && settings.profile_show_attendance },
    academic: term, attendance, absence_warning: absenceWarning, alerts, grades, teachers, announcements: news, fees,
    // النسبة العامة للفصل الحالي بنفس حساب كشف الدرجات والشهادة (موزونة بتوزيع الدرجات إن وُجد)
    grades_percent: settings.profile_show_grades && grades.length ? (await buildReportCard(q, s.id))?.summary.percent ?? null : null,
    timetable: settings.profile_show_timetable && s.class_id ? await forClass(q, s.class_id) : [],
    homework: settings.profile_show_homework && s.class_id ? await listForStudent(q, s) : [],
    features: await studentExtras(q, s, { admin }),
  };
}

// الحقول المخصصة: لولي الأمر ما فعّلت المدرسة إظهاره، وللإدارة ما فعّلت إظهاره في الإدارة
async function customValues(q, studentId, admin) {
  const fields = (await listFields(q, "student")).filter((f) => f.is_active && (admin ? f.show_admin : f.show_parent));
  if (!fields.length) return [];
  const values = await valuesOf(q, "student", studentId);
  return fields.filter((f) => values[f.key] !== undefined).map((f) => ({ label: f.label, value: values[f.key] }));
}
