/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Training institutes: programs, courses, groups, enrollments, sessions, assessments and the trainee academic record.
// Trainees are rows of `students`, trainers rows of `teachers`; fees go through invoices/payments, certificates through `certificates`.
import { badRequest, notFound, conflict, forbidden } from "../../core/http/errors.js";
import { t, z } from "../../core/http/validate.js";
import { newStudentKey } from "../../core/auth/codes.js";
import { normalizePhone, cleanName } from "./students.service.js";
import { writeCertificate } from "./certificates.service.js";
import * as results from "./results.service.js";
import * as design from "./cert-design.service.js";
import { termsLayers, toInstitute } from "./org-types.service.js";

// ---------- Terms, settings and permissions ----------
export const DEFAULT_TERMS = {
  org: "المعهد", trainee: "متدرب", trainees: "المتدربون", course: "دورة", courses: "الدورات", program: "برنامج تدريبي", programs: "البرامج التدريبية",
  trainer: "مدرب", trainers: "المدربون", group: "مجموعة", groups: "المجموعات", session: "جلسة", sessions: "الجلسات",
};
export const TRAINEE_FIELDS = { national_id: "رقم الهوية أو الإقامة", student_phone: "رقم الجوال", email: "البريد الإلكتروني", birth_date: "تاريخ الميلاد",
  qualification: "المؤهل العلمي", prior_specialty: "التخصص السابق", gender: "الجنس" };
export const COURSE_STATUS = { planned: "مخطط لها", open: "مفتوحة للتسجيل", running: "جارية", completed: "مكتملة", canceled: "ملغاة" };
export const ENROLL_STATUS = { new: "مستجد", active: "مستمر", completed: "مكتمل", failed: "لم يجتز", withdrawn: "منسحب", deferred: "مؤجل", suspended: "موقوف" };
export const TRAINEE_STATUS = { active: "نشط", graduated: "أنهى التدريب", withdrawn: "منسحب", deferred: "مؤجل", suspended: "موقوف", transferred: "منتقل" };
export const MODES = { onsite: "حضوري", remote: "عن بُعد", blended: "مدمج" };
export const ASSESS_KIND = { theory: "اختبار نظري", practical: "تقييم عملي", assignment: "واجب", project: "مشروع", final: "التقييم النهائي", other: "أخرى" };
export const STAFF_ROLES = { director: "مدير المعهد", academic: "الشؤون الأكاديمية", registrar: "مسؤول التسجيل", reception: "موظف الاستقبال" };

// Capabilities per role. Trainers (teacher accounts) only ever reach their own courses through the trainer routes.
const CAN = {
  director: ["view", "trainees", "enroll", "catalog", "teach", "certificates", "approve", "finance", "reports", "settings"],
  academic: ["view", "trainees", "enroll", "catalog", "teach", "certificates", "reports"],
  registrar: ["view", "trainees", "enroll"],
  reception: ["view", "trainees"],
  accountant: ["view", "finance", "reports"],
};
export const capsOf = (user) => (user.role === "accountant" ? CAN.accountant : CAN[user.staff_role || "director"] || []);
export const can = (user, cap) => capsOf(user).includes(cap);
export const requireCap = (cap) => (req, res, next) => (can(req.user, cap) ? next()
  : next(forbidden("ليست لديك صلاحية لهذا الإجراء.")));

// The institute's words start from its type (a learning centre's «دارس», a Quran institute's «معهد»), and the institute's
// own settings change them further. Only the changes against that starting point are stored.
async function baseTerms(q) {
  const { base } = await termsLayers(q);
  return { ...DEFAULT_TERMS, ...Object.fromEntries(Object.entries(toInstitute(base)).filter(([k]) => k in DEFAULT_TERMS)) };
}
export async function getSettings(q) {
  const [s] = await q("SELECT * FROM institute_settings WHERE tenant_id = app_tenant()");
  const row = s || { terms: {}, required_fields: [], min_attendance: 75, pass_mark: 60, registration_fee: 0, late_counts_as: 1 };
  return { ...row, min_attendance: Number(row.min_attendance), pass_mark: Number(row.pass_mark), registration_fee: Number(row.registration_fee),
    late_counts_as: Number(row.late_counts_as), terms: { ...(await baseTerms(q)), ...row.terms } };
}
export const settingsSchema = z.object({
  terms: z.partialRecord(z.enum(Object.keys(DEFAULT_TERMS)), z.string().trim().min(2).max(40)).optional(),
  required_fields: z.array(z.enum(Object.keys(TRAINEE_FIELDS))).max(10).optional(),
  min_attendance: z.coerce.number().min(0).max(100).optional(),
  pass_mark: z.coerce.number().min(0).max(100).optional(),
  registration_fee: z.coerce.number().min(0).max(10_000_000).optional(),
  late_counts_as: z.coerce.number().min(0).max(1).optional(),
  signer_title: t.optText(60), signer_name: t.optText(80), certificate_note: t.optText(300),
});
export async function updateSettings(q, b) {
  const cur = await getSettings(q);
  const base = await baseTerms(q);
  const terms = b.terms ? Object.fromEntries(Object.entries({ ...cur.terms, ...b.terms }).filter(([k, v]) => base[k] !== v)) : undefined;
  const v = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)) };
  await q(`INSERT INTO institute_settings (tenant_id, terms, required_fields, min_attendance, pass_mark, registration_fee, late_counts_as, signer_title, signer_name, certificate_note)
           VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id) DO UPDATE SET terms = $1, required_fields = $2, min_attendance = $3, pass_mark = $4, registration_fee = $5,
             late_counts_as = $6, signer_title = $7, signer_name = $8, certificate_note = $9`,
  [JSON.stringify(terms ?? Object.fromEntries(Object.entries(cur.terms).filter(([k, x]) => base[k] !== x))),
    v.required_fields, v.min_attendance, v.pass_mark, v.registration_fee, v.late_counts_as, v.signer_title ?? null, v.signer_name ?? null, v.certificate_note ?? null]);
  return getSettings(q);
}

const log = (q, { enrollment = null, course = null, group = null, kind, from = null, to = null, reason = null }, actor) => q(
  `INSERT INTO training_log (tenant_id, enrollment_id, course_id, group_id, kind, from_value, to_value, reason, actor)
   VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)`,
  [enrollment, course, group, kind, from == null ? null : String(from).slice(0, 200), to == null ? null : String(to).slice(0, 200), reason, actor]);

// ---------- Programs ----------
const code = z.string().trim().regex(/^[A-Za-z0-9-]{2,20}$/, "الرمز: حروف إنجليزية وأرقام (2 إلى 20)");
export const programSchema = z.object({ code, name: t.shortText("اسم البرنامج", 150), department: t.optText(100), description: t.optText(2000),
  status: z.enum(["active", "archived"]).optional() });
export const listPrograms = (q) => q(
  `SELECT p.*, (SELECT count(*)::int FROM courses c WHERE c.program_id = p.id) AS courses,
          (SELECT COALESCE(sum(c.hours), 0) FROM courses c WHERE c.program_id = p.id AND c.status <> 'canceled') AS hours
     FROM programs p ORDER BY p.status, p.name`);
export async function saveProgram(q, id, b) {
  try {
    if (id) {
      const [r] = await q(`UPDATE programs SET code = $2, name = $3, department = $4, description = $5, status = COALESCE($6, status)
                            WHERE id = $1 RETURNING *`, [id, b.code.toUpperCase(), b.name, b.department, b.description, b.status ?? null]);
      if (!r) throw notFound("البرنامج غير موجود");
      return r;
    }
    const [r] = await q(`INSERT INTO programs (tenant_id, code, name, department, description) VALUES (app_tenant(), $1, $2, $3, $4) RETURNING *`,
      [b.code.toUpperCase(), b.name, b.department, b.description]);
    return r;
  } catch (e) { if (e.code === "23505") throw conflict("رمز البرنامج مستخدم"); throw e; }
}

// ---------- Courses and groups ----------
export const courseSchema = z.object({
  code, name: t.shortText("اسم الدورة", 150), program_id: t.optId, department: t.optText(100), description: t.optText(2000),
  objectives: t.optText(2000), prerequisites: t.optText(1000), trainer_id: t.optId,
  hours: z.coerce.number().positive("عدد الساعات مطلوب").max(5000), seats: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(5000)]).optional().transform((v) => (v ? Number(v) : null)),
  starts_on: t.optDate, ends_on: t.optDate, schedule: t.optText(300), fee: z.coerce.number().min(0).max(100_000_000).prefault(0),
  mode: z.enum(["onsite", "remote", "blended"]).prefault("onsite"), status: z.enum(Object.keys(COURSE_STATUS)).prefault("planned"),
  grading: z.enum(["score", "pass_fail"]).prefault("score"),
  pass_mark: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(100)]).optional().transform((v) => (v === "" || v == null ? null : Number(v))),
  min_attendance: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(100)]).optional().transform((v) => (v === "" || v == null ? null : Number(v))),
  reason: t.optText(300),
});
const COURSE_COLS = ["code", "name", "program_id", "department", "description", "objectives", "prerequisites", "trainer_id", "hours", "seats",
  "starts_on", "ends_on", "schedule", "fee", "mode", "status", "grading", "pass_mark", "min_attendance"];

export async function listCourses(q, { status = null, program_id = null, trainer_id = null, q: term = null } = {}) {
  return q(
    `SELECT c.*, p.name AS program, tr.full_name AS trainer,
            (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.status NOT IN ('withdrawn')) AS enrolled,
            (SELECT count(*)::int FROM course_groups g WHERE g.course_id = c.id) AS groups,
            (SELECT COALESCE(sum(s.hours), 0) FROM training_sessions s WHERE s.course_id = c.id AND s.status = 'held') AS held_hours
       FROM courses c LEFT JOIN programs p ON p.id = c.program_id LEFT JOIN teachers tr ON tr.id = c.trainer_id
      WHERE ($1::text IS NULL OR c.status = $1) AND ($2::bigint IS NULL OR c.program_id = $2)
        AND ($3::bigint IS NULL OR c.trainer_id = $3 OR EXISTS (SELECT 1 FROM course_groups g WHERE g.course_id = c.id AND g.trainer_id = $3))
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.code ILIKE '%' || $4 || '%')
      ORDER BY CASE c.status WHEN 'running' THEN 0 WHEN 'open' THEN 1 WHEN 'planned' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
               c.starts_on NULLS LAST, c.name`, [status, program_id, trainer_id, term]);
}

