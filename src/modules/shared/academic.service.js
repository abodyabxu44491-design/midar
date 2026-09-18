// السنة الدراسية والفصول الدراسية، وبدء سنة جديدة
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";

export const yearSchema = z.object({
  name: t.shortText("اسم السنة", 40),
  start_date: t.date,
  end_date: t.date,
  terms: z.coerce.number().int().min(2).max(3).default(2),
  make_current: z.boolean().default(true),
});
export const termSchema = z.object({
  name: t.shortText("اسم الفصل", 40),
  start_date: t.date,
  end_date: t.date,
});
export const ACTIONS = ["promote", "repeat", "graduate", "transfer", "withdraw"];
export const ACTION_LABEL = {
  promote: "ترفيع للصف التالي", repeat: "إعادة السنة", graduate: "تخرّج",
  transfer: "نقل لمدرسة أخرى", withdraw: "انسحاب",
};
// نتيجة السنة ← الإجراء المقترح
const RESULT_OF_ACTION = { promote: "promoted", repeat: "repeated", graduate: "graduated", transfer: "transferred", withdraw: "withdrawn" };
const STATUS_OF_ACTION = { promote: "active", repeat: "active", graduate: "graduated", transfer: "transferred", withdraw: "withdrawn" };

export const rolloverSchema = z.object({
  year: yearSchema,
  // خريطة الصفوف: إلى أي صف يُرفَّع كل صف (أو تخرّج طلابه)
  moves: z.array(z.object({
    from_class_id: t.id,
    action: z.enum(["promote", "graduate", "repeat"]).default("promote"),
    to_class_id: t.optId,
  })).max(200).default([]),
  // استثناءات لطلاب بأعينهم (تتقدم على خريطة الصف)
  overrides: z.array(z.object({
    student_id: t.id,
    action: z.enum(ACTIONS),
    to_class_id: t.optId,
    note: t.optText(300),
  })).max(2000).default([]),
  // الراسب يعيد السنة تلقائيًا ولا يُرفَّع
  repeat_failed: z.boolean().default(true),
});

export const passMarkSchema = z.object({ pass_mark: z.coerce.number().min(0).max(100) });

export const listYears = (q) => q(
  `SELECT y.id, y.name, y.start_date, y.end_date, y.is_current, y.status, y.pass_mark,
          (SELECT count(*) FROM student_years sy WHERE sy.year_id = y.id)::int AS archived_students
     FROM academic_years y ORDER BY y.start_date DESC`);

export const listTerms = (q, yearId = null) => q(
  `SELECT t.id, t.year_id, t.name, t.ordinal, t.start_date, t.end_date, t.is_current, y.name AS year_name, y.is_current AS year_current
     FROM terms t JOIN academic_years y ON y.id = t.year_id
    WHERE ($1::bigint IS NULL OR t.year_id = $1) ORDER BY y.start_date DESC, t.ordinal`, [yearId]);

// كل مدرسة جديدة تبدأ بسنة دراسية وثلاثة فصول جاهزة (تُنشأ عند أول استخدام)
export async function ensureDefaults(q) {
  const [exists] = await q("SELECT 1 FROM academic_years LIMIT 1");
  if (exists) return;
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;   // السنة تبدأ في أغسطس
  const start = `${startYear}-08-01`;
  const end = `${startYear + 1}-06-30`;
  await createYear(q, { name: `${startYear}/${startYear + 1}`, start_date: start, end_date: end, terms: 3, make_current: true });
}

export async function current(q) {
  const [row] = await q(
    `SELECT y.id AS year_id, y.name AS year_name, y.start_date AS year_start, y.end_date AS year_end,
            t.id AS term_id, t.name AS term_name, t.ordinal, t.start_date AS term_start, t.end_date AS term_end
       FROM academic_years y LEFT JOIN terms t ON t.year_id = y.id AND t.is_current
      WHERE y.is_current`);
  return row || null;
}

const TERM_NAMES = ["الفصل الأول", "الفصل الثاني", "الفصل الثالث"];

