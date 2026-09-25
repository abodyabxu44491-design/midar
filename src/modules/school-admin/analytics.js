// التحليلات والتنبيهات: أرقام تُحسب من البيانات مباشرة، بدون أي إدخال يدوي
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();

/* ---------- تنبيهات تحتاج تدخّل المدير ---------- */
// الفواتير المتأخرة: المدفوع يُجمع مرة واحدة للفواتير المرشحة فقط (بدل استدعاء دالة لكل فاتورة)
const OVERDUE = `SELECT d.id, d.amount - COALESCE(p.net, 0) AS remaining
   FROM (SELECT id, amount FROM invoices WHERE status = 'open' AND due_date < CURRENT_DATE) d
   LEFT JOIN (SELECT invoice_id, SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END) AS net
                FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE status = 'open' AND due_date < CURRENT_DATE)
               GROUP BY invoice_id) p ON p.invoice_id = d.id
  WHERE d.amount > COALESCE(p.net, 0)`;

r.get("/alerts", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const [a] = await q(`SELECT
      (SELECT count(*) FROM exams WHERE status = 'pending')::int AS pending_exams,
      (SELECT count(*) FROM payment_claims WHERE status = 'pending')::int AS pending_claims,
      (SELECT count(*) FROM admissions WHERE status = 'new')::int AS new_admissions,
      (SELECT count(*) FROM (${OVERDUE}) o)::int AS overdue_invoices,
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
      `SELECT o.id, i.title, o.remaining, i.due_date,
              s.id AS student_id, s.full_name AS student_name, s.guardian_phone, c.name AS class_name
         FROM (${OVERDUE}) o JOIN invoices i ON i.id = o.id JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = s.class_id
        ORDER BY i.due_date LIMIT 20`);

    return { counts: a, absentees, overdue };
  }));
}));

/* ---------- تحليلات الأداء ---------- */
// التحليلات بيانات تاريخية: تُحسب مرة وتُخزَّن 5 دقائق لكل مدرسة (لا تُعاد مع كل فتح للصفحة)
const analyticsCache = new Map();
const ANALYTICS_TTL = 5 * 60 * 1000;

r.get("/", handle(async (req, res) => {
  const months = parse(z.coerce.number().int().min(1).max(24).default(6), req.query.months || undefined);
  // term_id=current: الفصل الحالي يُحدد في الخادم (تطلب الواجهة التحليلات وبيانات السنة معًا بدل واحد بعد الآخر)
  const termId = req.query.term_id === "current"
    ? (await inTenant(req, (q) => q("SELECT id FROM terms WHERE is_current ORDER BY id DESC LIMIT 1")))[0]?.id ?? null
    : req.query.term_id ? parse(t.id, req.query.term_id) : null;
  const key = `${req.tenantId}:${months}:${termId ?? ""}`;
  const hit = analyticsCache.get(key);
  if (hit && hit.until > Date.now() && req.query.fresh !== "1") return res.json(hit.data);

  const data = await inTenant(req, async (q) => {
    // الحضور: مرور واحد على السجلات بدل مرورين (حسب الشهر وحسب الفصل معًا)
    const att = await q(
      `SELECT a.month, c.id AS class_id, c.name AS class_name,
              SUM(a.present)::int AS present, SUM(a.absent)::int AS absent,
              SUM(a.late)::int AS late, SUM(a.excused)::int AS excused, SUM(a.total)::int AS total,
              GROUPING(a.month) AS g_month
         FROM (
           -- تجميع أولي على جدول الحضور الكبير وحده (طالب × شهر)، ثم الربط بالطلاب والفصول على نتيجة صغيرة
           SELECT student_id, to_char(date_trunc('month', day), 'YYYY-MM') AS month,
                  count(*) FILTER (WHERE status = 'present') AS present, count(*) FILTER (WHERE status = 'absent') AS absent,
                  count(*) FILTER (WHERE status = 'late') AS late, count(*) FILTER (WHERE status = 'excused') AS excused, count(*) AS total
             FROM attendance WHERE day > (CURRENT_DATE - make_interval(months => $1))
            GROUP BY student_id, date_trunc('month', day)
         ) a LEFT JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
        GROUP BY GROUPING SETS ((a.month), (c.id, c.name))`, [months]);
    const attendance_by_month = att.filter((r) => r.g_month === 0).sort((x, y) => x.month.localeCompare(y.month))
      .map(({ month, present, absent, late, excused, total }) => ({ month, present, absent, late, excused, total }));
    const attendance_by_class = att.filter((r) => r.g_month === 1 && r.class_id)
      .sort((x, y) => Number(x.class_id) - Number(y.class_id))
      .map((r) => ({ class_name: r.class_name, records: r.total, attended: r.present + r.late }));

    // الدرجات: مرور واحد (حسب الفصل والمادة والطالب معًا)
    const sc = await q(
      `SELECT p.class_id, c.name AS class_name, p.subject_id, sub.name AS subject, p.student_id, s.full_name AS name, sc_cls.name AS student_class, s.archived_at,
              SUM(p.score) AS score, SUM(p.max) AS max, count(DISTINCT p.student_id)::int AS students,
              GROUPING(p.class_id, c.name) AS g_class, GROUPING(p.subject_id, sub.name) AS g_subject
         FROM (
           -- تجميع أولي على جدول الدرجات الكبير (طالب × فصل × مادة): يمنع فرزًا ضخمًا على القرص
           SELECT sc.student_id, e.class_id, e.subject_id, SUM(sc.score) AS score, SUM(e.max_score) AS max
             FROM scores sc JOIN exams e ON e.id = sc.exam_id
            WHERE e.status = 'published' AND sc.score IS NOT NULL AND ($1::bigint IS NULL OR e.term_id = $1)
            GROUP BY sc.student_id, e.class_id, e.subject_id
         ) p
         JOIN classes c ON c.id = p.class_id JOIN subjects sub ON sub.id = p.subject_id
         JOIN students s ON s.id = p.student_id LEFT JOIN classes sc_cls ON sc_cls.id = s.class_id
        GROUP BY GROUPING SETS ((p.class_id, c.name), (p.subject_id, sub.name),
                                (p.student_id, s.full_name, sc_cls.name, s.archived_at))`, [termId]);
    const pct = (r) => (Number(r.max) > 0 ? Math.round((Number(r.score) / Number(r.max)) * 1000) / 10 : null);
    const grades_by_class = sc.filter((r) => r.g_class === 0).sort((x, y) => Number(x.class_id) - Number(y.class_id))
      .map((r) => ({ class_name: r.class_name, average: pct(r), students: r.students }));
    const grades_by_subject = sc.filter((r) => r.g_subject === 0).map((r) => ({ subject: r.subject, average: pct(r) }))
      .sort((x, y) => (y.average ?? -1) - (x.average ?? -1));
    const students_ranked = sc.filter((r) => r.student_id && !r.archived_at && r.g_class !== 0 && r.g_subject !== 0 && Number(r.max) > 0)
      .map((r) => ({ id: r.student_id, name: r.name, class_name: r.student_class, average: pct(r) }))
      .sort((x, y) => y.average - x.average);

    // الرسوم: تجميع واحد بدل استدعاء دالة لكل فاتورة
    const [fees] = await q(
      `SELECT COALESCE(SUM(i.amount), 0) AS billed, COALESCE(SUM(p.net), 0) AS collected
         FROM invoices i
         LEFT JOIN (SELECT invoice_id, SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END) AS net FROM payments GROUP BY invoice_id) p
           ON p.invoice_id = i.id
        WHERE i.status = 'open' AND ($1::bigint IS NULL OR i.term_id = $1)`, [termId]);

    const fees_by_month = await q(
      `SELECT to_char(created_at, 'YYYY-MM') AS month,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'payment'), 0)
            - COALESCE(SUM(amount) FILTER (WHERE kind = 'refund'), 0) AS collected
         FROM payments WHERE created_at > (CURRENT_DATE - make_interval(months => $1))
        GROUP BY 1 ORDER BY 1`, [months]);

    return {
      months,
      computed_at: new Date().toISOString(),
      attendance_by_month: attendance_by_month.map((m) => ({ ...m, rate: m.total ? Math.round(((m.present + m.late) / m.total) * 100) : null })),
      attendance_by_class: attendance_by_class.map((c) => ({ ...c, rate: c.records ? Math.round((c.attended / c.records) * 100) : null })),
      grades_by_class, grades_by_subject,
      top_students: students_ranked.slice(0, 5),
      needs_attention: students_ranked.filter((x) => Number(x.average) < 60).slice(-5).reverse(),
      fees: { billed: Number(fees.billed), collected: Number(fees.collected), remaining: Number(fees.billed) - Number(fees.collected) },
      fees_by_month,
    };
  });
  analyticsCache.set(key, { data, until: Date.now() + ANALYTICS_TTL });
  if (analyticsCache.size > 500) analyticsCache.delete(analyticsCache.keys().next().value);
  res.json(data);
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

/**
 * مركز التنبيهات: كل ما يحتاج انتباه المدير في قائمة واحدة مرتبة بالأهمية،
 * ومع كل تنبيه وجهته داخل اللوحة.
 */
r.get("/notifications", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const [c] = await q(`SELECT
      (SELECT count(*) FROM exams WHERE status = 'pending')::int AS pending_exams,
      (SELECT count(*) FROM payment_claims WHERE status = 'pending')::int AS pending_claims,
      (SELECT count(*) FROM admissions WHERE status = 'new')::int AS new_admissions,
      (SELECT count(*) FROM password_requests WHERE status = 'new')::int AS password_requests,
      (SELECT count(*) FROM exam_papers WHERE status = 'ready' AND NOT is_template)::int AS papers_ready,
      (SELECT count(*) FROM finance_entries WHERE status = 'pending')::int AS pending_finance,
      (SELECT count(*) FROM (${OVERDUE}) o)::int AS overdue_invoices,
      (SELECT count(*) FROM finance_accounts a WHERE a.is_active AND a.low_balance IS NOT NULL
         AND account_balance(a.id) < a.low_balance)::int AS low_balance,
      (SELECT count(*) FROM students s WHERE s.status = 'active' AND s.class_id IS NULL)::int AS without_class,
      (SELECT count(*) FROM students s WHERE s.status = 'active'
         AND (s.guardian_phone IS NULL OR s.guardian_phone = ''))::int AS without_guardian,
      (SELECT count(*) FROM teachers te WHERE NOT EXISTS
         (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = te.id))::int AS teachers_without_load,
      (SELECT count(*) FROM teachers te WHERE NOT EXISTS
         (SELECT 1 FROM timetable_slots ts WHERE ts.teacher_id = te.id))::int AS teachers_without_timetable,
      (SELECT count(*) FROM classes c WHERE NOT EXISTS
         (SELECT 1 FROM timetable_slots s2 WHERE s2.class_id = c.id))::int AS classes_without_timetable,
      (SELECT count(*) FROM (SELECT student_id FROM attendance
          WHERE status = 'absent' AND day > CURRENT_DATE - 30 GROUP BY student_id HAVING count(*) >= 3) x)::int AS frequent_absentees,
      (SELECT CASE WHEN EXISTS (SELECT 1 FROM staff WHERE is_active)
                    AND NOT EXISTS (SELECT 1 FROM payroll_runs
                                     WHERE period = date_trunc('month', CURRENT_DATE)::date AND status <> 'void')
              THEN 1 ELSE 0 END)::int AS payroll_due,
      (SELECT count(*) FROM students s WHERE s.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.day = CURRENT_DATE))::int AS attendance_missing`);

    // تعارضات الجدول (معلم في مكانين)
    const conflicts = await q(
      `SELECT count(*)::int AS n FROM (
         SELECT teacher_id, day, period FROM timetable_slots WHERE teacher_id IS NOT NULL
          GROUP BY teacher_id, day, period HAVING count(*) > 1) x`);

    const item = (level, count, text, tab, hint) => (count ? { level, count, text, tab, hint } : null);
    const items = [
      item("urgent", conflicts[0].n, "تعارض في جدول الحصص", "timetable", "معلم لديه حصتان في وقت واحد"),
      item("urgent", c.overdue_invoices, "فواتير تجاوزت موعد السداد", "finance", null),
      item("urgent", c.low_balance, "حسابات رصيدها منخفض", "ledger", null),
      item("urgent", c.frequent_absentees, "طلاب غابوا 3 أيام فأكثر", "attendance", "خلال آخر 30 يومًا"),

      item("action", c.pending_exams, "اختبارات تنتظر اعتمادك", "exams", null),
      req.modules?.exam_papers ? item("action", c.papers_ready, "أوراق اختبارات تنتظر اعتمادك قبل الطباعة", "papers", null) : null,
      item("action", c.pending_claims, "تحويلات بانتظار التأكيد", "finance", null),
      item("action", c.pending_finance, "حركات مالية تنتظر الاعتماد", "ledger", null),
      item("action", c.new_admissions, "طلبات تسجيل جديدة", "admissions", null),
      item("action", c.password_requests, "طلبات تغيير كلمة مرور", "settings", "الإعدادات ← طلبات كلمات المرور"),
      item("action", c.payroll_due, "مسير رواتب هذا الشهر لم يُنشأ", "ledger", null),
      item("action", c.attendance_missing, "طلاب لم يُسجَّل حضورهم اليوم", "attendance", null),

      item("info", c.without_class, "طلاب بلا فصل", "students", null),
      item("info", c.without_guardian, "طلاب بلا جوال ولي أمر", "students", null),
      item("info", c.teachers_without_load, "معلمون بلا إسناد", "distribution", null),
      item("info", c.teachers_without_timetable, "معلمون بلا جدول", "timetable", null),
      item("info", c.classes_without_timetable, "شعب بلا جدول", "timetable", null),
    ].filter(Boolean);

    return {
      items,
      counts: { urgent: items.filter((x) => x.level === "urgent").length,
        action: items.filter((x) => x.level === "action").length,
        info: items.filter((x) => x.level === "info").length },
    };
  }));
}));

export default r;
