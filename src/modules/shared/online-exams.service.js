/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
//
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, forbidden, conflict } from "../../core/http/errors.js";
import { getFor } from "./exam-papers.service.js";
import { notify } from "./notify.service.js";
import { resolveForExam } from "./grade-components.service.js";
import * as media from "./exam-media.service.js";

const AUTO = new Set(["mcq", "multi", "truefalse", "fill", "match", "order"]);
const GRACE_MS = 60_000;
const r2 = (n) => Math.round(n * 100) / 100;

export const publishSchema = z.object({
  paper_id: t.id,
  class_id: t.optId,
  title: z.string().trim().min(2).max(150).optional(),
  opens_at: z.coerce.date(),
  closes_at: z.coerce.date(),
  duration_min: z.coerce.number().int().min(1).max(600),
  shuffle: z.boolean().default(true),
  show_result: z.enum(["none", "score", "answers"]).default("score"),
  link_exam: z.boolean().default(true),
  layout: z.enum(["one", "section", "all"]).default("one"),
  no_back: z.boolean().default(false),
  access_code: z.string().trim().regex(/^[0-9A-Za-z]{3,12}$/, "رمز الدخول من 3 إلى 12 حرفًا إنجليزيًا أو رقمًا").optional().or(z.literal("")),
  max_leaves: z.coerce.number().int().min(0).max(20).default(0),
});

// How the exam is taken: one question per page, one section per page, or all on one page; going back allowed or not;
// a code given in class to enter; and how many times the student may leave the exam page before it is submitted.
const settingsOf = (b) => ({ layout: b.layout || "one", no_back: !!b.no_back, access_code: b.access_code ? String(b.access_code).toUpperCase() : null,
  max_leaves: Number(b.max_leaves) || 0 });
const publicSettings = (st = {}) => ({ layout: st.layout || "all", no_back: !!st.no_back, needs_code: !!st.access_code, max_leaves: Number(st.max_leaves) || 0 });

// The pages a student sees, in their own order (the same order studentContent gives them).
export function pagesOf(content, layout) {
  const sections = (content.sections || []).filter((sec) => (sec.questions || []).length);
  if (layout === "all") return [sections.flatMap((sec) => sec.questions.map((q) => q.id))];
  if (layout === "section") return sections.map((sec) => sec.questions.map((q) => q.id));
  return sections.flatMap((sec) => sec.questions.map((q) => [q.id]));
}

const questionsOf = (content) => (content.sections || []).flatMap((s) => s.questions || []);
function seeded(seed) {
  let s = parseInt(crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 8), 16) || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
function shuffle(arr, rnd) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const token = (attemptId, id) => crypto.createHash("sha256").update(`${attemptId}:${id}`).digest("base64url").slice(0, 10);
export const normAr = (s) => String(s ?? "").trim().toLowerCase()
  .replace(/[ً-ْـ]/g, "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");

export function studentContent(content, attemptId, doShuffle) {
  const rnd = seeded(`${attemptId}`);
  return {
    sections: (content.sections || []).map((s) => {
      let qs = (s.questions || []).map((q) => {
        const { correct, answers, answer, solution, notes, bank_id, ...rest } = q;
        void correct; void answers; void answer; void solution; void notes; void bank_id;
        const out = { ...rest };
        if (q.options && doShuffle) out.options = shuffle(q.options, rnd);
        if (q.type === "match") {
          out.left = (q.pairs || []).map((p) => ({ id: p.id, text: p.left }));
          out.right = shuffle((q.pairs || []).map((p) => ({ id: token(attemptId, p.id), text: p.right })), rnd);
          delete out.pairs;
        }
        if (q.type === "order") out.items = shuffle(q.items || [], rnd);
        if (q.type === "fill") out.blanks = Math.max(1, (String(q.text || "").match(/_{3,}/g) || []).length);
        return out;
      });
      if (doShuffle) qs = shuffle(qs, rnd);
      return { id: s.id, title: s.title, instructions: s.instructions, questions: qs };
    }),
  };
}

