// التحليلات والتنبيهات: أرقام تُحسب من البيانات مباشرة، بدون أي إدخال يدوي
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();

/* ---------- تنبيهات تحتاج تدخّل المدير ---------- */
r.get("/alerts", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const [a] = await q(`SELECT
      (SELECT count(*) FROM exams WHERE status = 'pending')::int AS pending_exams,
      (SELECT count(*) FROM payment_claims WHERE status = 'pending')::int AS pending_claims,
      (SELECT count(*) FROM admissions WHERE status = 'new')::int AS new_admissions,
      (SELECT count(*) FROM invoices i WHERE i.status = 'open' AND i.due_date < CURRENT_DATE
         AND i.amount > invoice_net_paid(i.id))::int AS overdue_invoices,
      (SELECT count(*) FROM teachers te WHERE NOT EXISTS
         (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = te.id))::int AS teachers_without_load,
      (SELECT count(*) FROM classes c WHERE NOT EXISTS
         (SELECT 1 FROM timetable_slots s WHERE s.class_id = c.id))::int AS classes_without_timetable,
      (SELECT count(*) FROM students s WHERE s.archived_at IS NULL AND s.class_id IS NULL)::int AS students_without_class,
      (SELECT count(*) FROM finance_entries WHERE status = 'pending')::int AS pending_finance,
      (SELECT count(*) FROM finance_accounts a WHERE a.is_active AND a.low_balance IS NOT NULL
         AND account_balance(a.id) < a.low_balance)::int AS low_balance_accounts,
      (SELECT CASE WHEN EXISTS (SELECT 1 FROM staff WHERE is_active)
                    AND NOT EXISTS (SELECT 1 FROM payroll_runs
                                     WHERE period = date_trunc('month', CURRENT_DATE)::date AND status <> 'void')
              THEN 1 ELSE 0 END)::int AS payroll_due,
      (SELECT count(*) FROM (SELECT student_id FROM attendance
          WHERE status = 'absent' AND day > CURRENT_DATE - 30 GROUP BY student_id HAVING count(*) >= 3) x)::int AS frequent_absentees`);

    // الطلاب كثيرو الغياب خلال 30 يومًا
    const absentees = await q(
      `SELECT s.id, s.full_name AS name, c.name AS class_name, count(*)::int AS absences, s.guardian_phone
         FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
        WHERE a.status = 'absent' AND a.day > CURRENT_DATE - 30 AND s.archived_at IS NULL
        GROUP BY s.id, s.full_name, c.name, s.guardian_phone HAVING count(*) >= 3
        ORDER BY count(*) DESC LIMIT 20`);

    // الفواتير المتأخرة
    const overdue = await q(
      `SELECT i.id, i.title, i.amount - invoice_net_paid(i.id) AS remaining, i.due_date,
              s.id AS student_id, s.full_name AS student_name, s.guardian_phone, c.name AS class_name
         FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = s.class_id
        WHERE i.status = 'open' AND i.due_date < CURRENT_DATE AND i.amount > invoice_net_paid(i.id)
        ORDER BY i.due_date LIMIT 20`);

    return { counts: a, absentees, overdue };
  }));
}));

