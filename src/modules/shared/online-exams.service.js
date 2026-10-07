// الاختبارات الإلكترونية: نشر ورقة من مصمم الاختبارات، حل الطالب من جواله، تصحيح تلقائي، ورصد الدرجة
//
// الأمان:
//  • الإجابات الصحيحة لا تخرج من الخادم أثناء الاختبار (تُحذف من نسخة الطالب).
//  • ترتيب الأسئلة والخيارات يختلف لكل طالب، ومعرّفات عمود التوصيل مشفّرة لكل محاولة فلا تكشف الإجابة.
//  • الوقت يحسبه الخادم: موعد الانتهاء = أقرب الأمرين (بداية الطالب + المدة، أو موعد الإغلاق).
import crypto from "node:crypto";
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, forbidden, conflict } from "../../core/http/errors.js";
import { getFor } from "./exam-papers.service.js";
import { notify } from "./notify.service.js";
import { resolveForExam } from "./grade-components.service.js";

const AUTO = new Set(["mcq", "multi", "truefalse", "fill", "match", "order"]);
const GRACE_MS = 60_000;   // تأخر الشبكة عند التسليم
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
});

/* ---------- أدوات ---------- */
const questionsOf = (content) => (content.sections || []).flatMap((s) => s.questions || []);
// توزيع ثابت لكل محاولة (نفس الترتيب عند إعادة فتح الصفحة)
function seeded(seed) {
  let s = parseInt(crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 8), 16) || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
function shuffle(arr, rnd) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const token = (attemptId, id) => crypto.createHash("sha256").update(`${attemptId}:${id}`).digest("base64url").slice(0, 10);
// مقارنة نص الفراغ: بلا تشكيل ومع توحيد الهمزات والتاء المربوطة والمسافات
export const normAr = (s) => String(s ?? "").trim().toLowerCase()
  .replace(/[ً-ْـ]/g, "").replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");

/** نسخة الطالب: بلا إجابات، ومرتّبة لهذه المحاولة */
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

/** درجة سؤال واحد آليًا (null = يحتاج تصحيح المعلم) */
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
      // كل فراغ قد يقبل أكثر من إجابة مكتوبة بـ / مثل «الرياض / الرياض العاصمة»
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

/** تصحيح المحاولة كاملة: الدرجات الآلية + ما صححه المعلم يدويًا */
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

/* ---------- المعلم والإدارة ---------- */
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
    // الدرجة تُرصد على النوع الافتراضي في توزيع الدرجات (إن وُجد)
    const component = await resolveForExam(q, classId, null);
    const [e] = await q(`INSERT INTO exams (tenant_id, class_id, subject_id, title, exam_date, max_score, created_by, component_id)
      VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [classId, paper.subject_id, `${title} (إلكتروني)`, b.opens_at.toISOString().slice(0, 10), Math.ceil(max * 4) / 4, actor, component]);
    examId = e.id;
  }
  const [row] = await q(
    `INSERT INTO online_exams (tenant_id, paper_id, class_id, subject_id, exam_id, teacher_id, title, instructions, content, max_score,
       opens_at, closes_at, duration_min, shuffle, show_result, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [paper.id, classId, paper.subject_id, examId, who.role === "teacher" ? who.teacherId : paper.teacher_id, title, paper.instructions || null,
      JSON.stringify(paper.content), max, b.opens_at, b.closes_at, b.duration_min, b.shuffle, b.show_result, actor]);
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
            a.score, a.auto_score, a.needs_grading
       FROM students st LEFT JOIN online_attempts a ON a.student_id = st.id AND a.online_exam_id = $1
      WHERE st.class_id = $2 AND st.archived_at IS NULL ORDER BY st.full_name`, [x.id, x.class_id]);
  const { content, ...meta } = x;
  return { exam: { ...meta, question_count: questionsOf(content).length }, students: rows };
}

export async function attemptDetail(q, who, id, attemptId) {
  const x = await own(q, who, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE id = $1 AND online_exam_id = $2", [attemptId, x.id]);
  if (!a) throw notFound("المحاولة غير موجودة");
  const [st] = await q("SELECT full_name FROM students WHERE id = $1", [a.student_id]);
  return { student: st?.full_name, attempt: a, questions: reviewQuestions(x.content, a, true) };
}

// للمراجعة: السؤال، وإجابة الطالب، والصحيح، والدرجة
function reviewQuestions(content, a, withKey) {
  return questionsOf(content).map((qq) => {
    const out = { id: qq.id, type: qq.type, text: qq.text, marks: qq.marks, options: qq.options, items: qq.items, table: qq.table, image: qq.image,
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

// نتيجة الاختبار الإلكتروني لولي الأمر (مرة واحدة، وتُحدَّث إن عُدّل التصحيح)
async function resultNotice(q, x, studentId, score) {
  await notify(q, { event: "exam_result", students: [studentId], title: `نتيجة اختبار: ${x.title}`,
    body: `الدرجة ${score} من ${x.max_score}`, link: "online-exams", dedupKey: `oe-${x.id}`, dedupMinutes: 60 * 24 * 30 });
}

/** رصد الدرجات في اختبار «رصد الدرجات» المرتبط (ما دام مسودة) */
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

// المحاولات التي انتهى وقتها ولم تُسلَّم: تُسلَّم بما حُفظ منها
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

/* ---------- الطالب ---------- */
export async function forStudent(q, s) {
  const rows = await q(
    `SELECT o.id, o.title, sub.name AS subject, o.opens_at, o.closes_at, o.duration_min, o.max_score, o.show_result, o.status,
            a.id AS attempt_id, a.started_at, a.submitted_at, a.deadline_at, a.score, a.needs_grading
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
      max_score: r.max_score, state, score: showScore ? r.score : null, pending: state === "done" && r.needs_grading,
      can_review: state === "done" && r.show_result === "answers" && (now > new Date(r.closes_at).getTime() || r.status !== "open") };
  });
}