export function gradeQuestion(q, ans, attemptId) {
  const m = Number(q.marks || 0);
  if (!AUTO.has(q.type)) return null;
  if (ans === undefined || ans === null || ans === "") return 0;
  switch (q.type) {
    case "mcq": return Array.isArray(q.correct) && q.correct[0] === ans ? m : 0;
    case "truefalse": return typeof q.correct === "boolean" && q.correct === ans ? m : 0;
    case "multi": {
      const right = new Set(q.correct || []);
      const picked = new Set(Array.isArray(ans) ? ans : []);
      if (!right.size) return 0;
      const hit = [...picked].filter((x) => right.has(x)).length;
      const wrong = [...picked].filter((x) => !right.has(x)).length;
      return r2(m * Math.max(0, (hit - wrong) / right.size));
    }
    case "fill": {
      const want = q.answers || [];
      if (!want.length) return null;
      const got = Array.isArray(ans) ? ans : [ans];
      const ok = want.filter((w, i) => String(w).split("/").map(normAr).filter(Boolean).includes(normAr(got[i]))).length;
      return r2(m * (ok / want.length));
    }
    case "match": {
      const pairs = q.pairs || [];
      if (!pairs.length || typeof ans !== "object") return 0;
      const ok = pairs.filter((p) => ans[p.id] === token(attemptId, p.id)).length;
      return r2(m * (ok / pairs.length));
    }
    case "order": {
      const items = (q.items || []).map((i) => i.id);
      if (!items.length || !Array.isArray(ans)) return 0;
      const ok = items.filter((id, i) => ans[i] === id).length;
      return r2(m * (ok / items.length));
    }
    default: return null;
  }
}

export function gradeAttempt(content, answers, attemptId, manual = {}) {
  const marks = {};
  let auto = 0, total = 0, pending = false;
  for (const q of questionsOf(content)) {
    const a = gradeQuestion(q, answers?.[q.id], attemptId);
    if (manual[q.id] !== undefined && manual[q.id] !== null) marks[q.id] = Math.min(Number(q.marks), Math.max(0, Number(manual[q.id])));
    else if (a === null) { pending = true; continue; }
    else marks[q.id] = a;
    if (a !== null) auto += a;
    total += marks[q.id];
  }
  return { marks, auto_score: r2(auto), score: r2(total), needs_grading: pending };
}

