/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Results approval before certificates: prepare → review → (returned → review)* → approved (internally).
// One result per class and term/year in a school, per course in an institute. Approval stores a snapshot of
// the results and its hash; certificates are issued only while the live results still match that snapshot.
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { classReportCards } from "./reports.service.js";
import { featureSettings } from "./feature-settings.service.js";

export const STATUS = { none: "لم تُعدّ بعد", draft: "مسودة", review: "قيد المراجعة", returned: "تحتاج إلى تعديل", approved: "معتمدة داخليًا" };
export const ACTIONS = { created: "إنشاء", submitted: "إرسال للمراجعة", returned: "إعادة للتعديل", approved: "اعتماد داخلي",
  reopened: "إعادة فتح", changed: "تغيّرت الدرجات بعد الاعتماد", issued: "إصدار شهادات" };

export const resultResult = (card, passMark) => {
  if (!card.subjects.length) return { result: "لم تكتمل الدرجات", failed: [], passed: false };
  const failed = card.subjects.filter((s) => s.percent !== null && s.percent < passMark).map((s) => s.subject);
  return failed.length ? { result: `دور ثانٍ في: ${failed.join("، ")}`, failed, passed: false } : { result: "ناجح", failed: [], passed: true };
};

// ---------- Scope ----------
export const classKeySchema = z.object({ class_id: t.id, scope: z.enum(["term", "year"]), term_id: t.optId, year_id: t.optId });

export async function classScope(q, { class_id, scope, term_id = null, year_id = null }) {
  const [cls] = await q("SELECT id, name, grade_id FROM classes WHERE id = $1", [class_id]);
  if (!cls) throw notFound("الشعبة غير موجودة");
  if (scope === "term") {
    const [term] = await q(`SELECT t.id, t.name, t.year_id, y.name AS year_name FROM terms t JOIN academic_years y ON y.id = t.year_id
      WHERE ($1::bigint IS NULL AND t.is_current) OR t.id = $1`, [term_id ?? null]);
    if (!term) throw badRequest("لا يوجد فصل دراسي حالي. حدد الفصل من «السنة الدراسية».");
    return { cls, scope, term_id: term.id, year_id: term.year_id, label: `${term.name} — ${term.year_name}`, cardTerm: term.id };
  }
  const [year] = await q("SELECT id, name FROM academic_years WHERE ($1::bigint IS NULL AND is_current) OR id = $1", [year_id]);
  if (!year) throw badRequest("لا توجد سنة دراسية حالية.");
  return { cls, scope, term_id: null, year_id: year.id, label: `العام الدراسي ${year.name}`, cardTerm: null };
}

const hashOf = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

// ---------- School: results of a class for a term or the year ----------
export async function classResults(q, sc) {
  const settings = await featureSettings(q, "certificates");
  const cards = await classReportCards(q, sc.cls.id, sc.cardTerm);
  const rows = cards.map((c) => ({ card: c, ...resultResult(c, settings.pass_mark) }));
  // What approval freezes: each student's subjects, scores and outcome.
  const snapshot = rows.map((r) => ({ id: Number(r.card.student.id), percent: r.card.summary.percent, result: r.result,
    subjects: r.card.subjects.map((s) => [s.subject, s.score, s.max]) })).sort((a, b) => a.id - b.id);
  return { rows, settings, snapshot, hash: hashOf(snapshot) };
}