export async function saveCourse(q, id, b, actor) {
  if (b.ends_on && b.starts_on && b.ends_on < b.starts_on) throw badRequest("تاريخ النهاية قبل تاريخ البداية");
  const vals = COURSE_COLS.map((k) => (k === "code" ? b.code.toUpperCase() : b[k] ?? null));
  try {
    if (id) {
      const [cur] = await q("SELECT c.*, t.full_name AS trainer FROM courses c LEFT JOIN teachers t ON t.id = c.trainer_id WHERE c.id = $1 FOR UPDATE OF c", [id]);
      if (!cur) throw notFound("الدورة غير موجودة");
      if (b.seats && b.seats < (await seatsUsed(q, id))) throw badRequest("عدد المقاعد أقل من عدد المسجلين حاليًا");
      const [r] = await q(`UPDATE courses SET ${COURSE_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [id, ...vals]);
      if (Number(cur.trainer_id || 0) !== Number(b.trainer_id || 0)) {
        const [n] = b.trainer_id ? await q("SELECT full_name FROM teachers WHERE id = $1", [b.trainer_id]) : [];
        await log(q, { course: id, kind: "trainer", from: cur.trainer || "—", to: n?.full_name || "—", reason: b.reason }, actor);
      }
      if (cur.status !== b.status) await log(q, { course: id, kind: "status", from: COURSE_STATUS[cur.status], to: COURSE_STATUS[b.status], reason: b.reason }, actor);
      if (Number(cur.fee) !== Number(b.fee)) await log(q, { course: id, kind: "fee", from: cur.fee, to: b.fee, reason: "تعديل رسوم الدورة؛ رسوم المسجلين سابقًا لم تتغير" }, actor);
      return r;
    }
    const [r] = await q(`INSERT INTO courses (tenant_id, ${COURSE_COLS.join(", ")}) VALUES (app_tenant(), ${COURSE_COLS.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, vals);
    return r;
  } catch (e) {
    if (e.code === "23505") throw conflict("رمز الدورة مستخدم");
    if (e.code === "23503") throw badRequest("البرنامج أو المدرب غير موجود");
    throw e;
  }
}

async function seatsUsed(q, courseId, groupId = null) {
  const [r] = await q(`SELECT count(*)::int AS n FROM enrollments WHERE course_id = $1 AND ($2::bigint IS NULL OR group_id = $2)
                         AND status NOT IN ('withdrawn', 'deferred')`, [courseId, groupId]);
  return r.n;
}

export const groupSchema = z.object({ name: t.shortText("اسم المجموعة", 60), trainer_id: t.optId,
  seats: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(5000)]).optional().transform((v) => (v ? Number(v) : null)),
  schedule: t.optText(300), reason: t.optText(300) });
export async function saveGroup(q, courseId, id, b, actor) {
  try {
    if (id) {
      const [cur] = await q("SELECT g.*, t.full_name AS trainer FROM course_groups g LEFT JOIN teachers t ON t.id = g.trainer_id WHERE g.id = $1 AND g.course_id = $2", [id, courseId]);
      if (!cur) throw notFound("المجموعة غير موجودة");
      if (b.seats && b.seats < (await seatsUsed(q, courseId, id))) throw badRequest("عدد المقاعد أقل من عدد المسجلين في المجموعة");
      const [r] = await q("UPDATE course_groups SET name = $2, trainer_id = $3, seats = $4, schedule = $5 WHERE id = $1 RETURNING *", [id, b.name, b.trainer_id ?? null, b.seats, b.schedule]);
      if (Number(cur.trainer_id || 0) !== Number(b.trainer_id || 0)) {
        const [n] = b.trainer_id ? await q("SELECT full_name FROM teachers WHERE id = $1", [b.trainer_id]) : [];
        await log(q, { course: courseId, group: id, kind: "trainer", from: cur.trainer || "—", to: n?.full_name || "—", reason: b.reason }, actor);
      }
      return r;
    }
    const [r] = await q("INSERT INTO course_groups (tenant_id, course_id, name, trainer_id, seats, schedule) VALUES (app_tenant(), $1, $2, $3, $4, $5) RETURNING *",
      [courseId, b.name, b.trainer_id ?? null, b.seats, b.schedule]);
    return r;
  } catch (e) { if (e.code === "23505") throw conflict("اسم المجموعة مستخدم في هذه الدورة"); if (e.code === "23503") throw badRequest("الدورة أو المدرب غير موجود"); throw e; }
}
export async function deleteGroup(q, courseId, id) {
  const [used] = await q("SELECT (SELECT count(*) FROM enrollments WHERE group_id = $1)::int + (SELECT count(*) FROM training_sessions WHERE group_id = $1)::int AS n", [id]);
  if (used.n) throw badRequest("لا يمكن حذف مجموعة فيها متدربون أو جلسات. انقلهم أولًا.");
  const rows = await q("DELETE FROM course_groups WHERE id = $1 AND course_id = $2 RETURNING id", [id, courseId]);
  if (!rows.length) throw notFound("المجموعة غير موجودة");
}

export async function getCourse(q, id) {
  const [c] = (await q(`SELECT c.*, p.name AS program, tr.full_name AS trainer FROM courses c LEFT JOIN programs p ON p.id = c.program_id
                          LEFT JOIN teachers tr ON tr.id = c.trainer_id WHERE c.id = $1`, [id]));
  if (!c) throw notFound("الدورة غير موجودة");
  const settings = await getSettings(q);
  const groups = await q(`SELECT g.*, t.full_name AS trainer,
      (SELECT count(*)::int FROM enrollments e WHERE e.group_id = g.id AND e.status NOT IN ('withdrawn', 'deferred')) AS enrolled
      FROM course_groups g LEFT JOIN teachers t ON t.id = g.trainer_id WHERE g.course_id = $1 ORDER BY g.name`, [id]);
  const sessions = await q(`SELECT s.*, g.name AS group_name, t.full_name AS trainer,
      (SELECT count(*)::int FROM session_attendance a WHERE a.session_id = s.id) AS recorded
      FROM training_sessions s LEFT JOIN course_groups g ON g.id = s.group_id LEFT JOIN teachers t ON t.id = s.trainer_id
     WHERE s.course_id = $1 ORDER BY s.day, s.starts_at NULLS FIRST, s.id`, [id]);
  const assessments = await q("SELECT * FROM assessments WHERE course_id = $1 ORDER BY sort, id", [id]);
  const enrollments = await courseRoster(q, id);
  const history = await q("SELECT * FROM training_log WHERE course_id = $1 AND enrollment_id IS NULL ORDER BY id DESC LIMIT 100", [id]);
  return { course: { ...c, effective_pass_mark: Number(c.pass_mark ?? settings.pass_mark), effective_min_attendance: Number(c.min_attendance ?? settings.min_attendance) },
    groups, sessions, assessments, enrollments, history, seats_used: await seatsUsed(q, id) };
}

// ---------- Trainees ----------
export const traineeSchema = z.object({
  name: t.name("اسم المتدرب"), student_no: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  national_id: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  student_phone: t.phone, email: z.union([z.string().trim().email("البريد الإلكتروني غير صحيح").max(120), z.literal(""), z.null()]).optional().transform((v) => v || null),
  birth_date: t.optDate, gender: z.union([z.enum(["male", "female"]), z.literal(""), z.null()]).optional().transform((v) => v || null),
  qualification: t.optText(120), prior_specialty: t.optText(120), area: t.optText(80),
  guardian_name: t.optText(120), guardian_phone: t.phone, enrolled_on: t.optDate,
});
const traineeVals = (b) => [cleanName(b.name), b.student_no, b.national_id, normalizePhone(b.student_phone), b.email, b.birth_date ?? null, b.gender ?? null,
  b.qualification, b.prior_specialty, cleanName(b.area) || null, cleanName(b.guardian_name) || null, normalizePhone(b.guardian_phone)];

async function checkRequired(q, b) {
  const { required_fields: req } = await getSettings(q);
  const missing = req.filter((f) => !b[f]);
  if (missing.length) throw badRequest(`حقول مطلوبة في الإعدادات: ${missing.map((f) => TRAINEE_FIELDS[f]).join("، ")}`);
}
const dupGuard = (e) => {
  if (e.code === "23505" && /national/.test(e.constraint || "")) throw conflict("رقم الهوية مسجل لمتدرب آخر");
  if (e.code === "23505" && /student_no/.test(e.constraint || "")) throw conflict("الرقم التعريفي مستخدم لمتدرب آخر");
  throw e;
};

export async function createTrainee(q, tenant, b) {
  await checkRequired(q, b);
  await q("SELECT id FROM tenants WHERE id = app_tenant() FOR UPDATE");
  const [n] = await q("SELECT count(*)::int AS n FROM students WHERE archived_at IS NULL");
  if (n.n + 1 > tenant.max_students) throw badRequest(`تجاوزت حد الباقة (${tenant.max_students}). تواصل مع إدارة المنصة للترقية.`);
  if (b.student_no) {
    const [dup] = await q("SELECT 1 FROM students WHERE student_no = $1 AND archived_at IS NULL", [b.student_no]);
    if (dup) throw conflict("الرقم التعريفي مستخدم لمتدرب آخر");
  }
  let no = b.student_no;
  if (!no) { const [c] = await q("SELECT next_counter('trainee_no') AS n"); no = `T${String(c.n).padStart(5, "0")}`; }
  for (let i = 0; i < 5; i++) {
    try {
      const rows = await q(
        `INSERT INTO students (tenant_id, full_name, student_no, national_id, student_phone, email, birth_date, gender, qualification, prior_specialty,
                               area, guardian_name, guardian_phone, access_key, enrolled_on)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14::date, CURRENT_DATE))
         ON CONFLICT (tenant_id, access_key) DO NOTHING RETURNING *`,
        [...traineeVals({ ...b, student_no: no }), newStudentKey(), b.enrolled_on ?? null]);
      if (rows.length) return publicTrainee(rows[0]);
    } catch (e) { dupGuard(e); }
  }
  throw conflict("تعذر إنشاء معرّف فريد، أعد المحاولة");
}
export async function updateTrainee(q, id, b) {
  await checkRequired(q, b);
  try {
    const [r] = await q(
      `UPDATE students SET full_name = $2, student_no = COALESCE($3, student_no), national_id = $4, student_phone = $5, email = $6, birth_date = $7, gender = $8,
              qualification = $9, prior_specialty = $10, area = $11, guardian_name = $12, guardian_phone = $13, enrolled_on = COALESCE($14::date, enrolled_on)
        WHERE id = $1 AND archived_at IS NULL RETURNING *`, [id, ...traineeVals(b), b.enrolled_on ?? null]);
    if (!r) throw notFound("المتدرب غير موجود");
    return publicTrainee(r);
  } catch (e) { return dupGuard(e); }
}
const publicTrainee = ({ photo, ...s }) => ({ ...s, has_photo: Boolean(photo) });
export const statusSchema = z.object({ status: z.enum(Object.keys(TRAINEE_STATUS)), reason: t.optText(300) });
export async function setTraineeStatus(q, id, b) {
  if (["withdrawn", "deferred", "suspended"].includes(b.status) && !b.reason) throw badRequest("اكتب سبب تغيير الحالة");
  const rows = await q("UPDATE students SET status = $2, status_note = $3, status_changed_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id", [id, b.status, b.reason]);
  if (!rows.length) throw notFound("المتدرب غير موجود");
}

export async function listTrainees(q, { q: term = null, status = null, course_id = null, limit = 500 } = {}) {
  return q(
    `SELECT s.id, s.full_name, s.student_no, s.national_id, s.student_phone, s.email, s.status, s.enrolled_on, s.created_at,
            (SELECT count(*)::int FROM enrollments e WHERE e.student_id = s.id AND e.status NOT IN ('withdrawn')) AS courses,
            (SELECT count(*)::int FROM enrollments e WHERE e.student_id = s.id AND e.status = 'completed') AS completed,
            (SELECT string_agg(c.name, '، ' ORDER BY e.enrolled_on DESC) FROM enrollments e JOIN courses c ON c.id = e.course_id
              WHERE e.student_id = s.id AND e.status IN ('new', 'active')) AS current_courses
       FROM students s
      WHERE s.archived_at IS NULL AND ($1::text IS NULL OR s.full_name ILIKE '%' || $1 || '%' OR s.student_no ILIKE '%' || $1 || '%'
            OR s.national_id ILIKE '%' || $1 || '%' OR s.student_phone LIKE '%' || $1 || '%' OR s.email ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.status = $2)
        AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.course_id = $3 AND e.status <> 'withdrawn'))
      ORDER BY s.created_at DESC, s.id DESC LIMIT $4`, [term, status, course_id, limit]);
}

// ---------- Enrollments ----------
export const enrollSchema = z.object({ student_id: t.id, course_id: t.id, group_id: t.optId,
  discount: z.coerce.number().min(0).max(100_000_000).prefault(0), note: t.optText(300), invoice: z.boolean().prefault(true) });

export async function enroll(q, b, actor, { canDiscount = false } = {}) {
  const [c] = await q("SELECT * FROM courses WHERE id = $1 FOR UPDATE", [b.course_id]);
  if (!c) throw notFound("الدورة غير موجودة");
  if (["completed", "canceled"].includes(c.status)) throw badRequest(`لا يمكن التسجيل في دورة ${COURSE_STATUS[c.status]}`);
  const [s] = await q("SELECT id, full_name, status FROM students WHERE id = $1 AND archived_at IS NULL", [b.student_id]);
  if (!s) throw notFound("المتدرب غير موجود");
  if (["suspended", "withdrawn"].includes(s.status)) throw badRequest("حالة المتدرب لا تسمح بالتسجيل");
  const [dup] = await q("SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2 AND status <> 'withdrawn'", [s.id, c.id]);
  if (dup) throw conflict("المتدرب مسجل في هذه الدورة مسبقًا");
  if (b.discount && !canDiscount) throw forbidden("الخصم يحتاج صلاحية مالية");
  if (b.discount > Number(c.fee)) throw badRequest("الخصم أكبر من رسوم الدورة");
  if (c.seats && (await seatsUsed(q, c.id)) >= c.seats) throw badRequest("اكتملت مقاعد الدورة");
  let group = null;
  if (b.group_id) {
    [group] = await q("SELECT * FROM course_groups WHERE id = $1 AND course_id = $2", [b.group_id, c.id]);
    if (!group) throw badRequest("المجموعة ليست من هذه الدورة");
    if (group.seats && (await seatsUsed(q, c.id, group.id)) >= group.seats) throw badRequest("اكتملت مقاعد المجموعة");
  }
  let e;
  try {
    [e] = await q(`INSERT INTO enrollments (tenant_id, student_id, course_id, group_id, status, fee, discount, created_by, status_reason)
                   VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [s.id, c.id, group?.id ?? null, c.status === "running" ? "active" : "new", c.fee, b.discount, actor, b.note]);
  } catch (err) { if (err.code === "23505") throw conflict("المتدرب مسجل في هذه الدورة مسبقًا"); throw err; }
  await log(q, { enrollment: e.id, course: c.id, group: group?.id, kind: "enrolled", to: group ? `${c.name} — ${group.name}` : c.name, reason: b.note }, actor);
  const due = Number(c.fee) - Number(b.discount);
  if (b.invoice) {
    const settings = await getSettings(q);
    if (settings.registration_fee > 0) {
      const [had] = await q("SELECT 1 FROM invoices WHERE student_id = $1 AND title = 'رسوم التسجيل' AND status = 'open'", [s.id]);
      if (!had) await q(`INSERT INTO invoices (tenant_id, student_id, title, amount, created_by) VALUES (app_tenant(), $1, 'رسوم التسجيل', $2, $3)`, [s.id, settings.registration_fee, actor]);
    }
    if (due > 0) {
      const [inv] = await q(`INSERT INTO invoices (tenant_id, student_id, title, amount, created_by, enrollment_id)
                             VALUES (app_tenant(), $1, $2, $3, $4, $5) RETURNING id`, [s.id, `رسوم ${c.name}`.slice(0, 120), due, actor, e.id]);
      await q("UPDATE enrollments SET invoice_id = $2 WHERE id = $1", [e.id, inv.id]);
      e.invoice_id = inv.id;
    }
    if (due > 0 || settings.registration_fee > 0) await q("UPDATE students SET fees_enabled = true WHERE id = $1 AND NOT fees_enabled", [s.id]);
  }
  return e;
}

export const transferSchema = z.object({ group_id: t.optId, reason: t.shortText("سبب النقل", 300) });
export async function transfer(q, id, b, actor) {
  const [e] = await q(`SELECT e.*, g.name AS group_name FROM enrollments e LEFT JOIN course_groups g ON g.id = e.group_id WHERE e.id = $1 FOR UPDATE OF e`, [id]);
  if (!e) throw notFound("التسجيل غير موجود");
  if (["withdrawn", "completed", "failed"].includes(e.status)) throw badRequest("لا يمكن نقل تسجيل منتهٍ");
  let g = null;
  if (b.group_id) {
    [g] = await q("SELECT * FROM course_groups WHERE id = $1 AND course_id = $2", [b.group_id, e.course_id]);
    if (!g) throw badRequest("المجموعة ليست من نفس الدورة");
    if (g.seats && (await seatsUsed(q, e.course_id, g.id)) >= g.seats) throw badRequest("اكتملت مقاعد المجموعة");
  }
  if (Number(e.group_id || 0) === Number(g?.id || 0)) throw badRequest("المتدرب في هذه المجموعة أصلًا");
  await q("UPDATE enrollments SET group_id = $2 WHERE id = $1", [id, g?.id ?? null]);
  await log(q, { enrollment: id, course: e.course_id, group: g?.id, kind: "transfer", from: e.group_name || "بدون مجموعة", to: g?.name || "بدون مجموعة", reason: b.reason }, actor);
}

export const enrollStatusSchema = z.object({ status: z.enum(["new", "active", "withdrawn", "deferred", "suspended"]), reason: t.optText(300) });
export async function setEnrollmentStatus(q, id, b, actor) {
  if (["withdrawn", "deferred", "suspended"].includes(b.status) && !b.reason) throw badRequest("اكتب السبب");
  const [e] = await q("SELECT * FROM enrollments WHERE id = $1 FOR UPDATE", [id]);
  if (!e) throw notFound("التسجيل غير موجود");
  if (e.status === b.status) return;
  if (["completed", "failed"].includes(e.status) && b.status !== "active") throw badRequest("التسجيل منتهٍ. أعد فتحه أولًا.");
  if (["withdrawn", "deferred"].includes(e.status) && ["new", "active"].includes(b.status)) {
    const [c] = await q("SELECT seats FROM courses WHERE id = $1", [e.course_id]);
    if (c.seats && (await seatsUsed(q, e.course_id)) >= c.seats) throw badRequest("اكتملت مقاعد الدورة");
  }
  try {
    await q(`UPDATE enrollments SET status = $2, status_reason = $3, status_changed_at = now(),
                    completed_on = CASE WHEN $2 IN ('new', 'active') THEN NULL ELSE completed_on END,
                    result = CASE WHEN $2 IN ('new', 'active') THEN NULL ELSE result END WHERE id = $1`, [id, b.status, b.reason]);
  } catch (err) { if (err.code === "23505") throw conflict("للمتدرب تسجيل آخر مفتوح في نفس الدورة"); throw err; }
  await log(q, { enrollment: id, course: e.course_id, kind: "status", from: ENROLL_STATUS[e.status], to: ENROLL_STATUS[b.status], reason: b.reason }, actor);
}

export async function courseRoster(q, courseId, { trainerId = null } = {}) {
  const rows = await q(
    `SELECT e.*, s.full_name, s.student_no, s.student_phone, g.name AS group_name
       FROM enrollments e JOIN students s ON s.id = e.student_id LEFT JOIN course_groups g ON g.id = e.group_id
      WHERE e.course_id = $1 AND ($2::bigint IS NULL OR g.trainer_id = $2 OR (e.group_id IS NULL OR g.trainer_id IS NULL)
             AND EXISTS (SELECT 1 FROM courses c WHERE c.id = e.course_id AND c.trainer_id = $2))
      ORDER BY (e.status IN ('withdrawn', 'deferred')), g.name NULLS FIRST, s.full_name`, [courseId, trainerId]);
  const prog = await progressMany(q, rows);
  return rows.map((r) => ({ ...r, progress: prog.get(Number(r.id)) }));
}

// ---------- Sessions and attendance ----------
export const sessionSchema = z.object({
  group_id: t.optId, trainer_id: t.optId, day: t.date, starts_at: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal(""), z.null()]).optional().transform((v) => v || null),
  hours: z.coerce.number().positive("مدة الجلسة مطلوبة").max(24), mode: z.enum(["onsite", "remote"]).prefault("onsite"), topic: t.optText(200),
  repeat_weeks: z.coerce.number().int().min(1).max(52).prefault(1), weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
});
export async function addSessions(q, courseId, b) {
  const [c] = await q("SELECT id, trainer_id, mode, status FROM courses WHERE id = $1", [courseId]);
  if (!c) throw notFound("الدورة غير موجودة");
  if (c.status === "canceled") throw badRequest("الدورة ملغاة");
  let trainer = b.trainer_id ?? c.trainer_id;
  if (b.group_id) {
    const [g] = await q("SELECT trainer_id FROM course_groups WHERE id = $1 AND course_id = $2", [b.group_id, courseId]);
    if (!g) throw badRequest("المجموعة ليست من هذه الدورة");
    trainer = b.trainer_id ?? g.trainer_id ?? c.trainer_id;
  }
  const start = new Date(`${b.day}T00:00:00Z`);
  const days = [];
  const weekdays = b.weekdays?.length ? b.weekdays : [start.getUTCDay()];
  for (let w = 0; w < b.repeat_weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * 864e5);
      if (weekdays.includes(day.getUTCDay())) days.push(day.toISOString().slice(0, 10));
    }
  }
  if (days.length > 200) throw badRequest("عدد الجلسات كبير. قلّل الأسابيع أو الأيام.");
  const out = [];
  for (const day of days) {
    const [s] = await q(`INSERT INTO training_sessions (tenant_id, course_id, group_id, trainer_id, day, starts_at, hours, mode, topic)
                         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [courseId, b.group_id ?? null, trainer ?? null, day, b.starts_at, b.hours, b.mode, b.topic]);
    out.push(s);
  }
  return out;
}
export const sessionStatusSchema = z.object({ status: z.enum(["planned", "held", "canceled", "rescheduled"]), rescheduled_to: t.optDate,
  note: t.optText(300), topic: t.optText(200), hours: z.coerce.number().positive().max(24).optional() });
export async function updateSession(q, id, b, { trainerId = null } = {}) {
  const s = await sessionFor(q, id, trainerId);
  if (b.status === "rescheduled" && !b.rescheduled_to) throw badRequest("حدد التاريخ الجديد");
  await q(`UPDATE training_sessions SET status = $2, rescheduled_to = $3, note = COALESCE($4, note), topic = COALESCE($5, topic), hours = COALESCE($6, hours) WHERE id = $1`,
    [id, b.status, b.status === "rescheduled" ? b.rescheduled_to : null, b.note, b.topic, b.hours ?? null]);
  if (b.status === "rescheduled") {
    await q(`INSERT INTO training_sessions (tenant_id, course_id, group_id, trainer_id, day, starts_at, hours, mode, topic, note)
             VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [s.course_id, s.group_id, s.trainer_id, b.rescheduled_to, s.starts_at, b.hours ?? s.hours, s.mode, b.topic ?? s.topic, `معادة من ${String(s.day).slice(0, 10)}`]);
  }
  if (["canceled", "rescheduled"].includes(b.status)) await q("DELETE FROM session_attendance WHERE session_id = $1", [id]);
}
export async function deleteSession(q, id) {
  const [n] = await q("SELECT count(*)::int AS n FROM session_attendance WHERE session_id = $1", [id]);
  if (n.n) throw badRequest("سُجل الحضور لهذه الجلسة. ألغها بدل حذفها.");
  const rows = await q("DELETE FROM training_sessions WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("الجلسة غير موجودة");
}

// A trainer reaches a session only when it belongs to them, to their group, or to their course without another group trainer.
async function sessionFor(q, id, trainerId) {
  const [s] = await q(`SELECT s.*, c.trainer_id AS course_trainer, g.trainer_id AS group_trainer, c.name AS course_name, c.status AS course_status
                         FROM training_sessions s JOIN courses c ON c.id = s.course_id LEFT JOIN course_groups g ON g.id = s.group_id WHERE s.id = $1`, [id]);
  if (!s) throw notFound("الجلسة غير موجودة");
  if (trainerId && ![s.trainer_id, s.group_trainer, s.group_id ? null : s.course_trainer].map(Number).includes(Number(trainerId))) {
    throw forbidden("هذه الجلسة ليست من دوراتك");
  }
  return s;
}

export async function sessionRoster(q, id, { trainerId = null } = {}) {
  const s = await sessionFor(q, id, trainerId);
  const rows = await q(
    `SELECT e.id AS enrollment_id, st.full_name, st.student_no, e.status AS enrollment_status, a.status, a.late_minutes, a.note
       FROM enrollments e JOIN students st ON st.id = e.student_id
       LEFT JOIN session_attendance a ON a.session_id = $1 AND a.enrollment_id = e.id
      WHERE e.course_id = $2 AND ($3::bigint IS NULL OR e.group_id = $3) AND e.status IN ('new', 'active', 'completed', 'failed')
      ORDER BY st.full_name`, [id, s.course_id, s.group_id]);
  return { session: s, roster: rows };
}
export const attendanceSchema = z.object({ records: z.array(z.object({ enrollment_id: t.id, status: z.enum(["present", "absent", "late", "excused"]),
  late_minutes: z.coerce.number().int().min(0).max(600).optional().nullable(), note: t.optText(200) })).min(1).max(500) });
export async function saveAttendance(q, id, b, actor, { trainerId = null } = {}) {
  const s = await sessionFor(q, id, trainerId);
  if (["canceled", "rescheduled"].includes(s.status)) throw badRequest("لا يُسجل الحضور لجلسة ملغاة أو معادة الجدولة");
  if (s.day > new Date(Date.now() + 864e5)) throw badRequest("لا يُسجل الحضور لجلسة لم يأتِ موعدها");
  const ids = new Set((await q(`SELECT id FROM enrollments WHERE course_id = $1 AND ($2::bigint IS NULL OR group_id = $2)`, [s.course_id, s.group_id])).map((r) => Number(r.id)));
  for (const r of b.records) {
    if (!ids.has(Number(r.enrollment_id))) throw badRequest("أحد المتدربين ليس في هذه الجلسة");
    await q(`INSERT INTO session_attendance (tenant_id, session_id, enrollment_id, status, late_minutes, note, recorded_by)
             VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, session_id, enrollment_id) DO UPDATE SET status = $3, late_minutes = $4, note = $5, recorded_by = $6, recorded_at = now()`,
    [id, r.enrollment_id, r.status, r.status === "late" ? r.late_minutes ?? null : null, r.note, actor]);
  }
  await q("UPDATE training_sessions SET status = 'held' WHERE id = $1 AND status = 'planned'", [id]);
  await q("UPDATE enrollments SET status = 'active' WHERE id = ANY($1) AND status = 'new'", [b.records.map((r) => r.enrollment_id)]);
  return { saved: b.records.length };
}

// ---------- Assessments and scores ----------
export const assessmentSchema = z.object({ name: t.shortText("اسم التقييم", 100), kind: z.enum(Object.keys(ASSESS_KIND)).prefault("theory"),
  max_score: z.union([z.literal(""), z.null(), z.coerce.number().positive().max(10000)]).optional().transform((v) => (v === "" || v == null ? null : Number(v))),
  weight: z.coerce.number().min(0).max(100).prefault(0), sort: z.coerce.number().int().min(0).max(1000).prefault(0) });
export async function saveAssessment(q, courseId, id, b) {
  const [c] = await q("SELECT grading FROM courses WHERE id = $1", [courseId]);
  if (!c) throw notFound("الدورة غير موجودة");
  if (c.grading === "score" && !b.max_score) throw badRequest("حدد الدرجة القصوى");
  const [{ total }] = await q("SELECT COALESCE(sum(weight), 0)::numeric AS total FROM assessments WHERE course_id = $1 AND id <> COALESCE($2, 0)", [courseId, id]);
  if (Number(total) + b.weight > 100) throw badRequest(`مجموع الأوزان يتجاوز 100% (المتبقي ${100 - Number(total)}%)`);
  try {
    if (id) {
      if (b.max_score) {
        const [over] = await q("SELECT 1 FROM assessment_scores WHERE assessment_id = $1 AND score > $2 LIMIT 1", [id, b.max_score]);
        if (over) throw badRequest("توجد درجات أعلى من الدرجة القصوى الجديدة");
      }
      const [r] = await q("UPDATE assessments SET name = $3, kind = $4, max_score = $5, weight = $6, sort = $7 WHERE id = $1 AND course_id = $2 RETURNING *",
        [id, courseId, b.name, b.kind, c.grading === "score" ? b.max_score : null, b.weight, b.sort]);
      if (!r) throw notFound("التقييم غير موجود");
      return r;
    }
    const [r] = await q("INSERT INTO assessments (tenant_id, course_id, name, kind, max_score, weight, sort) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING *",
      [courseId, b.name, b.kind, c.grading === "score" ? b.max_score : null, b.weight, b.sort]);
    return r;
  } catch (e) { if (e.code === "23505") throw conflict("يوجد تقييم بنفس الاسم"); throw e; }
}
export async function deleteAssessment(q, courseId, id) {
  const [n] = await q("SELECT count(*)::int AS n FROM assessment_scores WHERE assessment_id = $1", [id]);
  if (n.n) throw badRequest("رُصدت درجات لهذا التقييم، فلا يمكن حذفه.");
  const rows = await q("DELETE FROM assessments WHERE id = $1 AND course_id = $2 RETURNING id", [id, courseId]);
  if (!rows.length) throw notFound("التقييم غير موجود");
}

export const scoresSchema = z.object({ reason: t.optText(200), scores: z.array(z.object({ enrollment_id: t.id,
  score: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(10000)]).optional().transform((v) => (v === "" || v == null ? null : Number(v))),
  passed: z.boolean().nullable().optional(), note: t.optText(200) })).min(1).max(500) });
export async function saveScores(q, assessmentId, b, actor, { trainerId = null } = {}) {
  const [a] = await q(`SELECT a.*, c.grading, c.trainer_id AS course_trainer FROM assessments a JOIN courses c ON c.id = a.course_id WHERE a.id = $1`, [assessmentId]);
  if (!a) throw notFound("التقييم غير موجود");
  const allowed = new Set((await courseRoster(q, a.course_id, { trainerId })).filter((e) => !["withdrawn"].includes(e.status)).map((e) => Number(e.id)));
  if (trainerId && !allowed.size) throw forbidden("هذه الدورة ليست من دوراتك");
  let changed = 0;
  for (const r of b.scores) {
    if (!allowed.has(Number(r.enrollment_id))) throw badRequest("أحد المتدربين ليس في هذه الدورة أو ليس من مجموعتك");
    if (a.grading === "score" && r.score != null && r.score > Number(a.max_score)) throw badRequest(`الدرجة أعلى من القصوى (${a.max_score})`);
    const passed = a.grading === "pass_fail" ? r.passed ?? null : null;
    const score = a.grading === "score" ? r.score : null;
    const [old] = await q("SELECT score, passed FROM assessment_scores WHERE assessment_id = $1 AND enrollment_id = $2", [assessmentId, r.enrollment_id]);
    const same = old && (old.score == null ? null : Number(old.score)) === score && old.passed === passed;
    if (same) continue;
    if (!old && score == null && passed == null) continue;
    await q(`INSERT INTO assessment_scores (tenant_id, assessment_id, enrollment_id, score, passed, note, updated_by)
             VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, assessment_id, enrollment_id) DO UPDATE SET score = $3, passed = $4, note = COALESCE($5, assessment_scores.note), updated_by = $6, updated_at = now()`,
    [assessmentId, r.enrollment_id, score, passed, r.note, actor]);
    if (old) {
      await q(`INSERT INTO score_changes (tenant_id, assessment_id, enrollment_id, old_score, new_score, old_passed, new_passed, reason, actor)
               VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)`, [assessmentId, r.enrollment_id, old.score, score, old.passed, passed, b.reason, actor]);
    }
    changed++;
  }
  return { changed };
}

// ---------- Progress, results and completion ----------
// Attendance is measured in held hours; a late arrival counts by the institute's factor, an excused absence is reported apart.
export async function progressMany(q, enrollments) {
  const out = new Map();
  if (!enrollments.length) return out;
  const ids = enrollments.map((e) => Number(e.id));
  const settings = await getSettings(q);
  const att = await q(
    `SELECT e.id,
            COALESCE(sum(s.hours) FILTER (WHERE s.status = 'held'), 0) AS held_hours,
            count(s.id) FILTER (WHERE s.status = 'held')::int AS held_sessions,
            COALESCE(sum(s.hours) FILTER (WHERE a.status = 'present'), 0) AS present_hours,
            COALESCE(sum(s.hours) FILTER (WHERE a.status = 'late'), 0) AS late_hours,
            COALESCE(sum(s.hours) FILTER (WHERE a.status = 'absent'), 0) AS absent_hours,
            COALESCE(sum(s.hours) FILTER (WHERE a.status = 'excused'), 0) AS excused_hours,
            count(a.*) FILTER (WHERE a.status = 'absent')::int AS absences, count(a.*) FILTER (WHERE a.status = 'late')::int AS lates
       FROM enrollments e
       JOIN training_sessions s ON s.course_id = e.course_id AND (s.group_id IS NULL OR s.group_id = e.group_id) AND s.day >= e.enrolled_on
       LEFT JOIN session_attendance a ON a.session_id = s.id AND a.enrollment_id = e.id
      WHERE e.id = ANY($1) GROUP BY e.id`, [ids]);
  const attOf = new Map(att.map((r) => [Number(r.id), r]));
  const courseIds = [...new Set(enrollments.map((e) => Number(e.course_id)))];
  const courses = new Map((await q("SELECT * FROM courses WHERE id = ANY($1)", [courseIds])).map((c) => [Number(c.id), c]));
  const assess = await q("SELECT * FROM assessments WHERE course_id = ANY($1) ORDER BY sort, id", [courseIds]);
  const scores = await q("SELECT * FROM assessment_scores WHERE enrollment_id = ANY($1)", [ids]);
  const scoreOf = new Map(scores.map((s) => [`${s.assessment_id}:${s.enrollment_id}`, s]));
  for (const e of enrollments) {
    const c = courses.get(Number(e.course_id));
    const a = attOf.get(Number(e.id)) || { held_hours: 0, held_sessions: 0, present_hours: 0, late_hours: 0, absent_hours: 0, excused_hours: 0, absences: 0, lates: 0 };
    const held = Number(a.held_hours);
    const attended = Number(a.present_hours) + Number(a.late_hours) * settings.late_counts_as;
    const pct = held ? Math.round((attended / held) * 1000) / 10 : null;
    const minAtt = Number(c.min_attendance ?? settings.min_attendance);
    const passMark = Number(c.pass_mark ?? settings.pass_mark);
    const list = assess.filter((x) => Number(x.course_id) === Number(c.id));
    const items = list.map((x) => {
      const s = scoreOf.get(`${x.id}:${e.id}`);
      return { id: x.id, name: x.name, kind: x.kind, max: x.max_score == null ? null : Number(x.max_score), weight: Number(x.weight),
        score: s?.score == null ? null : Number(s.score), passed: s?.passed ?? null };
    });
    const missing = items.filter((x) => (c.grading === "score" ? x.score == null : x.passed == null));
    let final = null; let passedScore = null;
    if (c.grading === "score" && items.length) {
      const totalW = items.reduce((t2, x) => t2 + x.weight, 0);
      const pctOf = (x) => (x.score == null ? 0 : (x.score / x.max) * 100);
      final = totalW > 0 ? items.reduce((t2, x) => t2 + pctOf(x) * x.weight, 0) / totalW : items.reduce((t2, x) => t2 + pctOf(x), 0) / items.length;
      final = Math.round(final * 100) / 100;
      passedScore = final >= passMark;
    } else if (c.grading === "pass_fail" && items.length) {
      passedScore = items.every((x) => x.passed === true);
    }
    const reasons = [];
    if (!items.length) reasons.push("لم تُحدد تقييمات للدورة");
    if (missing.length) reasons.push(`تقييمات غير مرصودة: ${missing.map((x) => x.name).join("، ")}`);
    if (pct === null) reasons.push("لم تُعقد جلسات بعد");
    else if (pct < minAtt) reasons.push(`نسبة الحضور ${pct}% أقل من المطلوب ${minAtt}%`);
    if (passedScore === false && !missing.length) reasons.push(c.grading === "score" ? `النتيجة ${final}% أقل من درجة النجاح ${passMark}%` : "لم يجتز أحد التقييمات");
    const hoursDone = Math.round(attended * 100) / 100;
    out.set(Number(e.id), {
      held_hours: held, held_sessions: a.held_sessions, attended_hours: hoursDone, absent_hours: Number(a.absent_hours), excused_hours: Number(a.excused_hours),
      absences: a.absences, lates: a.lates, attendance_pct: pct, min_attendance: minAtt, low_attendance: pct !== null && pct < minAtt,
      course_hours: Number(c.hours), remaining_hours: Math.max(0, Math.round((Number(c.hours) - hoursDone) * 100) / 100),
      grading: c.grading, pass_mark: passMark, items, final_score: final, passed_score: passedScore,
      eligible: Boolean(items.length) && !missing.length && pct !== null && pct >= minAtt && passedScore === true, reasons,
    });
  }
  return out;
}

export async function finalize(q, id, actor, { force = false, reason = null } = {}) {
  const [e] = await q("SELECT * FROM enrollments WHERE id = $1 FOR UPDATE", [id]);
  if (!e) throw notFound("التسجيل غير موجود");
  if (!["new", "active", "completed", "failed"].includes(e.status)) throw badRequest("حالة التسجيل لا تسمح باعتماد النتيجة");
  const p = (await progressMany(q, [e])).get(Number(id));
  const incomplete = p.reasons.some((r) => r.startsWith("تقييمات غير") || r.startsWith("لم تُحدد") || r.startsWith("لم تُعقد"));
  if (incomplete && !force) throw badRequest(`لا يمكن اعتماد النتيجة: ${p.reasons.join("، ")}`);
  const passed = p.eligible;
  const status = passed ? "completed" : "failed";
  await q(`UPDATE enrollments SET status = $2, result = $3, final_score = $4, completed_on = COALESCE(completed_on, CURRENT_DATE), status_changed_at = now(),
                  status_reason = $5 WHERE id = $1`, [id, status, passed ? "passed" : "failed", p.final_score, reason || (passed ? null : p.reasons.join("، ").slice(0, 300))]);
  await log(q, { enrollment: id, course: e.course_id, kind: "result", from: ENROLL_STATUS[e.status], to: passed ? "اجتاز" : "لم يجتز",
    reason: p.final_score != null ? `النتيجة ${p.final_score}% — الحضور ${p.attendance_pct ?? 0}%` : `الحضور ${p.attendance_pct ?? 0}%` }, actor);
  if (passed) {
    const [open] = await q("SELECT count(*)::int AS n FROM enrollments WHERE student_id = $1 AND status IN ('new', 'active')", [e.student_id]);
    if (!open.n) await q("UPDATE students SET status = 'graduated', status_changed_at = now() WHERE id = $1 AND status = 'active'", [e.student_id]);
  }
  return { status, progress: p };
}

// The trainee's complete academic record: enrollments, attendance, assessments, hours, certificates, fees and the history log.
export async function traineeRecord(q, studentId) {
  const [s] = await q("SELECT * FROM students WHERE id = $1", [studentId]);
  if (!s) throw notFound("المتدرب غير موجود");
  const enrollments = await q(
    `SELECT e.*, c.name AS course, c.code AS course_code, c.hours AS course_hours, c.grading, c.mode, c.starts_on, c.ends_on, c.status AS course_status,
            p.name AS program, g.name AS group_name, COALESCE(gt.full_name, ct.full_name) AS trainer
       FROM enrollments e JOIN courses c ON c.id = e.course_id LEFT JOIN programs p ON p.id = c.program_id
       LEFT JOIN course_groups g ON g.id = e.group_id LEFT JOIN teachers gt ON gt.id = g.trainer_id LEFT JOIN teachers ct ON ct.id = c.trainer_id
      WHERE e.student_id = $1 ORDER BY e.enrolled_on DESC, e.id DESC`, [studentId]);
  const prog = await progressMany(q, enrollments);
  const ids = enrollments.map((e) => Number(e.id));
  const sessions = ids.length ? await q(
    `SELECT a.enrollment_id, s.day, s.hours, s.topic, s.mode, a.status, a.late_minutes
       FROM session_attendance a JOIN training_sessions s ON s.id = a.session_id WHERE a.enrollment_id = ANY($1) ORDER BY s.day DESC`, [ids]) : [];
  const history = ids.length ? await q("SELECT * FROM training_log WHERE enrollment_id = ANY($1) ORDER BY id DESC", [ids]) : [];
  const changes = ids.length ? await q(`SELECT sc.*, a.name AS assessment FROM score_changes sc JOIN assessments a ON a.id = sc.assessment_id
                                         WHERE sc.enrollment_id = ANY($1) ORDER BY sc.id DESC`, [ids]) : [];
  const certificates = await q(`SELECT id, code, serial, status, kind, title, issued_at, revoked_at, enrollment_id, data -> 'course' ->> 'hours' AS hours
                                  FROM certificates WHERE student_id = $1 ORDER BY issued_at DESC`, [studentId]);
  const invoices = await q(
    `SELECT i.id, i.title, i.amount, i.status, i.created_at, i.enrollment_id,
            COALESCE((SELECT sum(CASE WHEN p.kind = 'payment' THEN p.amount ELSE -p.amount END) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i WHERE i.student_id = $1 ORDER BY i.id DESC`, [studentId]);
  const payments = await q(`SELECT p.*, i.title FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.student_id = $1 ORDER BY p.id DESC`, [studentId]);
  const rows = enrollments.map((e) => ({ ...e, progress: prog.get(Number(e.id)), attendance: sessions.filter((x) => Number(x.enrollment_id) === Number(e.id)),
    history: history.filter((x) => Number(x.enrollment_id) === Number(e.id)), score_changes: changes.filter((x) => Number(x.enrollment_id) === Number(e.id)) }));
  const open = invoices.filter((i) => i.status === "open");
  const due = open.reduce((t2, i) => t2 + Number(i.amount), 0), paid = open.reduce((t2, i) => t2 + Number(i.paid), 0);
  return {
    trainee: publicTrainee(s), enrollments: rows,
    summary: {
      courses: rows.filter((e) => e.status !== "withdrawn").length, completed: rows.filter((e) => e.status === "completed").length,
      in_progress: rows.filter((e) => ["new", "active"].includes(e.status)).length, incomplete: rows.filter((e) => ["failed", "withdrawn", "deferred", "suspended"].includes(e.status)).length,
      earned_hours: rows.filter((e) => e.status === "completed").reduce((t2, e) => t2 + Number(e.course_hours), 0),
      attended_hours: rows.reduce((t2, e) => t2 + (e.progress?.attended_hours || 0), 0),
      programs_completed: await programsCompleted(q, studentId), certificates: certificates.filter((c) => !c.revoked_at).length,
      fees_due: due, fees_paid: paid, balance: Math.round((due - paid) * 100) / 100,
    },
    certificates, invoices, payments,
  };
}
async function programsCompleted(q, studentId) {
  return q(`SELECT p.id, p.name FROM programs p
             WHERE EXISTS (SELECT 1 FROM courses c WHERE c.program_id = p.id AND c.status <> 'canceled')
               AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.program_id = p.id AND c.status <> 'canceled'
                               AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = $1 AND e.status = 'completed'))`, [studentId]);
}

// ---------- Certificates ----------
export const certificateSchema = z.object({ kind: z.enum(["course", "attendance"]).prefault("course"), title: t.optText(120), template_id: t.optId });
// A completion certificate comes only from the course's approved results; an attendance statement is not a
// result and needs no approval. Re-issuing replaces the earlier certificate (kept, marked «مستبدلة»).
export async function issueCertificate(q, enrollmentId, b, actor, school, { reason = null } = {}) {
  const [e] = await q(
    `SELECT e.*, s.full_name, c.name AS course, c.hours, c.mode, p.name AS program, c.starts_on, c.ends_on
       FROM enrollments e JOIN students s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id LEFT JOIN programs p ON p.id = c.program_id
      WHERE e.id = $1`, [enrollmentId]);
  if (!e) throw notFound("التسجيل غير موجود");
  const settings = await getSettings(q);
  const p = (await progressMany(q, [e])).get(Number(enrollmentId));
  if (b.kind === "course" && !(e.status === "completed" && e.result === "passed")) throw badRequest("شهادة الإكمال تصدر بعد اعتماد اجتياز الدورة");
  if (b.kind === "attendance" && !p.attended_hours) throw badRequest("لا توجد ساعات حضور لإصدار إفادة");
  let batch = null;
  if (b.kind === "course") {
    const ok = await results.approvedResults(q, await results.courseScope(q, e.course_id));
    if (ok.stale) return { stale: true };
    batch = ok.batch;
  }
  const T = settings.terms;
  const title = b.title || (b.kind === "course" ? `شهادة إتمام ${T.course}` : "إفادة حضور");
  const [prev] = await q("SELECT id FROM certificates WHERE enrollment_id = $1 AND kind = $2 AND status = 'issued'", [enrollmentId, b.kind]);
  const data = {
    school, student: { name: e.full_name },
    course: { name: e.course, program: e.program || null, hours: b.kind === "course" ? Number(e.hours) : p.attended_hours, mode: MODES[e.mode],
      completed_on: e.completed_on ? String(e.completed_on instanceof Date ? e.completed_on.toISOString() : e.completed_on).slice(0, 10) : null,
      starts_on: e.starts_on, ends_on: e.ends_on },
    result: b.kind === "course" ? (e.final_score != null ? `اجتاز بنسبة ${Number(e.final_score)}%` : "اجتاز") : null,
    attendance_pct: p.attendance_pct, terms: { trainee: T.trainee, course: T.course, program: T.program },
    signer: { title: settings.signer_title, name: settings.signer_name }, footer_note: settings.certificate_note || null,
    approval: batch ? { by: batch.approved_by, at: batch.approved_at, version: batch.version } : null,
  };
  const look = await design.layoutFor(q, b.kind, b.template_id ?? null);
  data.layout = look.layout; data.template = look.template;
  const row = await writeCertificate(q, { studentId: e.student_id, kind: b.kind, title, data, actor, batchId: batch?.id ?? null,
    enrollmentId, replaces: prev?.id ?? null, reason: prev ? reason || "أُعيد إصدارها" : null });
  if (batch) await results.issuedEvent(q, batch.id, actor, 1);
  return row;
}

// ---------- Fees ----------
export async function feesOverview(q, { course_id = null } = {}) {
  return q(
    `SELECT i.id AS invoice_id, i.title, i.amount, i.status, i.created_at, s.id AS student_id, s.full_name, s.student_no, e.id AS enrollment_id,
            c.name AS course, e.discount,
            COALESCE((SELECT sum(CASE WHEN p.kind = 'payment' THEN p.amount ELSE -p.amount END) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i JOIN students s ON s.id = i.student_id
       LEFT JOIN enrollments e ON e.id = i.enrollment_id LEFT JOIN courses c ON c.id = e.course_id
      WHERE ($1::bigint IS NULL OR e.course_id = $1) ORDER BY i.id DESC LIMIT 2000`, [course_id]);
}
export const discountSchema = z.object({ amount: z.coerce.number().min(0).max(100_000_000), reason: t.shortText("سبب الخصم", 300) });
// A later discount lowers this enrollment's invoice; payments already made stay as they are.
export async function setDiscount(q, enrollmentId, b, actor) {
  const [e] = await q("SELECT e.*, i.amount AS inv_amount FROM enrollments e LEFT JOIN invoices i ON i.id = e.invoice_id WHERE e.id = $1 FOR UPDATE OF e", [enrollmentId]);
  if (!e) throw notFound("التسجيل غير موجود");
  if (b.amount > Number(e.fee)) throw badRequest("الخصم أكبر من رسوم التسجيل");
  const due = Number(e.fee) - b.amount;
  if (e.invoice_id) {
    const [paid] = await q("SELECT COALESCE(sum(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0) AS n FROM payments WHERE invoice_id = $1", [e.invoice_id]);
    if (due < Number(paid.n)) throw badRequest("المدفوع أكبر من المبلغ بعد الخصم. سجّل استردادًا أولًا.");
    if (due > 0) await q("UPDATE invoices SET amount = $2 WHERE id = $1", [e.invoice_id, due]);
    else await q("UPDATE invoices SET status = 'void', void_reason = $2 WHERE id = $1 AND status = 'open'", [e.invoice_id, `خصم كامل: ${b.reason}`.slice(0, 300)]);
  } else if (due > 0) {
    const [c] = await q("SELECT name FROM courses WHERE id = $1", [e.course_id]);
    const [inv] = await q(`INSERT INTO invoices (tenant_id, student_id, title, amount, created_by, enrollment_id) VALUES (app_tenant(), $1, $2, $3, $4, $5) RETURNING id`,
      [e.student_id, `رسوم ${c.name}`.slice(0, 120), due, actor, enrollmentId]);
    await q("UPDATE enrollments SET invoice_id = $2 WHERE id = $1", [enrollmentId, inv.id]);
  }
  await q("UPDATE enrollments SET discount = $2 WHERE id = $1", [enrollmentId, b.amount]);
  await log(q, { enrollment: enrollmentId, course: e.course_id, kind: "fee", from: `خصم ${e.discount}`, to: `خصم ${b.amount}`, reason: b.reason }, actor);
}

// ---------- Dashboard and reports ----------
export async function dashboard(q, { finance = false } = {}) {
  const [k] = await q(`SELECT
      (SELECT count(*) FROM students WHERE archived_at IS NULL)::int AS trainees,
      (SELECT count(DISTINCT e.student_id) FROM enrollments e WHERE e.status IN ('new', 'active'))::int AS active_trainees,
      (SELECT count(*) FROM courses WHERE status = 'running')::int AS running,
      (SELECT count(*) FROM courses WHERE status IN ('planned', 'open') AND (starts_on IS NULL OR starts_on >= CURRENT_DATE))::int AS upcoming,
      (SELECT count(*) FROM courses WHERE status = 'completed')::int AS completed,
      (SELECT count(*) FROM enrollments WHERE status = 'completed')::int AS passed,
      (SELECT count(*) FROM enrollments WHERE status = 'failed')::int AS failed,
      (SELECT count(*) FROM certificates WHERE revoked_at IS NULL AND kind IN ('course', 'attendance'))::int AS certificates,
      (SELECT count(*) FROM training_sessions WHERE day = CURRENT_DATE AND status IN ('planned', 'held'))::int AS sessions_today`);
  const active = await q("SELECT * FROM enrollments WHERE status IN ('new', 'active')");
  const prog = await progressMany(q, active);
  const pcts = [...prog.values()].map((p) => p.attendance_pct).filter((x) => x != null);
  const low = active.filter((e) => prog.get(Number(e.id))?.low_attendance).length;
  const out = { ...k, attendance_avg: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 10) / 10 : null, low_attendance: low,
    today: await q(`SELECT s.id, s.day, s.starts_at, s.hours, s.status, c.name AS course, g.name AS group_name, t.full_name AS trainer
                      FROM training_sessions s JOIN courses c ON c.id = s.course_id LEFT JOIN course_groups g ON g.id = s.group_id
                      LEFT JOIN teachers t ON t.id = s.trainer_id WHERE s.day = CURRENT_DATE ORDER BY s.starts_at NULLS LAST`),
    running_courses: (await listCourses(q, { status: "running" })).slice(0, 8) };
  if (finance) {
    const [f] = await q(`SELECT COALESCE(sum(i.amount) FILTER (WHERE i.status = 'open'), 0) AS billed,
        COALESCE((SELECT sum(CASE WHEN p.kind = 'payment' THEN p.amount ELSE -p.amount END) FROM payments p JOIN invoices i2 ON i2.id = p.invoice_id WHERE i2.status = 'open'), 0) AS collected
        FROM invoices i`);
    out.finance = { billed: Number(f.billed), collected: Number(f.collected), outstanding: Math.round((Number(f.billed) - Number(f.collected)) * 100) / 100 };
  }
  return out;
}

export const REPORTS = {
  record: { label: "السجل الأكاديمي للمتدرب", cap: "reports", needs: "student" },
  results: { label: "نتائج الدورة", cap: "reports", needs: "course" },
  attendance: { label: "كشف حضور المتدربين", cap: "reports", needs: "course" },
  hours: { label: "إكمال الساعات التدريبية", cap: "reports" },
  trainers: { label: "أداء المدربين", cap: "reports" },
  enrollments: { label: "التسجيل في الدورات", cap: "reports" },
  certificates: { label: "الشهادات الصادرة", cap: "reports" },
  fees: { label: "الرسوم والمدفوعات", cap: "finance" },
  withdrawals: { label: "الانسحاب والتأجيل", cap: "reports" },
  compare: { label: "مقارنة المجموعات والدورات", cap: "reports" },
};
export const reportSchema = z.object({ course_id: t.optId, student_id: t.optId, from: t.optDate, to: t.optDate });

export async function report(q, key, f) {
  const R = REPORTS[key];
  if (!R) throw notFound("التقرير غير موجود");
  if (R.needs === "course" && !f.course_id) throw badRequest("اختر الدورة");
  if (R.needs === "student" && !f.student_id) throw badRequest("اختر المتدرب");
  const range = [f.from ?? null, f.to ?? null];
  const cols = (...c) => c.map(([k, label]) => ({ key: k, label }));
  switch (key) {
    case "record": {
      const r = await traineeRecord(q, f.student_id);
      return { title: `${R.label}: ${r.trainee.full_name}`, columns: cols(["course", "الدورة"], ["program", "البرنامج"], ["group", "المجموعة"], ["trainer", "المدرب"],
        ["enrolled_on", "تاريخ الالتحاق"], ["status", "الحالة"], ["hours", "الساعات المحضورة"], ["attendance", "الحضور %"], ["final", "النتيجة %"], ["result", "النتيجة"]),
      rows: r.enrollments.map((e) => ({ course: e.course, program: e.program || "—", group: e.group_name || "—", trainer: e.trainer || "—", enrolled_on: day(e.enrolled_on),
        status: ENROLL_STATUS[e.status], hours: `${e.progress.attended_hours} / ${e.course_hours}`, attendance: e.progress.attendance_pct ?? "—",
        final: e.progress.final_score ?? "—", result: e.result === "passed" ? "اجتاز" : e.result === "failed" ? "لم يجتز" : "—" })), summary: r.summary };
    }
    case "results":
    case "attendance": {
      const { course, enrollments } = await getCourse(q, f.course_id);
      const list = enrollments.filter((e) => e.status !== "withdrawn");
      if (key === "attendance") {
        return { title: `${R.label}: ${course.name}`, columns: cols(["name", "المتدرب"], ["group", "المجموعة"], ["sessions", "الجلسات المنعقدة"], ["absences", "الغياب"],
          ["lates", "التأخر"], ["attended", "الساعات المحضورة"], ["absent", "ساعات الغياب"], ["pct", "الحضور %"], ["flag", "تنبيه"]),
        rows: list.map((e) => ({ name: e.full_name, group: e.group_name || "—", sessions: e.progress.held_sessions, absences: e.progress.absences, lates: e.progress.lates,
          attended: e.progress.attended_hours, absent: e.progress.absent_hours, pct: e.progress.attendance_pct ?? "—", flag: e.progress.low_attendance ? "أقل من الحد" : "" })) };
      }
      const items = list[0]?.progress.items || [];
      return { title: `${R.label}: ${course.name}`, columns: cols(["name", "المتدرب"], ["group", "المجموعة"],
        ...items.map((x) => [`a${x.id}`, `${x.name}${x.max ? ` (${x.max})` : ""}`]), ["pct", "الحضور %"], ["final", "النهائية %"], ["result", "النتيجة"]),
      rows: list.map((e) => ({ name: e.full_name, group: e.group_name || "—",
        ...Object.fromEntries(e.progress.items.map((x) => [`a${x.id}`, course.grading === "score" ? x.score ?? "—" : x.passed == null ? "—" : x.passed ? "اجتاز" : "لم يجتز"])),
        pct: e.progress.attendance_pct ?? "—", final: e.progress.final_score ?? "—",
        result: e.result === "passed" ? "اجتاز" : e.result === "failed" ? "لم يجتز" : e.progress.eligible ? "مستوفٍ (لم يُعتمد)" : "غير مكتمل" })) };
    }
    case "hours": {
      const rows = await q(`SELECT e.*, s.full_name, c.name AS course, c.hours AS course_hours FROM enrollments e JOIN students s ON s.id = e.student_id
                             JOIN courses c ON c.id = e.course_id WHERE e.status <> 'withdrawn' AND ($1::bigint IS NULL OR e.course_id = $1) ORDER BY c.name, s.full_name`, [f.course_id ?? null]);
      const p = await progressMany(q, rows);
      return { title: R.label, columns: cols(["name", "المتدرب"], ["course", "الدورة"], ["approved", "الساعات المعتمدة"], ["done", "الساعات المنجزة"],
        ["remaining", "المتبقية"], ["earned", "الساعات المكتسبة"]),
      rows: rows.map((e) => ({ name: e.full_name, course: e.course, approved: Number(e.course_hours), done: p.get(Number(e.id)).attended_hours,
        remaining: p.get(Number(e.id)).remaining_hours, earned: e.status === "completed" ? Number(e.course_hours) : 0 })) };
    }
    case "trainers": {
      const rows = await q(`SELECT t.id, t.full_name, t.specialty,
          (SELECT count(DISTINCT c.id) FROM courses c LEFT JOIN course_groups g ON g.course_id = c.id WHERE c.trainer_id = t.id OR g.trainer_id = t.id)::int AS courses,
          (SELECT count(*) FROM training_sessions s WHERE s.trainer_id = t.id AND s.status = 'held' AND ($1::date IS NULL OR s.day >= $1) AND ($2::date IS NULL OR s.day <= $2))::int AS held,
          (SELECT COALESCE(sum(hours), 0) FROM training_sessions s WHERE s.trainer_id = t.id AND s.status = 'held' AND ($1::date IS NULL OR s.day >= $1) AND ($2::date IS NULL OR s.day <= $2)) AS hours,
          (SELECT count(*) FROM training_sessions s WHERE s.trainer_id = t.id AND s.status = 'canceled' AND ($1::date IS NULL OR s.day >= $1) AND ($2::date IS NULL OR s.day <= $2))::int AS canceled,
          (SELECT count(*) FROM training_sessions s WHERE s.trainer_id = t.id AND s.status = 'held'
              AND NOT EXISTS (SELECT 1 FROM session_attendance a WHERE a.session_id = s.id))::int AS unrecorded,
          (SELECT round(avg(e.final_score), 1) FROM enrollments e JOIN courses c ON c.id = e.course_id LEFT JOIN course_groups g ON g.id = e.group_id
              WHERE e.final_score IS NOT NULL AND COALESCE(g.trainer_id, c.trainer_id) = t.id) AS avg_score,
          (SELECT count(*) FILTER (WHERE e.status = 'completed') * 100.0 / NULLIF(count(*) FILTER (WHERE e.status IN ('completed', 'failed')), 0)
             FROM enrollments e JOIN courses c ON c.id = e.course_id LEFT JOIN course_groups g ON g.id = e.group_id WHERE COALESCE(g.trainer_id, c.trainer_id) = t.id) AS pass_rate
        FROM teachers t ORDER BY t.full_name`, range);
      return { title: R.label, columns: cols(["name", "المدرب"], ["specialty", "التخصص"], ["courses", "الدورات"], ["held", "الجلسات المنفذة"], ["hours", "الساعات"],
        ["canceled", "الملغاة"], ["unrecorded", "بلا تحضير"], ["avg", "متوسط النتائج %"], ["rate", "نسبة الاجتياز %"]),
      rows: rows.map((r) => ({ name: r.full_name, specialty: r.specialty || "—", courses: r.courses, held: r.held, hours: Number(r.hours), canceled: r.canceled,
        unrecorded: r.unrecorded, avg: r.avg_score ?? "—", rate: r.pass_rate == null ? "—" : Math.round(Number(r.pass_rate)) })) };
    }
    case "enrollments": {
      const rows = await q(`SELECT e.*, s.full_name, s.student_no, c.name AS course, g.name AS group_name FROM enrollments e JOIN students s ON s.id = e.student_id
                             JOIN courses c ON c.id = e.course_id LEFT JOIN course_groups g ON g.id = e.group_id
                            WHERE ($1::date IS NULL OR e.enrolled_on >= $1) AND ($2::date IS NULL OR e.enrolled_on <= $2) AND ($3::bigint IS NULL OR e.course_id = $3)
                            ORDER BY e.enrolled_on DESC, e.id DESC`, [...range, f.course_id ?? null]);
      return { title: R.label, columns: cols(["date", "تاريخ التسجيل"], ["name", "المتدرب"], ["no", "الرقم"], ["course", "الدورة"], ["group", "المجموعة"], ["status", "الحالة"],
        ["fee", "الرسوم"], ["discount", "الخصم"], ["by", "سجّله"]),
      rows: rows.map((e) => ({ date: day(e.enrolled_on), name: e.full_name, no: e.student_no || "—", course: e.course, group: e.group_name || "—",
        status: ENROLL_STATUS[e.status], fee: Number(e.fee), discount: Number(e.discount), by: e.created_by })) };
    }
    case "certificates": {
      const rows = await q(`SELECT x.code, x.kind, x.title, x.issued_at, x.issued_by, x.revoked_at, s.full_name, x.data -> 'course' ->> 'name' AS course,
                                   x.data -> 'course' ->> 'hours' AS hours FROM certificates x JOIN students s ON s.id = x.student_id
                             WHERE x.kind IN ('course', 'attendance') AND ($1::date IS NULL OR x.issued_at >= $1) AND ($2::date IS NULL OR x.issued_at < $2::date + 1)
                             ORDER BY x.issued_at DESC`, range);
      return { title: R.label, columns: cols(["code", "رقم الشهادة"], ["name", "المتدرب"], ["course", "الدورة"], ["kind", "النوع"], ["hours", "الساعات"],
        ["date", "تاريخ الإصدار"], ["by", "أصدرها"], ["state", "الحالة"]),
      rows: rows.map((r) => ({ code: r.code, name: r.full_name, course: r.course || "—", kind: r.kind === "course" ? "شهادة إتمام" : "إفادة حضور",
        hours: r.hours ?? "—", date: day(r.issued_at), by: r.issued_by, state: r.revoked_at ? "ملغاة" : "سارية" })) };
    }
    case "fees": {
      const rows = await q(
        `SELECT COALESCE(c.name, i.title) AS course, p.name AS program, count(DISTINCT i.id)::int AS invoices, COALESCE(sum(i.amount), 0) AS billed,
                COALESCE(sum(e.discount), 0) AS discounts,
                COALESCE(sum((SELECT sum(CASE WHEN pm.kind = 'payment' THEN pm.amount ELSE 0 END) FROM payments pm WHERE pm.invoice_id = i.id
                               AND ($1::date IS NULL OR pm.created_at >= $1) AND ($2::date IS NULL OR pm.created_at < $2::date + 1))), 0) AS paid,
                COALESCE(sum((SELECT sum(CASE WHEN pm.kind = 'refund' THEN pm.amount ELSE 0 END) FROM payments pm WHERE pm.invoice_id = i.id
                               AND ($1::date IS NULL OR pm.created_at >= $1) AND ($2::date IS NULL OR pm.created_at < $2::date + 1))), 0) AS refunded
           FROM invoices i LEFT JOIN enrollments e ON e.id = i.enrollment_id LEFT JOIN courses c ON c.id = e.course_id LEFT JOIN programs p ON p.id = c.program_id
          WHERE i.status = 'open' GROUP BY 1, 2 ORDER BY 1`, range);
      return { title: R.label, columns: cols(["course", "الدورة / البند"], ["program", "البرنامج"], ["invoices", "الفواتير"], ["billed", "المستحق"], ["discounts", "الخصومات"],
        ["paid", "المحصّل"], ["refunded", "المسترد"], ["balance", "المتبقي"]),
      rows: rows.map((r) => ({ course: r.course, program: r.program || "—", invoices: r.invoices, billed: Number(r.billed), discounts: Number(r.discounts),
        paid: Number(r.paid), refunded: Number(r.refunded), balance: Math.round((Number(r.billed) - Number(r.paid) + Number(r.refunded)) * 100) / 100 })) };
    }
    case "withdrawals": {
      const rows = await q(`SELECT l.created_at, l.from_value, l.to_value, l.reason, l.actor, s.full_name, c.name AS course
                              FROM training_log l JOIN enrollments e ON e.id = l.enrollment_id JOIN students s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id
                             WHERE l.kind = 'status' AND l.to_value IN ('منسحب', 'مؤجل', 'موقوف')
                               AND ($1::date IS NULL OR l.created_at >= $1) AND ($2::date IS NULL OR l.created_at < $2::date + 1) ORDER BY l.id DESC`, range);
      return { title: R.label, columns: cols(["date", "التاريخ"], ["name", "المتدرب"], ["course", "الدورة"], ["status", "الحالة الجديدة"], ["reason", "السبب"], ["by", "بواسطة"]),
        rows: rows.map((r) => ({ date: day(r.created_at), name: r.full_name, course: r.course, status: r.to_value, reason: r.reason || "—", by: r.actor })) };
    }
    case "compare": {
      const rows = await q(`SELECT e.*, c.name AS course, g.name AS group_name FROM enrollments e JOIN courses c ON c.id = e.course_id
                             LEFT JOIN course_groups g ON g.id = e.group_id WHERE e.status <> 'withdrawn' AND ($1::bigint IS NULL OR e.course_id = $1)`, [f.course_id ?? null]);
      const p = await progressMany(q, rows);
      const groups = new Map();
      for (const e of rows) {
        const k = `${e.course}|${e.group_name || "—"}`;
        const g = groups.get(k) || { course: e.course, group: e.group_name || "—", n: 0, att: [], fin: [], passed: 0, done: 0 };
        const x = p.get(Number(e.id));
        g.n++; if (x.attendance_pct != null) g.att.push(x.attendance_pct); if (x.final_score != null) g.fin.push(x.final_score);
        if (["completed", "failed"].includes(e.status)) { g.done++; if (e.status === "completed") g.passed++; }
        groups.set(k, g);
      }
      const avg = (a) => (a.length ? Math.round(a.reduce((s2, v) => s2 + v, 0) / a.length * 10) / 10 : "—");
      return { title: R.label, columns: cols(["course", "الدورة"], ["group", "المجموعة"], ["n", "المتدربون"], ["att", "متوسط الحضور %"], ["fin", "متوسط النتيجة %"], ["rate", "نسبة الاجتياز %"]),
        rows: [...groups.values()].map((g) => ({ course: g.course, group: g.group, n: g.n, att: avg(g.att), fin: avg(g.fin), rate: g.done ? Math.round(g.passed / g.done * 100) : "—" })) };
    }
    default: throw notFound("التقرير غير موجود");
  }
}
const day = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : "—");
export function toCsv(r) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `﻿${[r.columns.map((c) => esc(c.label)).join(","), ...r.rows.map((row) => r.columns.map((c) => esc(row[c.key])).join(","))].join("\r\n")}`;
}
