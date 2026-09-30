// مساعد إدخال البيانات: يبيّن للمدير ما ينقص مدرسته (قائمة اكتمال بالأرقام الحقيقية)،
// ويختصر الإدخال: لصق قائمة أسماء، وإكمال الناقص في جدول واحد، وإضافة معلمين دفعة واحدة.
// كل الكتابة تمر بنفس قواعد الطلاب والمعلمين (حد الباقة، رقم الطالب لا يتكرر، سجل التدقيق).
import { z, t, asciiDigits } from "../../core/http/validate.js";
import { badRequest } from "../../core/http/errors.js";
import { normalizePhone } from "./students.service.js";

/* ---------- قائمة الاكتمال ---------- */
// العدد والمعدود بالعربية: 1 ← «طالب واحد»، 2 ← «طالبان»، 3–10 ← «5 طلاب»، 11+ ← «12 طالبًا»
const n$ = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n % 100 >= 3 && n % 100 <= 10 ? `${n} ${few}` : `${n} ${many}`);
const W = {
  student: ["طالب واحد", "طالبان", "طلاب", "طالبًا"], teacher: ["معلم واحد", "معلمان", "معلمين", "معلمًا"],
  grade: ["صف واحد", "صفان", "صفوف", "صفًا"], section: ["شعبة واحدة", "شعبتان", "شعب", "شعبة"],
  subject: ["مادة واحدة", "مادتان", "مواد", "مادة"], holiday: ["إجازة واحدة", "إجازتان", "إجازات", "إجازة"],
};
/**
 * كل بند: { key, group, title, done, total, level: ok|warn|todo|info, action: { part | tab }, hint }
 * level: ok مكتمل، todo لازم قبل التشغيل، warn ناقص جزئيًا، info اختياري مفيد.
 */
