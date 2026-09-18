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
export const rolloverSchema = z.object({
  year: yearSchema,
  // خريطة النقل: من صف إلى صف، أو تخرّج، أو بقاء في نفس الصف
  moves: z.array(z.object({
    from_class_id: t.id,
    action: z.enum(["promote", "stay", "graduate"]),
    to_class_id: t.optId,
  })).max(200).default([]),
  archive_graduates: z.boolean().default(true),
});

export const listYears = (q) => q(
  `SELECT y.id, y.name, y.start_date, y.end_date, y.is_current, y.status,
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

// متوسط الطالب في سنة (من الاختبارات المنشورة داخل فصولها)
async function yearAverage(q, studentId, yearId) {
  const [r] = await q(
    `SELECT CASE WHEN COALESCE(SUM(e.max_score), 0) > 0
              THEN ROUND(SUM(sc.score) / SUM(e.max_score) * 100, 2) END AS avg
       FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN terms t ON t.id = e.term_id
      WHERE sc.student_id = $1 AND t.year_id = $2 AND e.status = 'published' AND sc.score IS NOT NULL`,
    [studentId, yearId]);
  return r.avg;
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
  const summary = { promoted: 0, stayed: 0, graduated: 0, archived: 0, year: null };

  if (old) {
    const moveOf = new Map(b.moves.map((m) => [m.from_class_id, m]));
    const students = await q(
      "SELECT s.id, s.class_id, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.archived_at IS NULL");

    for (const st of students) {
      const move = st.class_id ? moveOf.get(Number(st.class_id)) : null;
      const action = move?.action || "stay";
      const result = action === "graduate" ? "graduated" : action === "promote" ? "promoted" : "repeated";
      await q(
        `INSERT INTO student_years (tenant_id, student_id, year_id, class_id, class_name, result, average)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, year_id) DO UPDATE SET result = EXCLUDED.result, average = EXCLUDED.average`,
        [st.id, old.year_id, st.class_id, st.class_name, result, await yearAverage(q, st.id, old.year_id)]);

      if (action === "promote" && move.to_class_id) {
        await q("UPDATE students SET class_id = $2 WHERE id = $1", [st.id, move.to_class_id]);
        summary.promoted++;
      } else if (action === "graduate") {
        if (b.archive_graduates) {
          await q("UPDATE students SET archived_at = now() WHERE id = $1", [st.id]);
          summary.archived++;
        }
        summary.graduated++;
      } else summary.stayed++;
    }
    await q("UPDATE academic_years SET status = 'archived', is_current = false WHERE id = $1", [old.year_id]);
    await q("UPDATE terms SET is_current = false WHERE year_id = $1", [old.year_id]);
  }

  summary.year = await createYear(q, { ...b.year, make_current: true });
  return summary;
}
