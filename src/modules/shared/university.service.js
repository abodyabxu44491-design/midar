/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest, conflict, forbidden, notFound } from "../../core/http/errors.js";
import { t, z } from "../../core/http/validate.js";
import { newStudentKey } from "../../core/auth/codes.js";
import { writeCertificate } from "./certificates.service.js";

// The university engine: colleges → departments → programmes and courses (credit hours, prerequisites) → terms → the
// sections offered each term → students admitted to a programme register for sections under the university's rules →
// instructors enter marks → letter, points, term and cumulative GPA, and the academic record.

export const DEGREES = { diploma: "دبلوم", associate: "دبلوم مشارك", bachelor: "بكالوريوس", master: "ماجستير", doctorate: "دكتوراه" };
export const TERM_STATUS = { planned: "مخطط", registration: "التسجيل مفتوح", running: "جارٍ", grading: "رصد الدرجات", closed: "مغلق" };
export const STUDENT_STATUS = { active: "منتظم", graduated: "متخرج", withdrawn: "منسحب", suspended: "موقوف", transferred: "منتقل" };
const code = (max = 12) => z.string().trim().toUpperCase().regex(new RegExp(`^[A-Z0-9-]{1,${max}}$`), "الرمز: حروف إنجليزية وأرقام فقط");
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------- settings ---------- */
const scaleRow = z.object({ letter: z.string().trim().min(1).max(4), min: z.coerce.number().min(0).max(100), points: z.coerce.number().min(0).max(5) });
export const settingsSchema = z.object({
  grade_scale: z.array(scaleRow).min(2).max(20).optional(),
  max_points: z.coerce.number().refine((v) => v === 4 || v === 5, "المعدل من 4 أو من 5").optional(),
  max_credits: z.coerce.number().int().min(1).max(40).optional(),
  min_credits: z.coerce.number().int().min(0).max(40).optional(),
  probation_below: z.coerce.number().min(0).max(5).optional(),
  credit_fee: z.coerce.number().min(0).max(1_000_000).optional(),
  grad_min_cgpa: z.coerce.number().min(0).max(5).optional(),
  self_registration: z.boolean().optional(),
});
export async function getSettings(q) {
  const [s] = await q("SELECT * FROM uni_settings WHERE tenant_id = app_tenant()");
  if (s) return { ...s, max_points: Number(s.max_points), probation_below: Number(s.probation_below), credit_fee: Number(s.credit_fee), grad_min_cgpa: Number(s.grad_min_cgpa) };
  await q("INSERT INTO uni_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  return getSettings(q);
}
export async function updateSettings(q, b) {
  const cur = await getSettings(q);
  const v = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)) };
  const scale = [...v.grade_scale].sort((a, c) => c.min - a.min);
  if (scale[scale.length - 1].min !== 0) throw badRequest("أدنى تقدير في السلّم يبدأ من الصفر");
  if (new Set(scale.map((x) => x.min)).size !== scale.length) throw badRequest("لكل تقدير حد أدنى مختلف");
  if (scale.some((x) => x.points > v.max_points)) throw badRequest(`النقاط لا تتجاوز ${v.max_points}`);
  if (v.min_credits > v.max_credits) throw badRequest("الحد الأدنى للساعات أكبر من الأعلى");
  await q(`UPDATE uni_settings SET grade_scale = $1, max_points = $2, max_credits = $3, min_credits = $4, probation_below = $5,
                   credit_fee = $6, grad_min_cgpa = $7, self_registration = $8, updated_at = now() WHERE tenant_id = app_tenant()`,
    [JSON.stringify(scale), v.max_points, v.max_credits, v.min_credits, v.probation_below, v.credit_fee, v.grad_min_cgpa, v.self_registration]);
  return getSettings(q);
}
export const gradeOf = (scale, mark) => {
  const row = [...scale].sort((a, c) => c.min - a.min).find((x) => Number(mark) >= x.min);
  return { letter: row.letter, points: row.points };
};

/* ---------- structure ---------- */
export const collegeSchema = z.object({ code: code(), name: t.shortText("اسم الكلية", 150), dean: t.optText(120) });
export const departmentSchema = z.object({ college_id: t.id, code: code(), name: t.shortText("اسم القسم", 150), head: t.optText(120) });
export const programSchema = z.object({
  department_id: t.id, code: code(), name: t.shortText("اسم البرنامج", 150), degree: z.enum(Object.keys(DEGREES)).prefault("bachelor"),
  total_credits: z.coerce.number().int().min(1).max(400), years: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(10)]).optional().transform((v) => (v === "" ? null : v)),
});
export const courseSchema = z.object({
  department_id: t.id, code: code(16), name: t.shortText("اسم المقرر", 150), credits: z.coerce.number().int().min(0).max(12),
  prerequisites: z.array(t.id).max(10).prefault([]), description: t.optText(1000),
});