// Completeness checks, each naming the student, the subject and the reason.
export async function classChecks(q, sc) {
  const issues = [];
  const err = (reason, x = {}) => issues.push({ level: "error", reason, ...x });
  const warn = (reason, x = {}) => issues.push({ level: "warning", reason, ...x });
  const students = await q("SELECT id, full_name AS name, student_no FROM students WHERE class_id = $1 AND archived_at IS NULL ORDER BY full_name", [sc.cls.id]);
  if (!students.length) err("لا يوجد طلاب في الشعبة");
  for (const s of students) if (!s.student_no) warn("لا يوجد رقم تعريفي للطالب", { student: s.name });
  const termFilter = sc.scope === "term" ? "e.term_id = $2" : "e.term_id IN (SELECT id FROM terms WHERE year_id = $2)";
  const scopeId = sc.scope === "term" ? sc.term_id : sc.year_id;
  const exams = await q(`SELECT e.id, e.title, e.status, s.name AS subject, e.subject_id FROM exams e JOIN subjects s ON s.id = e.subject_id
                          WHERE e.class_id = $1 AND ${termFilter} ORDER BY s.name, e.id`, [sc.cls.id, scopeId]);
  const subjects = sc.cls.grade_id ? await q(
    `SELECT s.id, s.name FROM subjects s JOIN subject_grades sg ON sg.subject_id = s.id
      WHERE sg.grade_id = $1 AND s.is_active ORDER BY s.name`, [sc.cls.grade_id]) : [];
  for (const s of subjects) {
    if (!exams.some((e) => e.subject_id === s.id && e.status === "published")) err("لا توجد درجات منشورة لهذه المادة", { subject: s.name });
  }
  for (const e of exams.filter((x) => x.status !== "published")) warn(`اختبار غير منشور «${e.title}» ولن يُحسب`, { subject: e.subject });
  const missing = await q(
    `SELECT st.full_name AS student, sub.name AS subject, e.title FROM exams e JOIN subjects sub ON sub.id = e.subject_id
       JOIN students st ON st.class_id = e.class_id AND st.archived_at IS NULL
       LEFT JOIN scores sc ON sc.exam_id = e.id AND sc.student_id = st.id
      WHERE e.class_id = $1 AND e.status = 'published' AND ${termFilter} AND sc.score IS NULL
      ORDER BY st.full_name, sub.name, e.id LIMIT 500`, [sc.cls.id, scopeId]);
  for (const m of missing) err(`لا توجد درجة في «${m.title}»`, { student: m.student, subject: m.subject });
  return issues;
}

// ---------- Institute: results of a course ----------
export async function courseScope(q, courseId) {
  const [c] = await q("SELECT id, name, code FROM courses WHERE id = $1", [courseId]);
  if (!c) throw notFound("الدورة غير موجودة");
  return { course: c, scope: "course", course_id: c.id, label: c.name };
}
export async function courseResults(q, sc) {
  const rows = await q(
    `SELECT e.id AS enrollment_id, e.student_id, s.full_name AS name, s.student_no, e.status, e.result, e.final_score
       FROM enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.course_id = $1 AND e.status NOT IN ('withdrawn') ORDER BY s.full_name`, [sc.course_id]);
  const snapshot = rows.map((r) => [Number(r.enrollment_id), r.status, r.result, r.final_score === null ? null : Number(r.final_score)])
    .sort((a, b) => a[0] - b[0]);
  return { rows, snapshot, hash: hashOf(snapshot) };
}
export async function courseChecks(q, sc) {
  const { rows } = await courseResults(q, sc);
  const issues = [];
  if (!rows.length) issues.push({ level: "error", reason: "لا يوجد متدربون مسجلون في الدورة" });
  for (const r of rows) {
    if (["new", "active"].includes(r.status)) issues.push({ level: "error", reason: "لم تُعتمد نتيجته بعد", student: r.name });
    else if (["deferred", "suspended"].includes(r.status)) issues.push({ level: "warning", reason: "تسجيله مؤجل أو موقوف ولن تصدر له شهادة", student: r.name });
    if (!r.student_no) issues.push({ level: "warning", reason: "لا يوجد رقم تعريفي للمتدرب", student: r.name });
  }
  return issues;
}

