// بناء كشف الدرجات من الاختبارات المنشورة فقط
const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const gradeWord = (p) => (p === null ? "—" : p >= 90 ? "ممتاز" : p >= 80 ? "جيد جدًا" : p >= 65 ? "جيد" : p >= 50 ? "مقبول" : "يحتاج متابعة");

export async function buildReportCard(q, studentId) {
  const [student] = await q(
    `SELECT s.id, s.full_name AS name, s.guardian_name, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [studentId]);
  if (!student) return null;
  const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");

  const rows = await q(
    `SELECT sub.name AS subject, e.title, e.exam_date, e.max_score, sc.score
       FROM exams e JOIN subjects sub ON sub.id = e.subject_id
       JOIN scores sc ON sc.exam_id = e.id AND sc.student_id = $1
      WHERE e.status = 'published' AND sc.score IS NOT NULL
      ORDER BY sub.name, e.exam_date NULLS LAST, e.id`, [studentId]);

  const subjects = [];
  for (const row of rows) {
    let s = subjects.find((x) => x.subject === row.subject);
    if (!s) subjects.push((s = { subject: row.subject, exams: [], score: 0, max: 0 }));
    s.exams.push({ title: row.title, date: row.exam_date, score: row.score, max: row.max_score });
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

  const [att] = await q(
    `SELECT count(*) FILTER (WHERE status = 'present')::int AS present,
            count(*) FILTER (WHERE status = 'absent')::int AS absent,
            count(*) FILTER (WHERE status = 'late')::int AS late,
            count(*) FILTER (WHERE status = 'excused')::int AS excused,
            count(*)::int AS recorded
       FROM attendance WHERE student_id = $1`, [studentId]);

  const percent = totalMax ? round((total / totalMax) * 100) : null;
  return {
    school: school.name,
    student,
    subjects,
    summary: { total: round(total, 2), max: round(totalMax, 2), percent, grade: gradeWord(percent) },
    attendance: { ...att, rate: att.recorded ? round(((att.present + att.late) / att.recorded) * 100) : null },
    issued_at: new Date().toISOString(),
  };
}

export async function classReportCards(q, classId) {
  const students = await q("SELECT id FROM students WHERE class_id = $1 AND archived_at IS NULL ORDER BY full_name", [classId]);
  const cards = [];
  for (const s of students) cards.push(await buildReportCard(q, s.id));
  // ترتيب الطلاب حسب النسبة (للترتيب داخل الصف)
  const ranked = [...cards].filter((c) => c.summary.percent !== null).sort((a, b) => b.summary.percent - a.summary.percent);
  for (const c of cards) {
    const i = ranked.findIndex((x) => x.student.id === c.student.id);
    c.rank = i >= 0 ? { position: i + 1, of: ranked.length } : null;
  }
  return cards;
}