const insert = async (q, table, cols, vals, label) => {
  try {
    return (await q(`INSERT INTO ${table} (tenant_id, ${cols.join(", ")}) VALUES (app_tenant(), ${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, vals))[0];
  } catch (e) {
    if (e.code === "23505") throw conflict(`الرمز مستخدم ل${label} آخر`);
    if (e.code === "23503") throw badRequest("أحد العناصر المرتبطة غير موجود");
    throw e;
  }
};
export const addCollege = (q, b) => insert(q, "uni_colleges", ["code", "name", "dean"], [b.code, b.name, b.dean ?? null], "كلية");
export const addDepartment = (q, b) => insert(q, "uni_departments", ["college_id", "code", "name", "head"], [b.college_id, b.code, b.name, b.head ?? null], "قسم");
export const addProgram = (q, b) => insert(q, "uni_programs", ["department_id", "code", "name", "degree", "total_credits", "years"],
  [b.department_id, b.code, b.name, b.degree, b.total_credits, b.years ?? null], "برنامج");
export async function addCourse(q, b) {
  await checkPrereqs(q, b.prerequisites);
  const row = await insert(q, "uni_courses", ["department_id", "code", "name", "credits", "prerequisites", "description"],
    [b.department_id, b.code, b.name, b.credits, b.prerequisites, b.description ?? null], "مقرر");
  return { ...row, prerequisites: row.prerequisites.map(Number) };
}
async function checkPrereqs(q, ids, self = null) {
  if (!ids?.length) return;
  if (self && ids.includes(self)) throw badRequest("المقرر لا يكون متطلبًا لنفسه");
  const found = await q("SELECT id FROM uni_courses WHERE id = ANY($1)", [ids]);
  if (found.length !== new Set(ids).size) throw badRequest("أحد المتطلبات السابقة غير موجود");
}
export async function updateCourse(q, id, b) {
  const [cur] = await q("SELECT * FROM uni_courses WHERE id = $1", [id]);
  if (!cur) throw notFound("المقرر غير موجود");
  if (b.prerequisites) await checkPrereqs(q, b.prerequisites, id);
  const v = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)) };
  const [row] = await q(`UPDATE uni_courses SET name = $2, credits = $3, prerequisites = $4, description = $5, status = $6 WHERE id = $1 RETURNING *`,
    [id, v.name, v.credits, (v.prerequisites || []).map(Number), v.description, v.status]);
  return { ...row, prerequisites: row.prerequisites.map(Number) };
}
export const planSchema = z.object({ courses: z.array(z.object({ course_id: t.id, kind: z.enum(["required", "elective"]).prefault("required"),
  level: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(20)]).optional().transform((v) => (v === "" ? null : v)) })).max(200) });
export async function setPlan(q, programId, b) {
  const [p] = await q("SELECT id FROM uni_programs WHERE id = $1", [programId]);
  if (!p) throw notFound("البرنامج غير موجود");
  await q("DELETE FROM uni_program_courses WHERE program_id = $1", [programId]);
  for (const c of b.courses) {
    await q("INSERT INTO uni_program_courses (tenant_id, program_id, course_id, kind, level) VALUES (app_tenant(), $1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [programId, c.course_id, c.kind, c.level ?? null]);
  }
  return { courses: b.courses.length };
}

export async function structure(q) {
  const [colleges, departments, programs, courses, plan] = [
    await q("SELECT * FROM uni_colleges ORDER BY code"),
    await q("SELECT * FROM uni_departments ORDER BY code"),
    await q(`SELECT p.*, (SELECT count(*)::int FROM uni_student_programs sp WHERE sp.program_id = p.id AND sp.status = 'active') AS students
               FROM uni_programs p ORDER BY p.code`),
    (await q("SELECT * FROM uni_courses ORDER BY code")).map((c) => ({ ...c, prerequisites: (c.prerequisites || []).map(Number) })),
    await q("SELECT * FROM uni_program_courses ORDER BY program_id, level NULLS LAST, course_id"),
  ];
  return { colleges, departments, programs, courses, plan, degrees: DEGREES };
}

/* ---------- terms and sections ---------- */
export const termSchema = z.object({ name: t.shortText("اسم الفصل", 80), starts_on: t.date, ends_on: t.date,
  status: z.enum(Object.keys(TERM_STATUS)).prefault("planned") });
export async function addTerm(q, b) {
  if (b.ends_on <= b.starts_on) throw badRequest("نهاية الفصل قبل بدايته");
  return insert(q, "uni_terms", ["name", "starts_on", "ends_on", "status"], [b.name, b.starts_on, b.ends_on, b.status], "فصل");
}
export async function setTermStatus(q, id, status) {
  const [row] = await q("UPDATE uni_terms SET status = $2 WHERE id = $1 RETURNING *", [id, status]);
  if (!row) throw notFound("الفصل غير موجود");
  return row;
}
export const terms = (q) => q(`SELECT tr.*, (SELECT count(*)::int FROM uni_sections s WHERE s.term_id = tr.id) AS sections
                                 FROM uni_terms tr ORDER BY tr.starts_on DESC`);

// Meeting times: days of the week (0 Sunday … 6 Saturday) and a start and end time. Registration refuses a section that
// overlaps one the student already has in the same term.
export const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const hhmm = z.union([z.literal(""), z.null(), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "الوقت بصيغة 08:30")]).optional().transform((v) => v || null);
const meeting = {
  days: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(), starts_at: hhmm, ends_at: hhmm,
};
const checkMeeting = (b) => {
  if (Boolean(b.starts_at) !== Boolean(b.ends_at)) throw badRequest("حدد وقت البداية والنهاية معًا");
  if (b.starts_at && b.starts_at >= b.ends_at) throw badRequest("وقت النهاية قبل البداية");
  if (b.starts_at && !b.days?.length) throw badRequest("حدد أيام المحاضرة");
};
const hm = (t) => (t ? String(t).slice(0, 5) : null);
export const meetingText = (s) => (s.days?.length && s.starts_at ? `${s.days.map((d) => DAYS[d]).join(" و")} ${hm(s.starts_at)}–${hm(s.ends_at)}` : null);
const overlaps = (a, b) => a.starts_at && b.starts_at && a.days.some((d) => b.days.includes(d)) && hm(a.starts_at) < hm(b.ends_at) && hm(b.starts_at) < hm(a.ends_at);

export const sectionSchema = z.object({ term_id: t.id, course_id: t.id, code: z.string().trim().min(1).max(10).prefault("1"), teacher_id: t.optId,
  capacity: z.coerce.number().int().min(1).max(1000).prefault(40), schedule: t.optText(200), room: t.optText(60), ...meeting });
export async function addSection(q, b) {
  checkMeeting(b);
  try {
    return await insert(q, "uni_sections", ["term_id", "course_id", "code", "teacher_id", "capacity", "schedule", "room", "days", "starts_at", "ends_at"],
      [b.term_id, b.course_id, b.code, b.teacher_id ?? null, b.capacity, b.schedule ?? null, b.room ?? null, b.days ?? [], b.starts_at ?? null, b.ends_at ?? null], "شعبة");
  } catch (e) { if (e.status === 409) throw conflict("هذه الشعبة مطروحة لهذا المقرر في هذا الفصل"); throw e; }
}
export async function updateSection(q, id, b) {
  const [cur] = await q("SELECT * FROM uni_sections WHERE id = $1", [id]);
  if (!cur) throw notFound("الشعبة غير موجودة");
  const v = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)) };
  checkMeeting(v);
  const [{ n }] = await q("SELECT count(*)::int AS n FROM uni_registrations WHERE section_id = $1 AND status = 'registered'", [id]);
  if (v.capacity < n) throw badRequest(`في الشعبة ${n} طالب مسجل، فلا تقل السعة عنهم`);
  return (await q("UPDATE uni_sections SET teacher_id = $2, capacity = $3, schedule = $4, room = $5, days = $6, starts_at = $7, ends_at = $8 WHERE id = $1 RETURNING *",
    [id, v.teacher_id, v.capacity, v.schedule, v.room, v.days ?? [], v.starts_at ?? null, v.ends_at ?? null]))[0];
}
export const sections = async (q, opts = {}) => (await sectionRows(q, opts)).map((s) => ({ ...s, starts_at: hm(s.starts_at), ends_at: hm(s.ends_at),
  meeting: meetingText(s) || s.schedule || null }));
const sectionRows = (q, { termId = null, teacherId = null, sectionId = null } = {}) => q(
  `SELECT s.*, c.code AS course_code, c.name AS course_name, c.credits, tc.full_name AS teacher, tr.name AS term, tr.status AS term_status,
          (SELECT count(*)::int FROM uni_registrations r WHERE r.section_id = s.id AND r.status = 'registered') AS registered
     FROM uni_sections s JOIN uni_courses c ON c.id = s.course_id JOIN uni_terms tr ON tr.id = s.term_id LEFT JOIN teachers tc ON tc.id = s.teacher_id
    WHERE ($1::bigint IS NULL OR s.term_id = $1) AND ($2::bigint IS NULL OR s.teacher_id = $2) AND ($3::bigint IS NULL OR s.id = $3)
    ORDER BY tr.starts_on DESC, c.code, s.code`, [termId, teacherId, sectionId]);

/* ---------- students ---------- */
export const admitSchema = z.object({
  student_id: t.optId,
  name: t.optText(120), student_no: t.optText(30), national_id: t.optText(30), student_phone: t.phone, email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")),
  guardian_name: t.optText(120), guardian_phone: t.phone,
  program_id: t.id, admitted_term_id: t.optId,
});
// Admission: a new student, or an existing one moved to another programme (the old one is kept as «transferred»).
export async function admit(q, tenant, b) {
  const [p] = await q("SELECT id FROM uni_programs WHERE id = $1 AND status = 'active'", [b.program_id]);
  if (!p) throw notFound("البرنامج غير موجود");
  let studentId = b.student_id;
  if (!studentId) {
    if (!b.name || b.name.length < 2) throw badRequest("اسم الطالب مطلوب");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM students WHERE archived_at IS NULL");
    if (n + 1 > tenant.max_students) throw badRequest(`تجاوزت حد الباقة (${tenant.max_students}). تواصل مع إدارة المنصة للترقية.`);
    let no = b.student_no;
    if (!no) { const [c] = await q("SELECT next_counter('uni_student_no') AS n"); no = `${new Date().getFullYear()}${String(c.n).padStart(5, "0")}`; }
    const [dup] = await q("SELECT 1 FROM students WHERE student_no = $1 AND archived_at IS NULL", [no]);
    if (dup) throw conflict("الرقم الجامعي مستخدم");
    const [s] = await q(`INSERT INTO students (tenant_id, full_name, student_no, national_id, student_phone, email, guardian_name, guardian_phone, access_key, enrolled_on)
                         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE) RETURNING id`,
      [b.name, no, b.national_id ?? null, b.student_phone ?? null, b.email || null, b.guardian_name ?? null, b.guardian_phone ?? null, newStudentKey()]);
    studentId = s.id;
  } else {
    const [s] = await q("SELECT id FROM students WHERE id = $1 AND archived_at IS NULL", [studentId]);
    if (!s) throw notFound("الطالب غير موجود");
    await q("UPDATE uni_student_programs SET status = 'transferred' WHERE student_id = $1 AND status = 'active'", [studentId]);
  }
  await q("INSERT INTO uni_student_programs (tenant_id, student_id, program_id, admitted_term_id) VALUES (app_tenant(), $1, $2, $3)",
    [studentId, b.program_id, b.admitted_term_id ?? null]);
  return { student_id: studentId };
}
export async function setStudentStatus(q, studentId, status) {
  const rows = await q("UPDATE uni_student_programs SET status = $2 WHERE student_id = $1 AND status IN ('active', 'suspended') RETURNING id", [studentId, status]);
  if (!rows.length) throw notFound("لا يوجد قيد فعّال لهذا الطالب");
}
export async function students(q, { programId = null, search = "" } = {}) {
  const rows = await q(
    `SELECT s.id, s.full_name AS name, s.student_no, s.access_key, sp.status, sp.program_id, p.name AS program, p.code AS program_code, p.total_credits
       FROM uni_student_programs sp JOIN students s ON s.id = sp.student_id JOIN uni_programs p ON p.id = sp.program_id
      WHERE sp.status <> 'transferred' AND ($1::bigint IS NULL OR sp.program_id = $1)
        AND ($2 = '' OR s.full_name ILIKE '%' || $2 || '%' OR s.student_no ILIKE '%' || $2 || '%')
      ORDER BY s.full_name LIMIT 1000`, [programId, search]);
  const settings = await getSettings(q);
  const all = rows.length ? await gradedRows(q, rows.map((r) => r.id)) : [];
  return rows.map((r) => {
    const sum = summary(all.filter((x) => x.student_id === r.id), settings);
    return { ...r, earned: sum.earned, cgpa: sum.cgpa, standing: sum.standing };
  });
}

/* ---------- registration ---------- */
const gradedRows = (q, ids) => q(
  `SELECT r.*, c.id AS course_id, c.code, c.name, c.credits, tr.id AS term_id, tr.name AS term, tr.starts_on, s.grades_submitted_at
     FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id JOIN uni_courses c ON c.id = s.course_id JOIN uni_terms tr ON tr.id = s.term_id
    WHERE r.student_id = ANY($1) AND r.status = 'registered' ORDER BY tr.starts_on, c.code`, [ids]);
const passed = (r) => r.points !== null && Number(r.points) > 0;

export const registerSchema = z.object({ student_id: t.id, section_id: t.id, override: z.boolean().prefault(false) });
// The university's rules: an open term, an active programme, prerequisites passed, a course not already passed or taken
// this term, a free seat and the credit limit. The registrar may override the seat and credit limits (never the rest).
export async function register(q, b, { actor, admin = false, self = false }) {
  const [sec] = await q(`SELECT s.*, c.credits, c.prerequisites, c.name AS course_name, c.id AS cid, tr.status AS term_status
                           FROM uni_sections s JOIN uni_courses c ON c.id = s.course_id JOIN uni_terms tr ON tr.id = s.term_id WHERE s.id = $1 FOR UPDATE OF s`, [b.section_id]);
  if (!sec) throw notFound("الشعبة غير موجودة");
  if (!["registration", "running"].includes(sec.term_status)) throw badRequest("التسجيل في هذا الفصل غير مفتوح");
  // A student registers by themselves only while registration is open, if the university allows it.
  if (self && (sec.term_status !== "registration" || !(await getSettings(q)).self_registration)) throw forbidden("التسجيل الذاتي غير متاح الآن. راجع القبول والتسجيل.");
  const [prog] = await q("SELECT id FROM uni_student_programs WHERE student_id = $1 AND status = 'active'", [b.student_id]);
  if (!prog) throw badRequest("الطالب غير مقيد في برنامج فعّال");
  const mine = await gradedRows(q, [b.student_id]);
  if (mine.some((r) => r.course_id === sec.cid && r.term_id === sec.term_id)) throw conflict("الطالب مسجل في هذا المقرر في هذا الفصل");
  if (mine.some((r) => r.course_id === sec.cid && passed(r))) throw badRequest("اجتاز الطالب هذا المقرر من قبل");
  // bigint[] comes back from the driver as strings.
  const missing = (sec.prerequisites || []).map(Number).filter((p) => !mine.some((r) => r.course_id === p && passed(r)));
  if (missing.length) {
    const names = await q("SELECT code, name FROM uni_courses WHERE id = ANY($1)", [missing]);
    throw badRequest(`متطلبات سابقة لم يجتزها الطالب: ${names.map((x) => `${x.code} ${x.name}`).join("، ")}`);
  }
  const override = admin && b.override;
  if (sec.starts_at) {
    const busy = await q(`SELECT s.days, s.starts_at, s.ends_at, c.code, c.name FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id
                            JOIN uni_courses c ON c.id = s.course_id WHERE r.student_id = $1 AND r.status = 'registered' AND s.term_id = $2 AND s.starts_at IS NOT NULL`,
      [b.student_id, sec.term_id]);
    const clash = busy.find((x) => overlaps(sec, x));
    if (clash && !override) throw badRequest(`يتعارض موعدها مع ${clash.code} ${clash.name} (${meetingText(clash)})`);
  }
  const [{ n }] = await q("SELECT count(*)::int AS n FROM uni_registrations WHERE section_id = $1 AND status = 'registered'", [b.section_id]);
  if (n >= sec.capacity && !override) throw badRequest(`الشعبة ممتلئة (${sec.capacity})`);
  const settings = await getSettings(q);
  const termCredits = mine.filter((r) => r.term_id === sec.term_id).reduce((s, r) => s + r.credits, 0);
  if (termCredits + sec.credits > settings.max_credits && !override) {
    throw badRequest(`يتجاوز الحد الأعلى للساعات في الفصل (${settings.max_credits}): مسجل ${termCredits} ساعة`);
  }
  const [old] = await q("SELECT id FROM uni_registrations WHERE student_id = $1 AND section_id = $2", [b.student_id, b.section_id]);
  if (old) {
    await q("UPDATE uni_registrations SET status = 'registered', created_by = $2, created_at = now() WHERE id = $1", [old.id, actor]);
    return { id: old.id, credits: termCredits + sec.credits };
  }
  const [row] = await q("INSERT INTO uni_registrations (tenant_id, student_id, section_id, created_by) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
    [b.student_id, b.section_id, actor]);
  return { id: row.id, credits: termCredits + sec.credits };
}
export async function drop(q, id, { withdraw = false } = {}) {
  const [r] = await q("SELECT r.*, tr.status AS term_status FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id JOIN uni_terms tr ON tr.id = s.term_id WHERE r.id = $1", [id]);
  if (!r || r.status !== "registered") throw notFound("التسجيل غير موجود");
  if (r.mark !== null) throw badRequest("رُصدت درجة هذا المقرر، فلا يُحذف");
  if (["grading", "closed"].includes(r.term_status)) throw badRequest("الفصل في رصد الدرجات أو مغلق");
  await q("UPDATE uni_registrations SET status = $2 WHERE id = $1", [id, withdraw ? "withdrawn" : "dropped"]);
}

/* ---------- grading ---------- */
export async function roster(q, sectionId, { teacherId = null } = {}) {
  const [sec] = await sections(q, { sectionId });
  if (!sec) throw notFound("الشعبة غير موجودة");
  if (teacherId && sec.teacher_id !== teacherId) throw forbidden("هذه الشعبة ليست من شعبك");
  const rows = await q(`SELECT r.id, r.student_id, s.full_name AS name, s.student_no, r.mark, r.letter, r.points, r.graded_at
                          FROM uni_registrations r JOIN students s ON s.id = r.student_id
                         WHERE r.section_id = $1 AND r.status = 'registered' ORDER BY s.full_name`, [sectionId]);
  return { section: sec, students: rows, scale: (await getSettings(q)).grade_scale };
}
export const marksSchema = z.object({ marks: z.array(z.object({ id: t.id, mark: z.union([z.null(), z.literal(""), z.coerce.number().min(0).max(100)]) })).max(1000),
  submit: z.boolean().prefault(false) });
// Marks become letters and points through the university's scale. Once the instructor submits, only the registrar edits.
export async function setMarks(q, sectionId, b, { teacherId = null, actor }) {
  const r = await roster(q, sectionId, { teacherId });
  if (teacherId && r.section.grades_submitted_at) throw forbidden("سُلّمت درجات هذه الشعبة. للتعديل تواصل مع القبول والتسجيل.");
  if (!["running", "grading", "closed"].includes(r.section.term_status)) throw badRequest("رصد الدرجات يبدأ بعد بدء الفصل");
  if (teacherId && r.section.term_status === "closed") throw forbidden("الفصل مغلق");
  const ids = new Set(r.students.map((s) => s.id));
  let saved = 0;
  for (const m of b.marks) {
    if (!ids.has(m.id)) throw badRequest("طالب غير مسجل في الشعبة");
    const mark = m.mark === "" ? null : m.mark;
    const g = mark === null ? { letter: null, points: null } : gradeOf(r.scale, mark);
    await q("UPDATE uni_registrations SET mark = $2, letter = $3, points = $4, graded_by = $5, graded_at = now() WHERE id = $1",
      [m.id, mark, g.letter, g.points, actor]);
    saved++;
  }
  if (b.submit) {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM uni_registrations WHERE section_id = $1 AND status = 'registered' AND mark IS NULL", [sectionId]);
    if (n) throw badRequest(`بقي ${n} طالب بلا درجة`);
    await q("UPDATE uni_sections SET grades_submitted_at = now() WHERE id = $1", [sectionId]);
  }
  return { saved, submitted: b.submit };
}
export async function reopenGrades(q, sectionId) {
  const rows = await q("UPDATE uni_sections SET grades_submitted_at = NULL WHERE id = $1 RETURNING id", [sectionId]);
  if (!rows.length) throw notFound("الشعبة غير موجودة");
}

/* ---------- GPA and the academic record ---------- */
// Term GPA counts every graded course of the term; the cumulative GPA counts only the latest attempt of a repeated course.
function summary(rows, settings) {
  const graded = rows.filter((r) => r.points !== null && r.credits > 0);
  const latest = new Map();
  for (const r of graded) latest.set(r.course_id, r);
  const counted = [...latest.values()];
  const credits = counted.reduce((s, r) => s + r.credits, 0);
  const cgpa = credits ? round2(counted.reduce((s, r) => s + Number(r.points) * r.credits, 0) / credits) : null;
  const earned = counted.filter(passed).reduce((s, r) => s + r.credits, 0);
  return { cgpa, earned, attempted: credits, standing: cgpa === null ? null : cgpa < settings.probation_below ? "probation" : "good" };
}
// `published` keeps only marks the instructor has submitted: what the student sees, and what official documents and
// the graduation check rest on. Marks still being entered count for nothing there.
export async function transcript(q, studentId, { published = false } = {}) {
  const [s] = await q(`SELECT s.id, s.full_name AS name, s.student_no, sp.status, p.id AS program_id, p.name AS program, p.code AS program_code,
                              p.degree, p.total_credits, d.name AS department, c.name AS college
                         FROM students s LEFT JOIN uni_student_programs sp ON sp.student_id = s.id AND sp.status <> 'transferred'
                         LEFT JOIN uni_programs p ON p.id = sp.program_id LEFT JOIN uni_departments d ON d.id = p.department_id
                         LEFT JOIN uni_colleges c ON c.id = d.college_id WHERE s.id = $1 ORDER BY sp.id DESC LIMIT 1`, [studentId]);
  if (!s) throw notFound("الطالب غير موجود");
  const settings = await getSettings(q);
  const rows = (await gradedRows(q, [studentId]))
    .map((r) => (published && !r.grades_submitted_at ? { ...r, mark: null, letter: null, points: null } : r));
  const termsOut = [];
  for (const r of rows) {
    let tr = termsOut.find((x) => x.term_id === r.term_id);
    if (!tr) termsOut.push(tr = { term_id: r.term_id, term: r.term, courses: [] });
    tr.courses.push({ registration_id: r.id, code: r.code, name: r.name, credits: r.credits, mark: r.mark === null ? null : Number(r.mark), letter: r.letter,
      points: r.points === null ? null : Number(r.points) });
  }
  const sofar = [];
  for (const tr of termsOut) {
    const g = tr.courses.filter((c) => c.points !== null && c.credits > 0);
    const cr = g.reduce((n, c) => n + c.credits, 0);
    tr.credits = tr.courses.reduce((n, c) => n + c.credits, 0);
    tr.gpa = cr ? round2(g.reduce((n, c) => n + c.points * c.credits, 0) / cr) : null;
    sofar.push(...rows.filter((r) => r.term_id === tr.term_id));
    tr.cgpa = summary(sofar, settings).cgpa;
  }
  const sum = summary(rows, settings);
  const plan = s.program_id ? await q(`SELECT c.id, c.code, c.name, c.credits, pc.kind, pc.level FROM uni_program_courses pc JOIN uni_courses c ON c.id = pc.course_id
                                         WHERE pc.program_id = $1 ORDER BY pc.level NULLS LAST, c.code`, [s.program_id]) : [];
  const done = new Set(rows.filter(passed).map((r) => r.course_id));
  return {
    student: s, degree_name: DEGREES[s.degree] || null, terms: termsOut, ...sum, max_points: settings.max_points,
    standing_name: sum.standing === "probation" ? "إنذار أكاديمي" : sum.standing === "good" ? "منتظم" : null,
    progress: s.total_credits ? Math.min(100, Math.round((sum.earned / s.total_credits) * 100)) : null,
    remaining: plan.filter((c) => c.kind === "required" && !done.has(c.id)).map(({ code, name, credits, level }) => ({ code, name, credits, level })),
  };
}

export async function dashboard(q) {
  const [c] = await q(`SELECT (SELECT count(*)::int FROM uni_student_programs WHERE status = 'active') AS students,
                              (SELECT count(*)::int FROM uni_programs WHERE status = 'active') AS programs,
                              (SELECT count(*)::int FROM uni_courses WHERE status = 'active') AS courses,
                              (SELECT count(*)::int FROM uni_colleges) AS colleges`);
  const [cur] = await q(`SELECT * FROM uni_terms WHERE status IN ('registration', 'running', 'grading')
                          ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'grading' THEN 1 ELSE 2 END, starts_on DESC LIMIT 1`);
  const secs = cur ? await sections(q, { termId: cur.id }) : [];
  return { counts: c, term: cur || null, sections: secs.length, registrations: secs.reduce((n, s) => n + s.registered, 0),
    full: secs.filter((s) => s.registered >= s.capacity).length, pending_grades: secs.filter((s) => !s.grades_submitted_at && s.registered).length };
}

/* ---------- graduation ---------- */
// Graduation is checked against the record: the programme's credits earned, every required course passed, and the
// minimum cumulative GPA. The registrar confirms; the final GPA and date are kept.
export async function graduationAudit(q, studentId) {
  const tr = await transcript(q, studentId, { published: true });
  const settings = await getSettings(q);
  const reasons = [];
  if (tr.student.status !== "active") reasons.push(`حالة القيد: ${STUDENT_STATUS[tr.student.status] || "بلا قيد"}`);
  if (tr.student.total_credits && tr.earned < tr.student.total_credits) reasons.push(`الساعات المكتسبة ${tr.earned} من ${tr.student.total_credits}`);
  if (tr.remaining.length) reasons.push(`مقررات إجبارية متبقية: ${tr.remaining.map((c) => c.code).join("، ")}`);
  if (tr.cgpa === null || tr.cgpa < settings.grad_min_cgpa) reasons.push(`المعدل التراكمي ${tr.cgpa ?? "—"} أقل من ${settings.grad_min_cgpa}`);
  const pending = tr.terms.flatMap((t) => t.courses).filter((c) => c.mark === null).length;
  if (pending) reasons.push(`${pending} مقرر لم تُسلَّم درجته`);
  return { eligible: !reasons.length, reasons, cgpa: tr.cgpa, earned: tr.earned };
}
export async function graduate(q, studentId) {
  const a = await graduationAudit(q, studentId);
  if (!a.eligible) throw badRequest(`لا تنطبق شروط التخرج: ${a.reasons.join("؛ ")}`);
  await q(`UPDATE uni_student_programs SET status = 'graduated', graduated_on = CURRENT_DATE, final_cgpa = $2 WHERE student_id = $1 AND status = 'active'`,
    [studentId, a.cgpa]);
  return a;
}

/* ---------- the official transcript ---------- */
// An official copy of the record with a verification code. A new copy replaces the previous one (which the
// verification page then shows as replaced).
export async function issueTranscript(q, studentId, { actor }) {
  const tr = await transcript(q, studentId, { published: true });
  if (!tr.terms.length) throw badRequest("لا يوجد سجل أكاديمي لإصداره");
  const [prev] = await q(`SELECT id FROM certificates WHERE student_id = $1 AND kind = 'custom' AND status = 'issued' AND data ->> 'uni' = 'transcript'
                           ORDER BY id DESC LIMIT 1`, [studentId]);
  const result = tr.cgpa === null ? "لم تُرصد درجات بعد" : `المعدل التراكمي ${tr.cgpa.toFixed(2)} من ${tr.max_points}، والساعات المكتسبة ${tr.earned}`;
  const data = { uni: "transcript", student: { name: tr.student.name, class_name: tr.student.program }, result, summary: { percent: null },
    body: `${result}${tr.student.status === "graduated" ? "، متخرج" : ""}.`, record: tr };
  return writeCertificate(q, { studentId, kind: "custom", title: "كشف درجات رسمي", data, actor, replaces: prev?.id ?? null,
    reason: prev ? "صدرت نسخة أحدث من الكشف" : null });
}

/* ---------- tuition by credit hour ---------- */
// One invoice per student for the credits registered in the term at the university's credit fee. Run again after
// adds and drops: only the difference is invoiced (a reduction is listed for the accountant, never applied silently).
export async function billTerm(q, termId, { actor }) {
  const settings = await getSettings(q);
  if (!settings.credit_fee) throw badRequest("حدد رسوم الساعة المعتمدة في اللائحة أولًا");
  const [term] = await q("SELECT * FROM uni_terms WHERE id = $1", [termId]);
  if (!term) throw notFound("الفصل غير موجود");
  const rows = await q(`SELECT r.student_id, sum(c.credits)::int AS credits,
                               COALESCE((SELECT sum(i.amount) FROM uni_term_invoices ti JOIN invoices i ON i.id = ti.invoice_id
                                          WHERE ti.student_id = r.student_id AND ti.term_id = $1 AND i.status = 'open'), 0)::numeric AS billed
                          FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id JOIN uni_courses c ON c.id = s.course_id
                         WHERE s.term_id = $1 AND r.status = 'registered' GROUP BY r.student_id`, [termId]);
  let created = 0, total = 0;
  const reductions = [];
  for (const r of rows) {
    const due = Math.round(r.credits * settings.credit_fee * 100) / 100 - Number(r.billed);
    if (due < 0) { reductions.push({ student_id: r.student_id, amount: -due }); continue; }
    if (due === 0) continue;
    const title = `${Number(r.billed) ? "فرق رسوم" : "رسوم"} ${term.name} (${r.credits} ساعة)`.slice(0, 120);
    const [inv] = await q(`INSERT INTO invoices (tenant_id, student_id, title, amount, due_date, created_by, term_id)
                           VALUES (app_tenant(), $1, $2, $3, $4, $5, NULL) RETURNING id`, [r.student_id, title, due, term.starts_on, actor]);
    await q("INSERT INTO uni_term_invoices (tenant_id, student_id, term_id, invoice_id, credits, amount) VALUES (app_tenant(), $1, $2, $3, $4, $5)",
      [r.student_id, termId, inv.id, r.credits, due]);
    created++; total += due;
  }
  return { created, total: Math.round(total * 100) / 100, reductions };
}

/* ---------- reports ---------- */
export async function termReport(q, termId) {
  const [term] = await q("SELECT * FROM uni_terms WHERE id = $1", [termId]);
  if (!term) throw notFound("الفصل غير موجود");
  const secs = await sections(q, { termId });
  const regs = await q(`SELECT r.*, s.course_id FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id WHERE s.term_id = $1 AND r.status = 'registered'`, [termId]);
  const courses = [...new Map(secs.map((s) => [s.course_id, s])).values()].map((s) => {
    const mine = regs.filter((r) => r.course_id === s.course_id);
    const graded = mine.filter((r) => r.mark !== null);
    const letters = {};
    for (const r of graded) letters[r.letter] = (letters[r.letter] || 0) + 1;
    return { code: s.course_code, name: s.course_name, sections: secs.filter((x) => x.course_id === s.course_id).length, registered: mine.length,
      graded: graded.length, average: graded.length ? round2(graded.reduce((n, r) => n + Number(r.mark), 0) / graded.length) : null,
      pass_rate: graded.length ? Math.round((graded.filter((r) => Number(r.points) > 0).length / graded.length) * 100) : null, letters };
  });
  const ids = [...new Set(regs.map((r) => r.student_id))];
  const settings = await getSettings(q);
  const all = ids.length ? await gradedRows(q, ids) : [];
  const people = ids.length ? await q("SELECT id, full_name AS name, student_no FROM students WHERE id = ANY($1)", [ids]) : [];
  const standing = people.map((p) => ({ ...p, ...summary(all.filter((r) => r.student_id === p.id), settings) }));
  return { term, courses, students: ids.length, credits: regs.length ? regs.reduce((n, r) => n + (secs.find((s) => s.id === r.section_id)?.credits || 0), 0) : 0,
    probation: standing.filter((s) => s.standing === "probation").map(({ id, name, student_no, cgpa }) => ({ id, name, student_no, cgpa })),
    top: standing.filter((s) => s.cgpa !== null).sort((a, b) => b.cgpa - a.cgpa).slice(0, 10).map(({ id, name, student_no, cgpa }) => ({ id, name, student_no, cgpa })) };
}

/* ---------- the student's own view ---------- */
// What a student (or parent) sees: the record, this term's timetable, and the sections open for self-registration.
export async function studentView(q, studentId) {
  const tr = await transcript(q, studentId, { published: true });
  const settings = await getSettings(q);
  const [open] = await q("SELECT * FROM uni_terms WHERE status = 'registration' ORDER BY starts_on DESC LIMIT 1");
  // The student's own current term: one running (or in grading) that they study in, else the one open for registration.
  const [cur] = await q(`SELECT tr.* FROM uni_terms tr WHERE tr.status IN ('registration', 'running', 'grading')
                          ORDER BY (tr.status <> 'registration' AND EXISTS (SELECT 1 FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id
                                     WHERE r.student_id = $1 AND r.status = 'registered' AND s.term_id = tr.id)) DESC,
                                   (tr.status = 'registration') DESC, tr.starts_on DESC LIMIT 1`, [studentId]);
  const mine = cur ? await q(`SELECT r.id AS registration_id, s.id AS section_id FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id
                                WHERE r.student_id = $1 AND r.status = 'registered' AND s.term_id = $2`, [studentId, cur.id]) : [];
  const curSecs = cur ? await sections(q, { termId: cur.id }) : [];
  const schedule = mine.map((m) => ({ ...curSecs.find((s) => s.id === m.section_id), registration_id: m.registration_id }))
    .map(({ id, course_code, course_name, credits, code, teacher, meeting, room, registration_id }) => ({ id, course_code, course_name, credits, code, teacher, meeting, room, registration_id }));
  const openSecs = open ? (open.id === cur?.id ? curSecs : await sections(q, { termId: open.id })) : [];
  // Sections already taken in the registration term, when it is not the term being studied now.
  const upcoming = open && open.id !== cur?.id ? await q(`SELECT r.id AS registration_id, s.id AS section_id FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id
                                                          WHERE r.student_id = $1 AND r.status = 'registered' AND s.term_id = $2`, [studentId, open.id]) : [];
  const taken = [...mine, ...upcoming];
  const offered = open && settings.self_registration && tr.student.status === "active"
    ? openSecs.filter((s) => !taken.some((m) => m.section_id === s.id))
      .map(({ id, course_code, course_name, credits, code, teacher, meeting, room, registered, capacity }) => ({ id, course_code, course_name, credits, code, teacher, meeting, room, full: registered >= capacity }))
    : [];
  return { transcript: tr, term: cur ? { id: cur.id, name: cur.name, status: cur.status } : null, schedule,
    registration: open && settings.self_registration ? { term: open.name, open: open.id === cur?.id, offered, max_credits: settings.max_credits,
      registered: upcoming.map((m) => ({ ...openSecs.find((x) => x.id === m.section_id), registration_id: m.registration_id }))
        .map(({ course_code, course_name, credits, code, meeting, registration_id }) => ({ course_code, course_name, credits, code, meeting, registration_id })) } : null };
}
export async function selfDrop(q, studentId, registrationId) {
  const [r] = await q(`SELECT r.id, tr.status FROM uni_registrations r JOIN uni_sections s ON s.id = r.section_id JOIN uni_terms tr ON tr.id = s.term_id
                        WHERE r.id = $1 AND r.student_id = $2 AND r.status = 'registered'`, [registrationId, studentId]);
  if (!r) throw notFound("التسجيل غير موجود");
  if (r.status !== "registration" || !(await getSettings(q)).self_registration) throw forbidden("الحذف متاح أثناء فترة التسجيل فقط");
  await drop(q, registrationId);
}

/* ---------- tuition collection ---------- */
// The term's tuition invoices with what was paid; payments are recorded through the platform's invoice payments.
export async function tuition(q, termId, search = "") {
  const rows = await q(
    `SELECT i.id AS invoice_id, i.title, i.amount, i.status, invoice_net_paid(i.id) AS paid, ti.credits, s.id AS student_id, s.full_name AS name, s.student_no
       FROM uni_term_invoices ti JOIN invoices i ON i.id = ti.invoice_id JOIN students s ON s.id = ti.student_id
      WHERE ti.term_id = $1 AND ($2 = '' OR s.full_name ILIKE '%' || $2 || '%' OR s.student_no ILIKE '%' || $2 || '%')
      ORDER BY s.full_name, i.id`, [termId, search]);
  const list = rows.map((r) => ({ ...r, amount: Number(r.amount), paid: Number(r.paid), remaining: r.status === "open" ? Math.max(0, Number(r.amount) - Number(r.paid)) : 0 }));
  const open = list.filter((r) => r.status === "open");
  return { invoices: list, totals: { amount: round2(open.reduce((n, r) => n + r.amount, 0)), paid: round2(open.reduce((n, r) => n + r.paid, 0)),
    remaining: round2(open.reduce((n, r) => n + r.remaining, 0)) } };
}

/* ---------- editing and removing the structure ---------- */
// Names and details can always change; codes stay (they appear on records). Removal only when nothing depends on it.
const KINDS_OF = {
  college: { table: "uni_colleges", label: "الكلية", fields: ["name", "dean"], uses: "SELECT 1 FROM uni_departments WHERE college_id = $1 LIMIT 1", why: "فيها أقسام" },
  department: { table: "uni_departments", label: "القسم", fields: ["name", "head"],
    uses: "SELECT 1 FROM uni_programs WHERE department_id = $1 UNION ALL SELECT 1 FROM uni_courses WHERE department_id = $1 LIMIT 1", why: "له برامج أو مقررات" },
  program: { table: "uni_programs", label: "البرنامج", fields: ["name", "degree", "total_credits", "years", "status"],
    uses: "SELECT 1 FROM uni_student_programs WHERE program_id = $1 LIMIT 1", why: "قُبل فيه طلاب (أرشفه بدل حذفه)" },
  course: { table: "uni_courses", label: "المقرر", fields: [],
    uses: "SELECT 1 FROM uni_sections WHERE course_id = $1 UNION ALL SELECT 1 FROM uni_courses WHERE $1 = ANY(prerequisites) LIMIT 1", why: "طُرحت له شعب أو هو متطلب لمقرر آخر (أرشفه بدل حذفه)" },
  term: { table: "uni_terms", label: "الفصل", fields: ["name", "starts_on", "ends_on"], uses: "SELECT 1 FROM uni_sections WHERE term_id = $1 LIMIT 1", why: "طُرحت فيه شعب" },
  section: { table: "uni_sections", label: "الشعبة", fields: [], uses: "SELECT 1 FROM uni_registrations WHERE section_id = $1 LIMIT 1", why: "سُجل فيها طلاب" },
};
export const editSchema = z.object({
  name: t.shortText("الاسم", 150).optional(), dean: t.optText(120), head: t.optText(120), degree: z.enum(Object.keys(DEGREES)).optional(),
  total_credits: z.coerce.number().int().min(1).max(400).optional(), years: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(10)]).optional().transform((v) => (v === "" ? null : v)),
  status: z.enum(["active", "archived"]).optional(), starts_on: t.date.optional(), ends_on: t.date.optional(),
});
export async function editItem(q, kind, id, b) {
  const k = KINDS_OF[kind];
  const keys = k.fields.filter((f) => b[f] !== undefined);
  if (!keys.length) return { ok: true };
  if (kind === "term") {
    const [cur] = await q("SELECT starts_on, ends_on FROM uni_terms WHERE id = $1", [id]);
    if (cur && (b.ends_on ?? String(cur.ends_on)) <= (b.starts_on ?? String(cur.starts_on))) throw badRequest("نهاية الفصل قبل بدايته");
  }
  try {
    const rows = await q(`UPDATE ${k.table} SET ${keys.map((f, i) => `${f} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING id`, [id, ...keys.map((f) => b[f])]);
    if (!rows.length) throw notFound(`${k.label} غير موجود`);
  } catch (e) { if (e.code === "23505") throw conflict("الاسم مستخدم"); throw e; }
  return { ok: true };
}
export async function removeItem(q, kind, id) {
  const k = KINDS_OF[kind];
  if ((await q(k.uses, [id])).length) throw badRequest(`لا يُحذف ${k.label} لأنه ${k.why}`);
  if (kind === "program") await q("DELETE FROM uni_program_courses WHERE program_id = $1", [id]);
  const rows = await q(`DELETE FROM ${k.table} WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) throw notFound(`${k.label} غير موجود`);
}
export const ITEM_KINDS = Object.keys(KINDS_OF);

/* ---------- programmes report ---------- */
export async function programsReport(q) {
  const settings = await getSettings(q);
  const progs = await q(`SELECT p.id, p.code, p.name, p.degree, p.total_credits, d.name AS department, c.name AS college
                           FROM uni_programs p JOIN uni_departments d ON d.id = p.department_id JOIN uni_colleges c ON c.id = d.college_id ORDER BY c.code, p.code`);
  const members = await q("SELECT student_id, program_id, status, final_cgpa FROM uni_student_programs WHERE status <> 'transferred'");
  const active = members.filter((m) => m.status === "active").map((m) => m.student_id);
  const rows = active.length ? await gradedRows(q, active) : [];
  return progs.map((p) => {
    const mine = members.filter((m) => m.program_id === p.id);
    const sums = mine.filter((m) => m.status === "active").map((m) => summary(rows.filter((r) => r.student_id === m.student_id), settings));
    const gpas = sums.map((x) => x.cgpa).filter((x) => x !== null);
    return { ...p, degree_name: DEGREES[p.degree], active: sums.length, graduated: mine.filter((m) => m.status === "graduated").length,
      withdrawn: mine.filter((m) => ["withdrawn", "suspended"].includes(m.status)).length,
      average_cgpa: gpas.length ? round2(gpas.reduce((a, b) => a + b, 0) / gpas.length) : null,
      probation: sums.filter((x) => x.standing === "probation").length,
      average_progress: sums.length && p.total_credits ? Math.round(sums.reduce((n, x) => n + Math.min(100, (x.earned / p.total_credits) * 100), 0) / sums.length) : null };
  });
}
