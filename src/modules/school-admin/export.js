// تصدير كل بيانات المدرسة (نسخة يحتفظ بها المدير)
//   - يشمل كل الأقسام: الأكاديمي والمالية والرواتب والسنوات والواجبات وطلبات التسجيل
//   - الجداول الكبيرة (حضور، درجات، دفعات، حركات مالية) تُقرأ وتُكتب على دفعات، فلا تُحمَّل كلها في الذاكرة ولا تُقصّ
//   - كل تصدير يُسجَّل في سجل التدقيق (النسخة تحوي بيانات شخصية ومعرّفات الطلاب)
//   - محتوى المرفقات (الصور) غير مضمَّن، وتُذكر بياناتها فقط في attachments_meta
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { logEvent } from "../../core/audit.js";
import { FIELDS as PUBLIC_FIELDS } from "../shared/public-settings.service.js";

const r = Router();
const PAGE = 5000;

/* جداول صغيرة: استعلام واحد لكل جدول */
const SMALL = {
  classes: "SELECT id, name FROM classes ORDER BY id",
  subjects: "SELECT id, name FROM subjects ORDER BY id",
  teachers: `SELECT t.id, t.full_name AS name, t.phone, u.username FROM teachers t
              LEFT JOIN users u ON u.teacher_id = t.id ORDER BY t.id`,
  students: `SELECT s.id, s.full_name AS name, c.name AS class_name, s.guardian_name, s.guardian_phone,
                    s.access_key, s.fees_enabled, s.status, s.archived_at, s.created_at
               FROM students s LEFT JOIN classes c ON c.id = s.class_id ORDER BY s.full_name`,
  exams: `SELECT e.id, e.title, c.name AS class_name, sub.name AS subject, e.exam_date, e.max_score, e.status
            FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects sub ON sub.id = e.subject_id ORDER BY e.id`,
  timetable: `SELECT c.name AS class_name, t.day, t.period, sub.name AS subject, te.full_name AS teacher, t.room
                FROM timetable_slots t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
                LEFT JOIN teachers te ON te.id = t.teacher_id ORDER BY c.id, t.day, t.period`,
  invoices: `SELECT i.id, s.full_name AS student, i.title, i.amount, invoice_net_paid(i.id) AS paid,
                    i.due_date, i.status, i.created_at
               FROM invoices i JOIN students s ON s.id = i.student_id ORDER BY i.id`,
  announcements: "SELECT title, body, created_at FROM announcements ORDER BY id DESC",
  // المالية
  finance_accounts: `SELECT id, name, kind, currency, opening_balance, low_balance, note, is_active,
                            account_balance(id) AS balance, created_at FROM finance_accounts ORDER BY id`,
  finance_categories: "SELECT id, direction, name, code, is_active FROM finance_categories ORDER BY id",
  donations: `SELECT id, donor_name, anonymous, phone, amount, purpose, method, reference, received_on, entry_id, note,
                     created_by, created_at FROM donations ORDER BY id`,
  staff: `SELECT id, full_name, job_title, category, phone, iban, base_salary, is_active, created_at FROM staff ORDER BY id`,
  payroll_runs: "SELECT id, period, status, note, created_by, approved_by, paid_at, created_at FROM payroll_runs ORDER BY period",
  payroll_items: `SELECT i.id, i.run_id, r.period, s.full_name AS staff, i.base, i.allowances, i.bonus, i.deductions,
                         i.advances, i.net, i.note, i.entry_id
                    FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id JOIN staff s ON s.id = i.staff_id
                   ORDER BY r.period, i.id`,
  attachments_meta: `SELECT id, entity_type, entity_id, filename, mime, size_bytes, uploaded_by, created_at
                       FROM attachments ORDER BY id`,
  // السنوات والواجبات والتسجيل والإعدادات
  academic_years: "SELECT id, name, start_date, end_date, is_current, status, pass_mark FROM academic_years ORDER BY id",
  terms: "SELECT id, year_id, name, ordinal, start_date, end_date, is_current FROM terms ORDER BY year_id, ordinal",
  student_years: `SELECT y.year_id, ay.name AS year_name, s.full_name AS student, y.class_name, y.result, y.outcome,
                         y.average, y.attendance_rate, y.note
                    FROM student_years y JOIN students s ON s.id = y.student_id JOIN academic_years ay ON ay.id = y.year_id
                   ORDER BY y.year_id, s.full_name`,
  assignments: `SELECT a.id, a.title, a.details, a.due_date, c.name AS class_name, sub.name AS subject,
                       t.full_name AS teacher, a.created_at
                  FROM assignments a JOIN classes c ON c.id = a.class_id JOIN subjects sub ON sub.id = a.subject_id
                  LEFT JOIN teachers t ON t.id = a.teacher_id ORDER BY a.id`,
  admissions: `SELECT id, student_name, grade_wanted, birth_date, guardian_name, guardian_phone, note, status, review_note,
                      student_id, created_at FROM admissions ORDER BY id`,
  public_page_settings: `SELECT ${PUBLIC_FIELDS.join(", ")} FROM school_public_settings`,
  message_templates: "SELECT country_code, absence, late, fees, general FROM school_messages",
};