// ---------- The workflow, shared by both ----------
const keyWhere = (sc) => (sc.scope === "course"
  ? { sql: "scope = 'course' AND course_id = $1", params: [sc.course_id] }
  : { sql: "scope = $1 AND class_id = $2 AND COALESCE(term_id, 0) = COALESCE($3::bigint, 0) AND COALESCE(year_id, 0) = COALESCE($4::bigint, 0)",
      params: [sc.scope, sc.cls.id, sc.term_id, sc.scope === "year" ? sc.year_id : null] });

export async function findBatch(q, sc, { lock = false } = {}) {
  const w = keyWhere(sc);
  const [b] = await q(`SELECT * FROM result_batches WHERE ${w.sql}${lock ? " FOR UPDATE" : ""}`, w.params);
  return b || null;
}
async function ensureBatch(q, sc, actor) {
  const found = await findBatch(q, sc, { lock: true });
  if (found) return found;
  const [b] = await q(
    `INSERT INTO result_batches (tenant_id, scope, class_id, term_id, year_id, course_id, prepared_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING *`,
    [sc.scope, sc.cls?.id ?? null, sc.term_id ?? null, sc.scope === "year" ? sc.year_id : null, sc.course_id ?? null, actor]);
  await event(q, b.id, "created", actor);
  return b;
}
const event = (q, batchId, action, actor, reason = null, meta = {}) => q(
  "INSERT INTO result_events (tenant_id, batch_id, action, actor, reason, meta) VALUES (app_tenant(), $1, $2, $3, $4, $5)",
  [batchId, action, actor, reason, JSON.stringify(meta)]);

const live = (q, sc) => (sc.scope === "course" ? courseResults(q, sc) : classResults(q, sc));
const checks = (q, sc) => (sc.scope === "course" ? courseChecks(q, sc) : classChecks(q, sc));

export async function overview(q, sc) {
  const b = await findBatch(q, sc);
  const issues = await checks(q, sc);
  const out = await live(q, sc);
  const students = sc.scope === "course"
    ? out.rows.map((r) => ({ id: r.student_id, enrollment_id: r.enrollment_id, name: r.name, status: r.status, result: r.result,
      final_score: r.final_score === null ? null : Number(r.final_score) }))
    : out.rows.map((r) => ({ id: r.card.student.id, name: r.card.student.name, percent: r.card.summary.percent, subjects: r.card.subjects.length,
      result: r.result, passed: r.passed, rank: r.card.rank?.position ?? null }));
  const events = b ? await q("SELECT action, actor, reason, created_at FROM result_events WHERE batch_id = $1 ORDER BY id", [b.id]) : [];
  const [certs] = b ? await q("SELECT count(*) FILTER (WHERE status = 'issued')::int AS issued FROM certificates WHERE batch_id = $1", [b.id]) : [{ issued: 0 }];
  const status = b?.status || "none";
  return {
    label: sc.label, status, status_label: STATUS[status],
    batch: b && { id: b.id, version: b.version, return_reason: b.return_reason, exception_reason: b.exception_reason, reopened: b.reopened,
      prepared_by: b.prepared_by, submitted_by: b.submitted_by, submitted_at: b.submitted_at, reviewed_by: b.reviewed_by, reviewed_at: b.reviewed_at,
      approved_by: b.approved_by, approved_at: b.approved_at },
    // Approved, and the live results are still exactly what was approved.
    ready: status === "approved" && b.snapshot_hash === out.hash,
    errors: issues.filter((i) => i.level === "error"), warnings: issues.filter((i) => i.level === "warning"),
    students, events: events.map((e) => ({ ...e, label: ACTIONS[e.action] })), certificates_issued: certs.issued,
    pass_mark: out.settings?.pass_mark ?? null,
  };
}

export const reasonSchema = z.object({ reason: t.shortText("السبب", 300) });
export const approveSchema = z.object({ allow_incomplete: z.boolean().default(false), reason: t.optText(300) });