// إنشاء سنة وفصولها بتواريخ موزعة تلقائيًا
export async function createYear(q, b) {
  if (b.end_date <= b.start_date) throw badRequest("نهاية السنة يجب أن تكون بعد بدايتها");
  const [dup] = await q("SELECT 1 FROM academic_years WHERE name = $1", [b.name]);
  if (dup) throw conflict("يوجد سنة بنفس الاسم");
  if (b.make_current) await q("UPDATE academic_years SET is_current = false WHERE is_current");
  const [year] = await q(
    `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current)
     VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id`, [b.name, b.start_date, b.end_date, b.make_current]);

  // تقسيم مدة السنة على عدد الفصول بالتساوي
  const start = new Date(b.start_date), end = new Date(b.end_date);
  const span = (end - start) / b.terms;
  for (let i = 0; i < b.terms; i++) {
    const s = new Date(start.getTime() + span * i);
    const e = new Date(start.getTime() + span * (i + 1) - 86400000);
    await q(
      `INSERT INTO terms (tenant_id, year_id, name, ordinal, start_date, end_date, is_current)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)`,
      [year.id, TERM_NAMES[i], i + 1, s.toISOString().slice(0, 10),
       (i === b.terms - 1 ? end : e).toISOString().slice(0, 10), b.make_current && i === 0]);
  }
  return year;
}

export async function setCurrentTerm(q, termId) {
  const [term] = await q("SELECT t.id, t.year_id FROM terms t WHERE t.id = $1", [termId]);
  if (!term) throw notFound("الفصل الدراسي غير موجود");
  await q("UPDATE terms SET is_current = false WHERE is_current");
  await q("UPDATE academic_years SET is_current = (id = $1)", [term.year_id]);
  await q("UPDATE terms SET is_current = true WHERE id = $1", [termId]);
  return { ok: true };
}

export async function updateTerm(q, termId, b) {
  if (b.end_date <= b.start_date) throw badRequest("نهاية الفصل يجب أن تكون بعد بدايته");
  const rows = await q("UPDATE terms SET name = $2, start_date = $3, end_date = $4 WHERE id = $1 RETURNING id",
    [termId, b.name, b.start_date, b.end_date]);
  if (!rows.length) throw notFound("الفصل الدراسي غير موجود");
}

/**
 * نتائج كل الطلاب في سنة: المتوسط من الاختبارات المنشورة، ونسبة الحضور داخل مدة السنة،
 * والنتيجة (ناجح / راسب / غير مكتمل) حسب درجة النجاح المعتمدة للسنة.
 */
export async function yearResults(q, yearId) {
  const [year] = await q("SELECT id, pass_mark, start_date, end_date FROM academic_years WHERE id = $1", [yearId]);
  if (!year) return { year: null, students: [] };
  const rows = await q(
    `SELECT s.id, s.full_name AS name, s.class_id, s.status, c.name AS class_name,
            g.average, COALESCE(a.records, 0)::int AS attendance_records, a.attended,
            CASE WHEN COALESCE(a.records, 0) > 0 THEN ROUND(a.attended::numeric / a.records * 100, 2) END AS attendance_rate
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN LATERAL (
         SELECT ROUND(SUM(sc.score) / NULLIF(SUM(e.max_score), 0) * 100, 2) AS average
           FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN terms t ON t.id = e.term_id
          WHERE sc.student_id = s.id AND t.year_id = $1 AND e.status = 'published' AND sc.score IS NOT NULL
       ) g ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS records, count(*) FILTER (WHERE status IN ('present', 'late'))::int AS attended
           FROM attendance WHERE student_id = s.id AND day BETWEEN $2 AND $3
       ) a ON true
      WHERE s.status = 'active'
      ORDER BY c.id NULLS LAST, s.full_name`,
    [yearId, year.start_date, year.end_date]);

  const pass = Number(year.pass_mark);
  return {
    year,
    students: rows.map((r) => ({
      ...r,
      average: r.average === null ? null : Number(r.average),
      outcome: r.average === null ? "incomplete" : Number(r.average) >= pass ? "passed" : "failed",
    })),
  };
}