/* جداول كبيرة: دفعات بمؤشر (keyset). cursor(row) يعيد مؤشر الدفعة التالية */
const LARGE = {
  attendance: {
    sql: `SELECT a.id, a.day, s.full_name AS student, a.status, a.note, a.recorded_by
            FROM attendance a JOIN students s ON s.id = a.student_id
           WHERE a.id > $1 ORDER BY a.id LIMIT ${PAGE}`,
    start: [0], next: (row) => [row.id],
  },
  scores: {
    sql: `SELECT sc.exam_id, sc.student_id, e.title AS exam, sub.name AS subject, s.full_name AS student, sc.score, e.max_score
            FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN subjects sub ON sub.id = e.subject_id
            JOIN students s ON s.id = sc.student_id
           WHERE ($1::bigint IS NULL OR (sc.exam_id, sc.student_id) > ($1::bigint, $2::bigint))
           ORDER BY sc.exam_id, sc.student_id LIMIT ${PAGE}`,
    start: [null, null], next: (row) => [row.exam_id, row.student_id],
  },
  payments: {
    sql: `SELECT p.id, p.receipt_no, s.full_name AS student, i.title, p.kind, p.amount, p.method, p.created_at
            FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = i.student_id
           WHERE p.id > $1 ORDER BY p.id LIMIT ${PAGE}`,
    start: [0], next: (row) => [row.id],
  },
  finance_entries: {
    sql: `SELECT e.id, e.entry_no, e.direction, e.amount, e.rate, e.amount_base, a.currency, e.occurred_on, e.reason,
                 e.beneficiary, e.method, e.reference, e.attachment, e.status, e.source_type, e.source_id, e.note,
                 e.created_by, e.approved_by, e.approved_at, e.void_reason, e.created_at, e.transfer_group,
                 a.name AS account_name, c.name AS category_name
            FROM finance_entries e JOIN finance_accounts a ON a.id = e.account_id
            JOIN finance_categories c ON c.id = e.category_id
           WHERE e.id > $1 ORDER BY e.id LIMIT ${PAGE}`,
    start: [0], next: (row) => [row.id],
  },
  assignment_submissions: {
    sql: `SELECT x.assignment_id, x.student_id, a.title AS assignment, s.full_name AS student, x.submitted, x.note, x.marked_by
            FROM assignment_submissions x JOIN assignments a ON a.id = x.assignment_id JOIN students s ON s.id = x.student_id
           WHERE ($1::bigint IS NULL OR (x.assignment_id, x.student_id) > ($1::bigint, $2::bigint))
           ORDER BY x.assignment_id, x.student_id LIMIT ${PAGE}`,
    start: [null, null], next: (row) => [row.assignment_id, row.student_id],
  },
};

// كتابة مع احترام ضغط الشبكة (لا نملأ الذاكرة إن كان العميل بطيئًا)
const writer = (res) => (chunk) => new Promise((resolve, reject) => {
  if (res.destroyed) return reject(new Error("أغلق العميل الاتصال"));
  if (res.write(chunk)) return resolve();
  const onDrain = () => { res.off("close", onClose); resolve(); };
  const onClose = () => { res.off("drain", onDrain); reject(new Error("أغلق العميل الاتصال")); };
  res.once("drain", onDrain);
  res.once("close", onClose);
});

r.get("/", handle(async (req, res) => {
  try {
    await inTenant(req, async (q) => {
      await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: "تصدير نسخة كاملة من بيانات المدرسة" });

      // الجداول الصغيرة تُقرأ كلها أولًا: أي خطأ فيها يظهر كخطأ عادي قبل أن يبدأ الرد
      const small = {};
      for (const [name, sql] of Object.entries(SMALL)) small[name] = await q(sql);

      const write = writer(res);
      res.status(200).type("application/json");
      await write(`{"school":${JSON.stringify(req.tenant.name)},"currency":${JSON.stringify(req.tenant.currency)},"exported_at":${JSON.stringify(new Date().toISOString())}`);
      for (const [name, rows] of Object.entries(small)) await write(`,${JSON.stringify(name)}:${JSON.stringify(rows)}`);

      for (const [name, spec] of Object.entries(LARGE)) {
        await write(`,${JSON.stringify(name)}:[`);
        let params = spec.start, first = true;
        for (;;) {
          const rows = await q(spec.sql, params);
          if (rows.length) await write((first ? "" : ",") + rows.map((row) => JSON.stringify(row)).join(","));
          if (rows.length) first = false;
          if (rows.length < PAGE) break;
          params = spec.next(rows[rows.length - 1]);
        }
        await write("]");
      }
      await write("}");
      res.end();
    });
  } catch (e) {
    // بعد بدء الرد لا يمكن إرسال خطأ صالح؛ نقطع الاتصال حتى لا يظنّ العميل أن النسخة المبتورة كاملة
    if (res.headersSent) { res.destroy(e); return; }
    throw e;
  }
}));

export default r;