export async function submit(q, sc, actor) {
  const b = await ensureBatch(q, sc, actor);
  if (!["draft", "returned"].includes(b.status)) throw conflict(b.status === "review" ? "النتائج قيد المراجعة بالفعل" : "النتائج معتمدة. أعد فتحها أولًا لتعديلها.");
  await q("UPDATE result_batches SET status = 'review', submitted_by = $2, submitted_at = now(), return_reason = NULL WHERE id = $1", [b.id, actor]);
  await event(q, b.id, "submitted", actor);
  return { status: "review" };
}

export async function sendBack(q, sc, actor, reason) {
  const b = await findBatch(q, sc, { lock: true });
  if (b?.status !== "review") throw conflict("لا توجد نتائج قيد المراجعة لإعادتها");
  await q("UPDATE result_batches SET status = 'returned', return_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1", [b.id, reason, actor]);
  await event(q, b.id, "returned", actor, reason);
  return { status: "returned" };
}

export async function approve(q, sc, actor, { allow_incomplete = false, reason = null } = {}) {
  const b = await findBatch(q, sc, { lock: true });
  if (b?.status !== "review") throw conflict("اعتماد النتائج يكون بعد إرسالها للمراجعة");
  const issues = (await checks(q, sc)).filter((i) => i.level === "error");
  if (issues.length && !allow_incomplete) {
    throw badRequest(`لا يمكن الاعتماد: ${issues.length} ملاحظة تمنع الاعتماد. راجع القائمة أو اعتمد باستثناء مع ذكر السبب.`, { errors: issues.slice(0, 50) });
  }
  if (issues.length && !(reason && reason.trim().length >= 5)) throw badRequest("اكتب سبب اعتماد نتائج غير مكتملة");
  const out = await live(q, sc);
  await q(`UPDATE result_batches SET status = 'approved', snapshot = $2, snapshot_hash = $3, approved_by = $4, approved_at = now(),
                  reviewed_by = COALESCE(reviewed_by, $4), reviewed_at = COALESCE(reviewed_at, now()), reopened = false,
                  exception_reason = $5, version = version + 1 WHERE id = $1`,
  [b.id, JSON.stringify(out.snapshot), out.hash, actor, issues.length ? reason : null]);
  await event(q, b.id, "approved", actor, issues.length ? `اعتماد باستثناء: ${reason}` : null, { incomplete: issues.length });
  return { status: "approved" };
}

export async function reopen(q, sc, actor, reason) {
  const b = await findBatch(q, sc, { lock: true });
  if (b?.status !== "approved") throw conflict("النتائج غير معتمدة");
  await q("UPDATE result_batches SET status = 'review', reopened = true, approved_by = NULL, approved_at = NULL WHERE id = $1", [b.id]);
  await event(q, b.id, "reopened", actor, reason);
  return { status: "review" };
}

// For issuing: the approved result, after checking it still matches the live results. A mismatch (a change the
// triggers cannot see, e.g. grade weights) sends it back to review rather than issuing different numbers; the
// caller reports it after the transaction commits, so the return to review is kept.
export const STALE = "تغيّرت النتائج بعد الاعتماد فأُعيدت للمراجعة. راجعها واعتمدها من جديد ثم أصدر الشهادات.";
export async function approvedResults(q, sc) {
  const b = await findBatch(q, sc, { lock: true });
  if (b?.status !== "approved") throw conflict("اعتمد النتائج أولًا من «اعتماد النتائج» قبل إصدار الشهادات.");
  const out = await live(q, sc);
  if (out.hash !== b.snapshot_hash) {
    await q("UPDATE result_batches SET status = 'review', reopened = true, approved_by = NULL, approved_at = NULL WHERE id = $1", [b.id]);
    await event(q, b.id, "changed", "النظام", "تغيّرت النتائج بعد الاعتماد");
    return { stale: true };
  }
  return { batch: b, ...out };
}
export const issuedEvent = (q, batchId, actor, count) => event(q, batchId, "issued", actor, null, { count });