/* ---------- تحليلات الأداء ---------- */
r.get("/", handle(async (req, res) => {
  const months = parse(z.coerce.number().int().min(1).max(24).default(6), req.query.months || undefined);
  const termId = req.query.term_id ? parse(t.id, req.query.term_id) : null;

  res.json(await inTenant(req, async (q) => {
    const attendance_by_month = await q(
      `SELECT to_char(day, 'YYYY-MM') AS month,
              count(*) FILTER (WHERE status = 'present')::int AS present,
              count(*) FILTER (WHERE status = 'absent')::int  AS absent,
              count(*) FILTER (WHERE status = 'late')::int    AS late,
              count(*) FILTER (WHERE status = 'excused')::int AS excused,
              count(*)::int AS total
         FROM attendance WHERE day > (CURRENT_DATE - make_interval(months => $1))
        GROUP BY 1 ORDER BY 1`, [months]);

    const attendance_by_class = await q(
      `SELECT c.name AS class_name,
              count(*)::int AS records,
              count(*) FILTER (WHERE a.status IN ('present','late'))::int AS attended
         FROM attendance a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = s.class_id
        WHERE a.day > (CURRENT_DATE - make_interval(months => $1))
        GROUP BY c.id, c.name ORDER BY c.id`, [months]);

    // متوسط الدرجات لكل صف من الاختبارات المنشورة
    const grades_by_class = await q(
      `SELECT c.name AS class_name,
              CASE WHEN SUM(e.max_score) > 0 THEN ROUND(SUM(sc.score) / SUM(e.max_score) * 100, 1) END AS average,
              count(DISTINCT sc.student_id)::int AS students
         FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN classes c ON c.id = e.class_id
        WHERE e.status = 'published' AND sc.score IS NOT NULL AND ($1::bigint IS NULL OR e.term_id = $1)
        GROUP BY c.id, c.name ORDER BY c.id`, [termId]);

    const grades_by_subject = await q(
      `SELECT sub.name AS subject,
              CASE WHEN SUM(e.max_score) > 0 THEN ROUND(SUM(sc.score) / SUM(e.max_score) * 100, 1) END AS average
         FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN subjects sub ON sub.id = e.subject_id
        WHERE e.status = 'published' AND sc.score IS NOT NULL AND ($1::bigint IS NULL OR e.term_id = $1)
        GROUP BY sub.id, sub.name ORDER BY 2 DESC NULLS LAST`, [termId]);

    const students_ranked = await q(
      `SELECT s.id, s.full_name AS name, c.name AS class_name,
              ROUND(SUM(sc.score) / NULLIF(SUM(e.max_score), 0) * 100, 1) AS average
         FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN students s ON s.id = sc.student_id
         LEFT JOIN classes c ON c.id = s.class_id
        WHERE e.status = 'published' AND sc.score IS NOT NULL AND s.archived_at IS NULL
          AND ($1::bigint IS NULL OR e.term_id = $1)
        GROUP BY s.id, s.full_name, c.name HAVING SUM(e.max_score) > 0
        ORDER BY 4 DESC`, [termId]);

    const [fees] = await q(
      `SELECT COALESCE(SUM(amount), 0) AS billed, COALESCE(SUM(invoice_net_paid(id)), 0) AS collected
         FROM invoices WHERE status = 'open' AND ($1::bigint IS NULL OR term_id = $1)`, [termId]);

    const fees_by_month = await q(
      `SELECT to_char(created_at, 'YYYY-MM') AS month,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'payment'), 0)
            - COALESCE(SUM(amount) FILTER (WHERE kind = 'refund'), 0) AS collected
         FROM payments WHERE created_at > (CURRENT_DATE - make_interval(months => $1))
        GROUP BY 1 ORDER BY 1`, [months]);

    return {
      months,
      attendance_by_month: attendance_by_month.map((m) => ({ ...m, rate: m.total ? Math.round(((m.present + m.late) / m.total) * 100) : null })),
      attendance_by_class: attendance_by_class.map((c) => ({ ...c, rate: c.records ? Math.round((c.attended / c.records) * 100) : null })),
      grades_by_class, grades_by_subject,
      top_students: students_ranked.slice(0, 5),
      needs_attention: students_ranked.filter((s) => Number(s.average) < 60).slice(-5).reverse(),
      fees: { billed: Number(fees.billed), collected: Number(fees.collected), remaining: Number(fees.billed) - Number(fees.collected) },
      fees_by_month,
    };
  }));
}));

/* ---------- بحث سريع شامل ---------- */
r.get("/search", handle(async (req, res) => {
  const q2 = parse(z.string().trim().min(2, "اكتب حرفين على الأقل").max(60), req.query.q);
  res.json(await inTenant(req, async (q) => ({
    students: await q(
      `SELECT s.id, s.full_name AS name, s.access_key, c.name AS class_name, s.archived_at
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.full_name ILIKE '%' || $1 || '%' OR s.access_key ILIKE $1 || '%'
           OR s.guardian_name ILIKE '%' || $1 || '%' OR s.guardian_phone LIKE '%' || $1 || '%'
        ORDER BY s.full_name LIMIT 10`, [q2]),
    teachers: await q(
      `SELECT t.id, t.full_name AS name, u.username FROM teachers t LEFT JOIN users u ON u.teacher_id = t.id
        WHERE t.full_name ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%' ORDER BY t.full_name LIMIT 10`, [q2]),
    invoices: await q(
      `SELECT i.id, i.title, i.amount, invoice_net_paid(i.id) AS paid, s.full_name AS student_name
         FROM invoices i JOIN students s ON s.id = i.student_id
        WHERE i.title ILIKE '%' || $1 || '%' OR s.full_name ILIKE '%' || $1 || '%'
        ORDER BY i.id DESC LIMIT 10`, [q2]),
  })));
}));

export default r;