export async function checklist(q, modules = {}) {
  const on = (m) => modules[m] !== false;
  const [c] = await q(`SELECT
      (SELECT count(*) FROM grades)::int AS grades,
      (SELECT count(*) FROM classes)::int AS classes,
      (SELECT count(*) FROM subjects WHERE is_active)::int AS subjects,
      (SELECT count(*) FROM grades g WHERE NOT EXISTS (SELECT 1 FROM subject_grades sg JOIN subjects s ON s.id = sg.subject_id AND s.is_active WHERE sg.grade_id = g.id))::int AS grades_no_subjects,
      (SELECT count(*) FROM teachers)::int AS teachers,
      (SELECT count(*) FROM classes c JOIN subject_grades sg ON sg.grade_id = c.grade_id JOIN subjects s ON s.id = sg.subject_id AND s.is_active)::int AS pairs,
      (SELECT count(*) FROM classes c JOIN subject_grades sg ON sg.grade_id = c.grade_id JOIN subjects s ON s.id = sg.subject_id AND s.is_active
         WHERE NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = c.id AND ta.subject_id = sg.subject_id))::int AS pairs_no_teacher,
      (SELECT count(*) FROM students WHERE status = 'active')::int AS students,
      (SELECT count(*) FROM students WHERE status = 'active' AND class_id IS NULL)::int AS no_class,
      (SELECT count(*) FROM students WHERE status = 'active' AND guardian_phone IS NULL)::int AS no_phone,
      (SELECT count(*) FROM students WHERE status = 'active' AND guardian_name IS NULL)::int AS no_guardian,
      (SELECT count(*) FROM students WHERE status = 'active' AND birth_date IS NULL)::int AS no_birth,
      (SELECT count(*) FROM classes c WHERE EXISTS (SELECT 1 FROM students s WHERE s.class_id = c.id AND s.status = 'active')
         AND NOT EXISTS (SELECT 1 FROM timetable_slots ts WHERE ts.class_id = c.id))::int AS classes_no_timetable,
      (SELECT count(*) FROM students s WHERE s.status = 'active' AND s.fees_enabled
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.student_id = s.id AND i.status = 'open'
                           AND (i.term_id IS NULL OR i.term_id = (SELECT id FROM terms WHERE is_current LIMIT 1))))::int AS fees_no_invoice,
      (SELECT count(*) FROM payment_accounts WHERE is_active)::int AS accounts,
      (SELECT count(*) FROM holidays)::int AS holidays,
      (SELECT count(*) FROM terms WHERE is_current)::int AS current_term`);

  const items = [];
  const add = (x) => items.push(x);
  const has = (n) => n > 0;
  add({ key: "structure", group: "الهيكل", title: "الصفوف والشعب", done: c.classes, total: null,
    level: has(c.classes) ? "ok" : "todo", hint: has(c.classes) ? `${n$(c.grades, W.grade)} و${n$(c.classes, W.section)}` : "أنشئ الصفوف من الإعدادات أو معالج الإعداد", action: { tab: "settings" } });
  add({ key: "subjects", group: "الهيكل", title: "المواد مربوطة بالصفوف", done: c.grades - c.grades_no_subjects, total: c.grades,
    level: !has(c.subjects) ? "todo" : c.grades_no_subjects ? "warn" : "ok",
    hint: c.grades_no_subjects ? `${n$(c.grades_no_subjects, W.grade)} بلا مواد` : n$(c.subjects, W.subject), action: { tab: "settings" } });
  add({ key: "term", group: "الهيكل", title: "السنة والفصل الحالي", done: c.current_term, total: 1,
    level: c.current_term ? "ok" : "todo", hint: c.current_term ? null : "حدّد الفصل الحالي", action: { tab: "academic" } });
  add({ key: "teachers", group: "المعلمون", title: "المعلمون", done: c.teachers, total: null,
    level: has(c.teachers) ? "ok" : "todo", hint: has(c.teachers) ? n$(c.teachers, W.teacher) : "أضفهم بلصق قائمة أسماء", action: { part: "teachers" } });
  if (has(c.pairs)) add({ key: "assignments", group: "المعلمون", title: "كل مادة في كل شعبة لها معلم", done: c.pairs - c.pairs_no_teacher, total: c.pairs,
    level: c.pairs_no_teacher === 0 ? "ok" : c.pairs_no_teacher === c.pairs ? "todo" : "warn",
    hint: c.pairs_no_teacher ? `${n$(c.pairs_no_teacher, W.subject)} في الشعب بلا معلم` : null, action: { tab: "distribution" } });
  add({ key: "students", group: "الطلاب", title: "الطلاب", done: c.students, total: null,
    level: has(c.students) ? "ok" : "todo", hint: has(c.students) ? n$(c.students, W.student) : "الصق قائمة أسماء كل شعبة", action: { part: "students" } });
  if (has(c.students)) {
    add({ key: "no_class", group: "الطلاب", title: "كل طالب في شعبة", done: c.students - c.no_class, total: c.students,
      level: c.no_class ? "warn" : "ok", hint: c.no_class ? `${n$(c.no_class, W.student)} بلا شعبة` : null, action: { tab: "students" } });
    add({ key: "no_phone", group: "الطلاب", title: "جوال ولي الأمر", done: c.students - c.no_phone, total: c.students,
      level: c.no_phone ? "warn" : "ok", hint: c.no_phone ? `${n$(c.no_phone, W.student)} بلا جوال ولي أمر (لا تصلهم رسائل الغياب والرسوم)` : null, action: { part: "fill", field: "phone" } });
    add({ key: "no_guardian", group: "الطلاب", title: "اسم ولي الأمر", done: c.students - c.no_guardian, total: c.students,
      level: c.no_guardian ? "warn" : "ok", hint: c.no_guardian ? `${n$(c.no_guardian, W.student)} بلا اسم ولي أمر` : null, action: { part: "fill", field: "guardian" } });
    add({ key: "no_birth", group: "الطلاب", title: "تاريخ الميلاد", done: c.students - c.no_birth, total: c.students,
      level: c.no_birth ? "info" : "ok", hint: c.no_birth ? `${n$(c.no_birth, W.student)} بلا تاريخ ميلاد` : null, action: { part: "fill", field: "birth" } });
  }
  if (on("timetable") && has(c.students)) add({ key: "timetable", group: "التشغيل", title: "الجدول الدراسي", done: null, total: null,
    level: c.classes_no_timetable ? "warn" : "ok", hint: c.classes_no_timetable ? `${n$(c.classes_no_timetable, W.section)} بلا جدول` : null, action: { tab: "timetable" } });
  if (on("fees") && has(c.students)) {
    add({ key: "fees", group: "التشغيل", title: "فواتير الفصل الحالي", done: null, total: null,
      level: c.fees_no_invoice ? "info" : "ok", hint: c.fees_no_invoice ? `${n$(c.fees_no_invoice, W.student)} مشمولون بالرسوم بلا فاتورة` : null, action: { tab: "finance" } });
    add({ key: "accounts", group: "التشغيل", title: "حساب بنكي أو محفظة للسداد", done: c.accounts, total: null,
      level: c.accounts ? "ok" : "info", hint: c.accounts ? null : "يظهر لولي الأمر عند السداد", action: { tab: "settings" } });
  }
  add({ key: "holidays", group: "التشغيل", title: "الإجازات", done: c.holidays, total: null,
    level: c.holidays ? "ok" : "info", hint: c.holidays ? n$(c.holidays, W.holiday) : "أضف المناسبات الوطنية والأعياد", action: { tab: "academic" } });

  // النسبة من البنود الأساسية فقط (الاختيارية «info» لا تُنقصها): المكتمل 1، الناقص جزئيًا بنسبة ما أُنجز، غير المبدوء 0
  const core = items.filter((x) => x.level !== "info");
  const value = (x) => (x.level === "ok" ? 1 : x.level === "todo" ? 0 : x.total ? Math.min(1, x.done / x.total) * 0.95 : 0.5);
  const score = Math.round((100 * core.reduce((n, x) => n + value(x), 0)) / Math.max(1, core.length));
  return { score, items, counts: c };
}