async function studentExam(q, s, id) {
  const [x] = await q("SELECT * FROM online_exams WHERE id = $1 AND class_id = $2", [id, s.class_id]);
  if (!x) throw notFound("الاختبار غير موجود");
  return x;
}

export async function start(q, s, id, ip) {
  const x = await studentExam(q, s, id);
  const now = new Date();
  let [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2", [x.id, s.id]);
  if (!a) {
    if (now < new Date(x.opens_at)) throw badRequest("لم يبدأ الاختبار بعد");
    if (now > new Date(x.closes_at) || x.status !== "open") throw badRequest("انتهى وقت الاختبار");
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
  };
}

const answersSchema = z.record(z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/), z.any()).refine((v) => JSON.stringify(v).length <= 150000, "الإجابات طويلة جدًا");
export const saveSchema = z.object({ answers: answersSchema });

export async function save(q, s, id, answers, { submit = false } = {}) {
  const x = await studentExam(q, s, id);
  const [a] = await q("SELECT * FROM online_attempts WHERE online_exam_id = $1 AND student_id = $2 FOR UPDATE", [x.id, s.id]);
  if (!a) throw badRequest("ابدأ الاختبار أولًا");
  if (a.submitted_at) throw badRequest("سلّمت هذا الاختبار من قبل");
  const late = Date.now() > new Date(a.deadline_at).getTime() + GRACE_MS;
  // بعد انتهاء الوقت: لا تُقبل إجابات جديدة، ويُسلَّم ما حُفظ
  const finalAnswers = late ? a.answers : answers;
  if (!late) await q("UPDATE online_attempts SET answers = $2 WHERE id = $1", [a.id, JSON.stringify(answers)]);
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
  return { title: x.title, score: a.needs_grading ? null : a.score, max_score: x.max_score, questions: reviewQuestions(x.content, a, true) };
}

/** صورة سؤال داخل اختبار الطالب فقط */
export async function imageFor(q, s, id, imageId) {
  const x = await studentExam(q, s, id);
  const used = questionsOf(x.content).some((qq) => Number(qq.image?.id) === Number(imageId));
  if (!used) throw notFound("الصورة غير موجودة");
  const [img] = await q("SELECT mime, data FROM exam_images WHERE id = $1", [imageId]);
  if (!img) throw notFound("الصورة غير موجودة");
  return { src: `data:${img.mime};base64,${Buffer.from(img.data).toString("base64")}` };
}
