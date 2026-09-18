// بناء كشف الدرجات من الاختبارات المنشورة فقط
const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const gradeWord = (p) => (p === null ? "—" : p >= 90 ? "ممتاز" : p >= 80 ? "جيد جدًا" : p >= 65 ? "جيد" : p >= 50 ? "مقبول" : "يحتاج متابعة");

export async function buildReportCard(q, studentId, termId = null) {
  const [student] = await q(
    `SELECT s.id, s.full_name AS name, s.guardian_name, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [studentId]);
  if (!student) return null;
  const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");

  // فصل دراسي محدد، أو السنة الحالية كاملة إذا لم يُحدد
  const [scope] = await q(
    `SELECT t.id AS term_id, t.name AS term_name, t.year_id, y.name AS year_name
       FROM terms t JOIN academic_years y ON y.id = t.year_id
      WHERE ($1::bigint IS NULL AND t.is_current) OR t.id = $1`, [termId]);

  const rows = await q(
    `SELECT sub.name AS subject, e.title, e.exam_date, e.max_score, sc.score, tr.name AS term_name, tr.ordinal
       FROM exams e JOIN subjects sub ON sub.id = e.subject_id
       JOIN scores sc ON sc.exam_id = e.id AND sc.student_id = $1
       LEFT JOIN terms tr ON tr.id = e.term_id
      WHERE e.status = 'published' AND sc.score IS NOT NULL
        AND ($2::bigint IS NULL OR e.term_id = $2)
        AND ($3::bigint IS NULL OR tr.year_id = $3)
      ORDER BY sub.name, tr.ordinal NULLS LAST, e.exam_date NULLS LAST, e.id`,
    [studentId, termId, termId ? null : scope?.year_id ?? null]);

  const subjects = [];
  for (const row of rows) {
    let s = subjects.find((x) => x.subject === row.subject);
    if (!s) subjects.push((s = { subject: row.subject, exams: [], score: 0, max: 0 }));
    s.exams.push({ title: row.title, date: row.exam_date, score: row.score, max: row.max_score, term: row.term_name });
    s.score += Number(row.score);
    s.max += Number(row.max_score);
  }
  for (const s of subjects) {
    s.percent = s.max ? round((s.score / s.max) * 100) : null;
    s.grade = gradeWord(s.percent);
    s.score = round(s.score, 2);
    s.max = round(s.max, 2);
  }
  const total = subjects.reduce((a, s) => a + s.score, 0);
  const totalMax = subjects.reduce((a, s) => a + s.max, 0);

  // الحضور داخل نطاق الفصل أو السنة
  const [range] = await q(
    `SELECT COALESCE(MIN(t.start_date), '1900-01-01') AS a, COALESCE(MAX(t.end_date), '2999-01-01') AS b
       FROM terms t WHERE ($1::bigint IS NULL OR t.id = $1) AND ($2::bigint IS NULL OR t.year_id = $2)`,
    [termId, termId ? null : scope?.year_id ?? null]);

  const [att] = await q(
    `SELECT count(*) FILTER (WHERE status = 'present')::int AS present,
            count(*) FILTER (WHERE status = 'absent')::int AS absent,
            count(*) FILTER (WHERE status = 'late')::int AS late,
            count(*) FILTER (WHERE status = 'excused')::int AS excused,
            count(*)::int AS recorded
       FROM attendance WHERE student_id = $1 AND day BETWEEN $2 AND $3`, [studentId, range.a, range.b]);

  const percent = totalMax ? round((total / totalMax) * 100) : null;
  return {
    school: school.name,
    scope: scope ? { term_id: scope.term_id, term: termId ? scope.term_name : null, year: scope.year_name } : null,
    student,
    subjects,
    summary: { total: round(total, 2), max: round(totalMax, 2), percent, grade: gradeWord(percent) },
    attendance: { ...att, rate: att.recorded ? round(((att.present + att.late) / att.recorded) * 100) : null },
    issued_at: new Date().toISOString(),
  };
}

export async function classReportCards(q, classId, termId = null) {
  const students = await q("SELECT id FROM students WHERE class_id = $1 AND archived_at IS NULL ORDER BY full_name", [classId]);
  const cards = [];
  for (const s of students) cards.push(await buildReportCard(q, s.id, termId));
  // ترتيب الطلاب حسب النسبة (للترتيب داخل الصف)
  const ranked = [...cards].filter((c) => c.summary.percent !== null).sort((a, b) => b.summary.percent - a.summary.percent);
  for (const c of cards) {
    const i = ranked.findIndex((x) => x.student.id === c.student.id);
    c.rank = i >= 0 ? { position: i + 1, of: ranked.length } : null;
  }
  return cards;
}