/* ---------- الطلاب الناقصة بياناتهم ---------- */
const MISSING = {
  phone: "s.guardian_phone IS NULL",
  guardian: "s.guardian_name IS NULL",
  birth: "s.birth_date IS NULL",
  any: "(s.guardian_phone IS NULL OR s.guardian_name IS NULL OR s.birth_date IS NULL)",
  all: "TRUE",
};
export const missingQuery = z.object({
  class_id: t.optId,
  missing: z.enum(Object.keys(MISSING)).default("any"),
});
export async function studentsFor(q, { class_id, missing }) {
  if (!class_id && missing === "all") throw badRequest("اختر الشعبة");
  const rows = await q(
    `SELECT s.id, s.full_name AS name, s.guardian_name, s.guardian_phone, s.birth_date::text AS birth_date, s.student_no, s.version, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.status = 'active' AND ($1::bigint IS NULL OR s.class_id = $1) AND ${MISSING[missing]}
      ORDER BY c.sort_order NULLS LAST, c.name, s.full_name LIMIT 500`, [class_id ?? null]);
  return rows;
}

/* ---------- حفظ الجدول: ما تغيّر فقط، في معاملة واحدة ---------- */
const dateOrEmpty = z.union([t.date, z.literal(""), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null));
export const fillSchema = z.object({
  rows: z.array(z.object({
    id: t.id,
    version: z.coerce.number().int().positive(),
    guardian_name: t.optText(120),
    guardian_phone: t.phone,
    birth_date: dateOrEmpty,
    student_no: z.preprocess((v) => (typeof v === "string" ? asciiDigits(v).trim() : v), t.optText(30)),
  })).min(1, "لا توجد تعديلات").max(500),
});
export async function fillStudents(q, rows) {
  const nos = rows.map((r) => r.student_no).filter(Boolean);
  if (new Set(nos).size !== nos.length) throw badRequest("رقم طالب مكرر في الجدول");
  let updated = 0;
  const conflicts = [];
  for (const r of rows) {
    const sets = [], vals = [r.id, r.version];
    const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (r.guardian_name !== undefined) put("guardian_name", r.guardian_name);
    if (r.guardian_phone !== undefined) put("guardian_phone", normalizePhone(r.guardian_phone));
    if (r.birth_date !== undefined) put("birth_date", r.birth_date);
    if (r.student_no !== undefined) {
      if (r.student_no) {
        const [dup] = await q("SELECT 1 FROM students WHERE student_no = $1 AND id <> $2", [r.student_no, r.id]);
        if (dup) throw badRequest(`رقم الطالب «${r.student_no}» مستخدم لطالب آخر`);
      }
      put("student_no", r.student_no);
    }
    if (!sets.length) continue;
    const done = await q(`UPDATE students SET ${sets.join(", ")} WHERE id = $1 AND version = $2 RETURNING id`, vals);
    if (done.length) updated++; else conflicts.push(r.id);
  }
  return { updated, conflicts };
}

/* ---------- معلمون دفعة واحدة: أسماء المستخدمين تُنشأ تلقائيًا ---------- */
export const teachersSchema = z.object({
  teachers: z.array(z.object({
    name: t.name("اسم المعلم"),
    phone: t.phone,
    specialty: t.optText(80),
  })).min(1, "لا يوجد معلمون").max(200, "الحد 200 معلم في المرة"),
});
/** يحوّل القائمة إلى أسطر استيراد المعلمين بأسماء مستخدمين متتابعة غير مستخدمة (t1001، t1002…) */
export async function teacherRows(q, list) {
  const taken = new Set((await q("SELECT username FROM users")).map((u) => u.username));
  const [m] = await q(`SELECT COALESCE(MAX(substring(username FROM '^t([0-9]{1,7})$')::int), 1000) AS n FROM users WHERE username ~ '^t[0-9]{1,7}$'`);
  let n = Math.max(1000, Number(m.n));
  return list.map((x) => {
    let u;
    do { n++; u = `t${n}`; } while (taken.has(u));
    taken.add(u);
    return { name: x.name, username: u, phone: x.phone ?? null, specialty: x.specialty ?? null };
  });
}