export async function setPassMark(q, yearId, passMark) {
  const rows = await q("UPDATE academic_years SET pass_mark = $2 WHERE id = $1 RETURNING id", [yearId, passMark]);
  if (!rows.length) throw notFound("السنة غير موجودة");
}

/**
 * معاينة الترفيع: لكل طالب نتيجته والإجراء المقترح، قبل تنفيذ بدء السنة.
 */
export async function promotionPreview(q, moves = []) {
  const cur = await current(q);
  if (!cur) return { year: null, students: [] };
  const { year, students } = await yearResults(q, cur.year_id);
  const moveOf = new Map(moves.map((m) => [Number(m.from_class_id), m]));
  return {
    year: { id: year.id, name: cur.year_name, pass_mark: Number(year.pass_mark) },
    students: students.map((s) => {
      const move = s.class_id ? moveOf.get(Number(s.class_id)) : null;
      let action = move?.action || "promote";
      if (action === "promote" && s.outcome === "failed") action = "repeat";      // الراسب يعيد
      if (action === "graduate" && s.outcome === "failed") action = "repeat";     // لا تخرّج براسب
      return { ...s, suggested_action: action, to_class_id: action === "promote" ? move?.to_class_id ?? null : null };
    }),
  };
}

/**
 * بدء سنة دراسية جديدة:
 *   1) يحفظ سجل كل طالب في السنة المنتهية (صفه ونتيجته ومتوسطه)
 *   2) ينقل الطلاب حسب الخريطة: ترفيع، أو بقاء، أو تخرّج
 *   3) ينشئ السنة الجديدة وفصولها ويجعلها الحالية
 * كل ذلك في معاملة واحدة: إما تتم كاملة أو لا تتم.
 */
export async function startNewYear(q, b) {
  const old = await current(q);
  const summary = { promoted: 0, repeated: 0, graduated: 0, transferred: 0, withdrawn: 0, passed: 0, failed: 0, incomplete: 0, year: null };

  if (old) {
    const preview = await promotionPreview(q, b.moves);
    const overrideOf = new Map(b.overrides.map((o) => [Number(o.student_id), o]));

    for (const st of preview.students) {
      const override = overrideOf.get(Number(st.id));
      let action = override?.action || st.suggested_action;
      if (!b.repeat_failed && action === "repeat" && st.outcome === "failed" && st.to_class_id) action = "promote";
      const toClass = override?.to_class_id ?? st.to_class_id;

      // سجل السنة المنتهية: النتيجة والإجراء والمتوسط ونسبة الحضور
      await q(
        `INSERT INTO student_years (tenant_id, student_id, year_id, class_id, class_name, result, outcome, average, attendance_rate, note)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (student_id, year_id) DO UPDATE SET
           result = EXCLUDED.result, outcome = EXCLUDED.outcome, average = EXCLUDED.average,
           attendance_rate = EXCLUDED.attendance_rate, note = EXCLUDED.note`,
        [st.id, old.year_id, st.class_id, st.class_name, RESULT_OF_ACTION[action], st.outcome,
         st.average, st.attendance_rate, override?.note ?? null]);

      summary[st.outcome]++;

      if (action === "promote") {
        if (toClass) await q("UPDATE students SET class_id = $2 WHERE id = $1", [st.id, toClass]);
        summary.promoted++;
      } else if (action === "repeat") {
        summary.repeated++;                                   // يبقى في صفه نفسه
      } else {
        // تخرّج أو نقل أو انسحاب: تتغير حالة الطالب ويخرج من القوائم مع بقاء سجله
        await q("UPDATE students SET status = $2, status_note = $3 WHERE id = $1",
          [st.id, STATUS_OF_ACTION[action], override?.note ?? null]);
        summary[RESULT_OF_ACTION[action]]++;
      }
    }
    await q("UPDATE academic_years SET status = 'archived', is_current = false WHERE id = $1", [old.year_id]);
    await q("UPDATE terms SET is_current = false WHERE year_id = $1", [old.year_id]);
  }

  summary.year = await createYear(q, { ...b.year, make_current: true });
  return summary;
}