export async function publish(q, who, b, actor) {
  const { paper } = await getFor(q, who, b.paper_id);
  if (!["approved", "printed"].includes(paper.status)) throw badRequest("اعتمد الاختبار أولًا ثم انشره إلكترونيًا");
  const classId = b.class_id || paper.class_id;
  if (!classId) throw badRequest("اختر الشعبة");
  if (who.role === "teacher") {
    const [ok] = await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3", [who.teacherId, classId, paper.subject_id]);
    if (!ok) throw forbidden("هذه الشعبة أو المادة غير مسندة لك");
  }
  const qs = questionsOf(paper.content);
  if (!qs.length) throw badRequest("الاختبار بلا أسئلة");
  if (b.closes_at <= b.opens_at) throw badRequest("موعد الإغلاق يجب أن يكون بعد موعد الفتح");
  if (b.closes_at <= new Date()) throw badRequest("موعد الإغلاق مضى");
  const max = r2(qs.reduce((a, x) => a + Number(x.marks || 0), 0));
  const title = b.title || paper.title;
  let examId = null;
  if (b.link_exam) {
    const component = await resolveForExam(q, classId, null);
    const [e] = await q(`INSERT INTO exams (tenant_id, class_id, subject_id, title, exam_date, max_score, created_by, component_id)
      VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [classId, paper.subject_id, `${title} (إلكتروني)`, b.opens_at.toISOString().slice(0, 10), Math.ceil(max * 4) / 4, actor, component]);
    examId = e.id;
  }
  const [row] = await q(
    `INSERT INTO online_exams (tenant_id, paper_id, class_id, subject_id, exam_id, teacher_id, title, instructions, content, max_score,
       opens_at, closes_at, duration_min, shuffle, show_result, created_by, settings)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [paper.id, classId, paper.subject_id, examId, who.role === "teacher" ? who.teacherId : paper.teacher_id, title, paper.instructions || null,
      JSON.stringify(paper.content), max, b.opens_at, b.closes_at, b.duration_min, b.shuffle, b.show_result, actor, JSON.stringify(settingsOf(b))]);
  const students = await q("SELECT id FROM students WHERE class_id = $1 AND archived_at IS NULL", [classId]);
  await notify(q, { event: "online_exam", students: students.map((s) => s.id), title: `اختبار إلكتروني: ${title}`,
    body: `يفتح ${b.opens_at.toISOString().slice(0, 16).replace("T", " ")} — المدة ${b.duration_min} دقيقة`, link: "online-exams" });
  return { id: row.id, exam_id: examId, max_score: max };
}

async function own(q, who, id) {
  const [x] = await q("SELECT * FROM online_exams WHERE id = $1", [id]);
  if (!x || (who.role === "teacher" && Number(x.teacher_id) !== Number(who.teacherId))) throw notFound("الاختبار غير موجود");
  return x;
}

export const list = (q, who) => q(
  `SELECT o.id, o.title, o.class_id, c.name AS class_name, s.name AS subject, o.opens_at, o.closes_at, o.duration_min, o.max_score,
          o.status, o.show_result, o.exam_id, o.created_by,
          (SELECT count(*) FROM online_attempts a WHERE a.online_exam_id = o.id)::int AS started,
          (SELECT count(*) FROM online_attempts a WHERE a.online_exam_id = o.id AND a.submitted_at IS NOT NULL)::int AS submitted,
          (SELECT count(*) FROM online_attempts a WHERE a.online_exam_id = o.id AND a.needs_grading)::int AS to_grade,
          (SELECT count(*) FROM students st WHERE st.class_id = o.class_id AND st.archived_at IS NULL)::int AS class_size
     FROM online_exams o JOIN classes c ON c.id = o.class_id JOIN subjects s ON s.id = o.subject_id
    WHERE ($1::bigint IS NULL OR o.teacher_id = $1) ORDER BY o.opens_at DESC LIMIT 300`,
  [who.role === "teacher" ? who.teacherId : null]);

export async function results(q, who, id) {
  const x = await own(q, who, id);
  await closeExpired(q, x.id);
  const rows = await q(
    `SELECT st.id AS student_id, st.full_name AS name, a.id AS attempt_id, a.started_at, a.submitted_at, a.deadline_at,
            a.score, a.auto_score, a.needs_grading, a.events,
            (SELECT count(*) FROM jsonb_object_keys(COALESCE(a.answers, '{}'))) ::int AS answered
       FROM students st LEFT JOIN online_attempts a ON a.student_id = st.id AND a.online_exam_id = $1
      WHERE st.class_id = $2 AND st.archived_at IS NULL ORDER BY st.full_name`, [x.id, x.class_id]);
  const { content, ...meta } = x;
  const attempts = await q("SELECT id, answers, marks FROM online_attempts WHERE online_exam_id = $1 AND submitted_at IS NOT NULL", [x.id]);
  return { exam: { ...meta, question_count: questionsOf(content).length }, students: rows, analysis: analysis(content, attempts) };
}

// How each question went: how many answered it, the average mark, how many got it fully right, and for a choice
// question how often each option was picked. Shows the teacher which questions were hard or unclear.
export function analysis(content, attempts) {
  return questionsOf(content).map((qq, i) => {
    const marks = attempts.map((a) => a.marks?.[qq.id]).filter((m) => m !== undefined && m !== null).map(Number);
    const answeredN = attempts.filter((a) => a.answers?.[qq.id] !== undefined && a.answers?.[qq.id] !== null && a.answers?.[qq.id] !== "").length;
    const full = marks.filter((m) => m >= Number(qq.marks || 0) && Number(qq.marks || 0) > 0).length;
    const out = { n: i + 1, id: qq.id, type: qq.type, text: String(qq.text || "").replace(/\s+/g, " ").slice(0, 140), marks: Number(qq.marks || 0),
      attempts: attempts.length, answered: answeredN, graded: marks.length,
      avg: marks.length ? r2(marks.reduce((x, y) => x + y, 0) / marks.length) : null,
      right_pct: marks.length ? Math.round((full / marks.length) * 100) : null };
    if (qq.type === "mcq" || qq.type === "multi") {
      out.options = (qq.options || []).map((o) => ({ text: String(o.text || "").slice(0, 80), correct: (qq.correct || []).includes(o.id),
        picked: attempts.filter((a) => [].concat(a.answers?.[qq.id] ?? []).includes(o.id)).length }));
    }
    if (qq.type === "truefalse") {
      out.options = [true, false].map((v) => ({ text: v ? "صح" : "خطأ", correct: qq.correct === v, picked: attempts.filter((a) => a.answers?.[qq.id] === v).length }));
    }
    return out;
  });
}

// The teacher adjusts an open exam: a later closing time, or how it is taken.
export const updateSchema = z.object({
  closes_at: z.coerce.date().optional(),
  layout: z.enum(["one", "section", "all"]).optional(),
  no_back: z.boolean().optional(),
  access_code: z.string().trim().regex(/^[0-9A-Za-z]{3,12}$/, "رمز الدخول من 3 إلى 12 حرفًا إنجليزيًا أو رقمًا").optional().or(z.literal("")),
  max_leaves: z.coerce.number().int().min(0).max(20).optional(),
  show_result: z.enum(["none", "score", "answers"]).optional(),
});
export async function update(q, who, id, b) {
  const x = await own(q, who, id);
  if (b.closes_at && b.closes_at <= new Date(x.opens_at)) throw badRequest("موعد الإغلاق يجب أن يكون بعد موعد الفتح");
  const st = { ...(x.settings || {}) };
  for (const k of ["layout", "no_back", "max_leaves"]) if (b[k] !== undefined) st[k] = b[k];
  if (b.access_code !== undefined) st.access_code = b.access_code ? b.access_code.toUpperCase() : null;
  const reopen = b.closes_at && b.closes_at > new Date();
  await q(`UPDATE online_exams SET settings = $2, closes_at = COALESCE($3, closes_at), show_result = COALESCE($4, show_result),
             status = CASE WHEN $5 AND status = 'closed' THEN 'open' ELSE status END WHERE id = $1`,
    [x.id, JSON.stringify(st), b.closes_at || null, b.show_result || null, !!reopen]);
  return { ok: true };
}

// More time for one student (a late start, a weak connection), or another chance for a student whose attempt ended:
// the attempt reopens with the answers it had, until the new deadline.
export const extendSchema = z.object({ minutes: z.coerce.number().int().min(1).max(240) });
export async function extend(q, who, id, attemptId, minutes) {
  const x = await own(q, who, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE id = $1 AND online_exam_id = $2 FOR UPDATE", [attemptId, x.id]);
  if (!a) throw notFound("المحاولة غير موجودة");
  const base = a.submitted_at || new Date(a.deadline_at) < new Date() ? new Date() : new Date(a.deadline_at);
  const deadline = new Date(base.getTime() + minutes * 60_000);
  const events = { ...(a.events || {}), extra_min: (Number(a.events?.extra_min) || 0) + minutes, leaves: 0 };
  await q(`UPDATE online_attempts SET deadline_at = $2, submitted_at = NULL, events = $3 WHERE id = $1`, [a.id, deadline, JSON.stringify(events)]);
  return { deadline_at: deadline, reopened: !!a.submitted_at };
}

// A fresh start for a student (the attempt and its files are removed). Only when the exam is still open.
export async function resetAttempt(q, who, id, attemptId) {
  const x = await own(q, who, id);
  if (x.status !== "open" || new Date(x.closes_at) < new Date()) throw badRequest("الاختبار مغلق. مدّد موعد الإغلاق أولًا");
  const [a] = await q("DELETE FROM online_attempts WHERE id = $1 AND online_exam_id = $2 RETURNING id", [attemptId, x.id]);
  if (!a) throw notFound("المحاولة غير موجودة");
  return { ok: true };
}

export async function attemptDetail(q, who, id, attemptId) {
  const x = await own(q, who, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE id = $1 AND online_exam_id = $2", [attemptId, x.id]);
  if (!a) throw notFound("المحاولة غير موجودة");
  const [st] = await q("SELECT full_name FROM students WHERE id = $1", [a.student_id]);
  return { student: st?.full_name, attempt: a, questions: reviewQuestions(x.content, a, true, await media.answerFilesOf(q, a.id)) };
}

// The photo or recording a student answered a question with, for the teacher who grades it.
export async function attemptFile(q, who, id, attemptId, questionId) {
  const x = await own(q, who, id);
  const [a] = await q("SELECT id FROM online_attempts WHERE id = $1 AND online_exam_id = $2", [attemptId, x.id]);
  if (!a) throw notFound("المحاولة غير موجودة");
  return media.readAnswerFile(q, a.id, questionId);
}

// The clips and pictures inside a published exam, for the teacher reviewing answers.
export async function examAsset(q, who, id, kind, assetId) {
  const x = await own(q, who, id);
  return assetOf(q, x, kind, assetId);
}

const usesImage = (content, imageId) => questionsOf(content).some((qq) => Number(qq.image?.id) === Number(imageId)
  || (qq.options || []).some((o) => Number(o.image?.id) === Number(imageId)));
const usesMedia = (content, mediaId) => questionsOf(content).some((qq) => Number(qq.media?.id) === Number(mediaId));

async function assetOf(q, x, kind, assetId) {
  if (kind === "media") {
    if (!usesMedia(x.content, assetId)) throw notFound("الملف غير موجود");
    return media.readMedia(q, assetId);
  }
  if (!usesImage(x.content, assetId)) throw notFound("الصورة غير موجودة");
  const [img] = await q("SELECT mime, data FROM exam_images WHERE id = $1", [assetId]);
  if (!img) throw notFound("الصورة غير موجودة");
  return img;
}

function reviewQuestions(content, a, withKey, files = new Set()) {
  return questionsOf(content).map((qq) => {
    const out = { id: qq.id, type: qq.type, text: qq.text, marks: qq.marks, options: qq.options, items: qq.items, table: qq.table, image: qq.image,
      media: qq.media || null, respond: qq.respond || "text", file: files.has(qq.id),
      answer: a.answers?.[qq.id] ?? null, mark: a.marks?.[qq.id] ?? null, auto: AUTO.has(qq.type) };
    if (qq.type === "match") {
      out.left = (qq.pairs || []).map((p) => ({ id: p.id, text: p.left }));
      out.right = (qq.pairs || []).map((p) => ({ id: token(a.id, p.id), text: p.right }));
    }
    if (withKey) Object.assign(out, { correct: qq.correct, answers: qq.answers, model: qq.answer || qq.solution || null,
      key_pairs: qq.type === "match" ? Object.fromEntries((qq.pairs || []).map((p) => [p.id, token(a.id, p.id)])) : undefined });
    return out;
  });
}

export const marksSchema = z.object({ marks: z.record(z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/), z.coerce.number().min(0).max(1000).nullable()) });
export async function setMarks(q, who, id, attemptId, manual, actor) {
  const x = await own(q, who, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE id = $1 AND online_exam_id = $2", [attemptId, x.id]);
  if (!a) throw notFound("المحاولة غير موجودة");
  if (!a.submitted_at) throw badRequest("لم يسلّم الطالب بعد");
  const prevManual = Object.fromEntries(Object.entries(a.marks || {}).filter(([k]) => !AUTO.has(questionsOf(x.content).find((qq) => qq.id === k)?.type)));
  const g = gradeAttempt(x.content, a.answers, a.id, { ...prevManual, ...manual });
  await q(`UPDATE online_attempts SET marks = $2, auto_score = $3, score = $4, needs_grading = $5, graded_at = now(), graded_by = $6 WHERE id = $1`,
    [a.id, JSON.stringify(g.marks), g.auto_score, g.score, g.needs_grading, actor]);
  if (!g.needs_grading && x.show_result !== "none") await resultNotice(q, x, a.student_id, g.score);
  return g;
}

async function resultNotice(q, x, studentId, score) {
  await notify(q, { event: "exam_result", students: [studentId], title: `نتيجة اختبار: ${x.title}`,
    body: `الدرجة ${score} من ${x.max_score}`, link: "online-exams", dedupKey: `oe-${x.id}`, dedupMinutes: 60 * 24 * 30 });
}

export async function syncScores(q, who, id, actor) {
  const x = await own(q, who, id);
  if (!x.exam_id) throw badRequest("هذا الاختبار غير مرتبط بالرصد");
  const [e] = await q("SELECT status, max_score FROM exams WHERE id = $1", [x.exam_id]);
  if (!e) throw badRequest("اختبار الرصد حُذف");
  if (e.status !== "draft") throw conflict("اختبار الرصد مرفوع أو منشور. أعده لمسودة لتعديل الدرجات.");
  const rows = await q("SELECT student_id, score FROM online_attempts WHERE online_exam_id = $1 AND submitted_at IS NOT NULL AND NOT needs_grading", [x.id]);
  for (const r of rows) {
    await q(`INSERT INTO scores (tenant_id, exam_id, student_id, score, updated_by) VALUES (app_tenant(), $1, $2, $3, $4)
             ON CONFLICT (exam_id, student_id) DO UPDATE SET score = EXCLUDED.score, updated_by = EXCLUDED.updated_by`,
      [x.exam_id, r.student_id, Math.min(Number(r.score), Number(e.max_score)), actor]);
  }
  const [{ n }] = await q("SELECT count(*)::int AS n FROM online_attempts WHERE online_exam_id = $1 AND needs_grading", [x.id]);
  return { synced: rows.length, waiting: n };
}

export async function close(q, who, id) {
  const x = await own(q, who, id);
  await q("UPDATE online_exams SET closes_at = LEAST(closes_at, now()), status = 'closed' WHERE id = $1", [x.id]);
  await closeExpired(q, x.id, true);
}

export async function remove(q, who, id) {
  const x = await own(q, who, id);
  const [used] = await q("SELECT 1 FROM online_attempts WHERE online_exam_id = $1 LIMIT 1", [x.id]);
  if (used) throw conflict("بدأ طلاب الاختبار، فلا يُحذف. يمكنك إغلاقه.");
  await q("DELETE FROM online_exams WHERE id = $1", [x.id]);
  if (x.exam_id) await q("DELETE FROM exams WHERE id = $1 AND status = 'draft' AND NOT EXISTS (SELECT 1 FROM scores WHERE exam_id = $1)", [x.exam_id]);
}

async function closeExpired(q, onlineExamId, force = false) {
  const [x] = await q("SELECT content FROM online_exams WHERE id = $1", [onlineExamId]);
  const open = await q(`SELECT * FROM online_attempts WHERE online_exam_id = $1 AND submitted_at IS NULL
                         AND ($2 OR deadline_at + interval '60 seconds' < now())`, [onlineExamId, force]);
  for (const a of open) {
    const g = gradeAttempt(x.content, a.answers, a.id);
    await q(`UPDATE online_attempts SET submitted_at = LEAST(now(), deadline_at), marks = $2, auto_score = $3, score = $4, needs_grading = $5 WHERE id = $1`,
      [a.id, JSON.stringify(g.marks), g.auto_score, g.score, g.needs_grading]);
  }
}

export async function forStudent(q, s) {
  const rows = await q(
    `SELECT o.id, o.title, sub.name AS subject, o.opens_at, o.closes_at, o.duration_min, o.max_score, o.show_result, o.status,
            a.id AS attempt_id, a.started_at, a.submitted_at, a.deadline_at, a.score, a.needs_grading, o.settings, o.instructions,
            (SELECT count(*) FROM jsonb_path_query(o.content, '$.sections[*].questions[*]'))::int AS question_count
       FROM online_exams o JOIN subjects sub ON sub.id = o.subject_id
       LEFT JOIN online_attempts a ON a.online_exam_id = o.id AND a.student_id = $1
      WHERE o.class_id = $2 AND o.opens_at > now() - interval '120 days' ORDER BY o.opens_at DESC LIMIT 50`, [s.id, s.class_id]);
  const now = Date.now();
  return rows.map((r) => {
    const state = r.submitted_at || (r.attempt_id && new Date(r.deadline_at).getTime() + GRACE_MS < now) ? "done"
      : r.attempt_id ? "in_progress" : now < new Date(r.opens_at).getTime() ? "upcoming"
        : now > new Date(r.closes_at).getTime() || r.status !== "open" ? "missed" : "open";
    const showScore = state === "done" && r.show_result !== "none" && !r.needs_grading;
    return { id: r.id, title: r.title, subject: r.subject, opens_at: r.opens_at, closes_at: r.closes_at, duration_min: r.duration_min,
      max_score: r.max_score, state, question_count: r.question_count, instructions: r.instructions, settings: publicSettings(r.settings),
      show_result: r.show_result, deadline_at: state === "in_progress" ? r.deadline_at : null, score: showScore ? r.score : null, pending: state === "done" && r.needs_grading,
      can_review: state === "done" && r.show_result === "answers" && (now > new Date(r.closes_at).getTime() || r.status !== "open") };
  });
}

async function studentExam(q, s, id) {
  const [x] = await q("SELECT * FROM online_exams WHERE id = $1 AND class_id = $2", [id, s.class_id]);
  if (!x) throw notFound("الاختبار غير موجود");
  return x;
}

export async function start(q, s, id, ip, code) {
  const x = await studentExam(q, s, id);
  const now = new Date();
  let [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2", [x.id, s.id]);
  if (!a) {
    if (now < new Date(x.opens_at)) throw badRequest("لم يبدأ الاختبار بعد");
    if (now > new Date(x.closes_at) || x.status !== "open") throw badRequest("انتهى وقت الاختبار");
    if (x.settings?.access_code && String(code || "").trim().toUpperCase() !== x.settings.access_code) {
      const e = badRequest(code ? "رمز الدخول غير صحيح. اطلبه من معلمك." : "اكتب رمز الدخول الذي أعطاك إياه المعلم");
      e.code = "access_code"; throw e;
    }
    const deadline = new Date(Math.min(now.getTime() + x.duration_min * 60_000, new Date(x.closes_at).getTime()));
    [a] = await q(`INSERT INTO online_attempts (tenant_id, online_exam_id, student_id, deadline_at, ip)
                   VALUES (app_tenant(), $1, $2, $3, $4) ON CONFLICT (online_exam_id, student_id) DO NOTHING RETURNING *`,
      [x.id, s.id, deadline, ip || null]);
    if (!a) [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2", [x.id, s.id]);
  }
  if (a.submitted_at || new Date(a.deadline_at).getTime() + GRACE_MS < now.getTime()) throw badRequest("سلّمت هذا الاختبار من قبل");
  return {
    attempt_id: a.id, title: x.title, instructions: x.instructions, max_score: x.max_score,
    deadline_at: a.deadline_at, server_now: now.toISOString(), answers: a.answers,
    content: studentContent(x.content, a.id, x.shuffle),
    settings: publicSettings(x.settings), events: { page: Number(a.events?.page) || 0, max_page: Number(a.events?.max_page) || 0,
      flags: a.events?.flags || [], leaves: Number(a.events?.leaves) || 0 },
  };
}

const answersSchema = z.record(z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/), z.any()).refine((v) => JSON.stringify(v).length <= 150000, "الإجابات طويلة جدًا");
export const saveSchema = z.object({ answers: answersSchema, page: z.coerce.number().int().min(0).max(500).optional(),
  flags: z.array(z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/)).max(300).optional() });

export async function save(q, s, id, incoming, { submit = false, page, flags } = {}) {
  const x = await studentExam(q, s, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2 FOR UPDATE", [x.id, s.id]);
  if (!a) throw badRequest("ابدأ الاختبار أولًا");
  if (a.submitted_at) throw badRequest("سلّمت هذا الاختبار من قبل");
  const late = Date.now() > new Date(a.deadline_at).getTime() + GRACE_MS;
  const ev = { ...(a.events || {}) };
  let answers = incoming;
  if (!late && page !== undefined) {
    const pages = pagesOf(studentContent(x.content, a.id, x.shuffle), x.settings?.layout || "all");
    const p = Math.min(page, Math.max(0, pages.length - 1));
    // Without going back, answers on pages the student already left stay as they were.
    if (x.settings?.no_back) {
      const passed = new Set(pages.slice(0, Number(ev.max_page) || 0).flat());
      answers = { ...incoming };
      for (const qid of passed) { if (a.answers?.[qid] !== undefined) answers[qid] = a.answers[qid]; else delete answers[qid]; }
    }
    ev.page = p; ev.max_page = Math.max(Number(ev.max_page) || 0, p);
  }
  if (flags) ev.flags = flags;
  const finalAnswers = late ? a.answers : answers;
  if (!late) await q("UPDATE online_attempts SET answers = $2, events = $3 WHERE id = $1", [a.id, JSON.stringify(answers), JSON.stringify(ev)]);
  if (!submit && !late) return { saved: true };
  const g = gradeAttempt(x.content, finalAnswers, a.id);
  await q(`UPDATE online_attempts SET submitted_at = now(), marks = $2, auto_score = $3, score = $4, needs_grading = $5 WHERE id = $1`,
    [a.id, JSON.stringify(g.marks), g.auto_score, g.score, g.needs_grading]);
  const showScore = x.show_result !== "none" && !g.needs_grading;
  if (showScore) await resultNotice(q, x, s.id, g.score);
  return { submitted: true, late, score: showScore ? g.score : null, max_score: x.max_score, pending: g.needs_grading };
}

export async function review(q, s, id) {
  const x = await studentExam(q, s, id);
  if (x.show_result !== "answers") throw forbidden("المدرسة لا تعرض الإجابات لهذا الاختبار");
  if (Date.now() < new Date(x.closes_at).getTime() && x.status === "open") throw badRequest("تظهر الإجابات بعد إغلاق الاختبار");
  const [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2 AND submitted_at IS NOT NULL", [x.id, s.id]);
  if (!a) throw notFound("لا توجد محاولة مسلّمة");
  return { title: x.title, score: a.needs_grading ? null : a.score, max_score: x.max_score,
    questions: reviewQuestions(x.content, a, true, await media.answerFilesOf(q, a.id)) };
}

export async function imageFor(q, s, id, imageId) {
  const x = await studentExam(q, s, id);
  const img = await assetOf(q, x, "image", imageId);
  return { src: `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}` };
}

// A question's sound or video clip, only while the student may still see the exam (taking it, or reviewing it after).
export async function mediaFor(q, s, id, mediaId) {
  const x = await studentExam(q, s, id);
  const [a] = await q("SELECT 1 FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2", [x.id, s.id]);
  if (!a) throw badRequest("ابدأ الاختبار أولًا");
  return assetOf(q, x, "media", mediaId);
}

// A photo of the solution or a voice recording, saved for one question while the attempt is open.
export async function answerFile(q, s, id, b) {
  const x = await studentExam(q, s, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2 FOR UPDATE", [x.id, s.id]);
  if (!a) throw badRequest("ابدأ الاختبار أولًا");
  if (a.submitted_at || Date.now() > new Date(a.deadline_at).getTime() + GRACE_MS) throw badRequest("انتهى وقت الاختبار");
  const question = questionsOf(x.content).find((qq) => qq.id === b.question_id);
  if (!question || !["image", "audio"].includes(question.respond)) throw badRequest("هذا السؤال لا يقبل ملفًا");
  const saved = await media.saveAnswerFile(q, a.id, question, b);
  const answers = { ...(a.answers || {}), [question.id]: { file: saved.kind } };
  await q("UPDATE online_attempts SET answers = $2 WHERE id = $1", [a.id, JSON.stringify(answers)]);
  return { saved: true, kind: saved.kind };
}

export async function myAnswerFile(q, s, id, questionId) {
  const x = await studentExam(q, s, id);
  const [a] = await q("SELECT id FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2", [x.id, s.id]);
  if (!a) throw notFound("لا يوجد ملف");
  return media.readAnswerFile(q, a.id, questionId);
}

// The student left the exam page (another app or tab). Counted for the teacher; past the school's limit the attempt is submitted.
export async function leave(q, s, id) {
  const x = await studentExam(q, s, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2 FOR UPDATE", [x.id, s.id]);
  if (!a || a.submitted_at) return { leaves: 0 };
  const ev = { ...(a.events || {}), leaves: (Number(a.events?.leaves) || 0) + 1, last_leave: new Date().toISOString() };
  await q("UPDATE online_attempts SET events = $2 WHERE id = $1", [a.id, JSON.stringify(ev)]);
  const max = Number(x.settings?.max_leaves) || 0;
  if (max && ev.leaves > max) {
    const r = await save(q, s, id, a.answers || {}, { submit: true });
    return { leaves: ev.leaves, max, submitted: true, result: r };
  }
  return { leaves: ev.leaves, max };
}
