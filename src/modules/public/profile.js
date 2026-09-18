// ملف الطالب الكامل — يُفتح بمعرّف الطالب فقط
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, verifyStudent } from "./context.js";
import { studentSummary, listInvoices, listPayments } from "../shared/finance.service.js";
import { listAccounts, claimsForStudent } from "../shared/payments.service.js";
import { getSettings } from "../shared/public-settings.service.js";
import { forClass } from "../shared/timetable.service.js";
import { listForStudent } from "../shared/homework.service.js";

const r = Router({ mergeParams: true });
const mask = (phone) => (phone ? phone.replace(/\s/g, "").replace(/.(?=.{3})/g, "•") : null);

r.post("/student", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await verifyStudent(req, tenant, q, req.body);
    const settings = await getSettings(q);
    const [cls] = s.class_id ? await q("SELECT name FROM classes WHERE id = $1", [s.class_id]) : [];
    const attendance = settings.profile_show_attendance
      ? await q("SELECT day, status FROM attendance WHERE student_id = $1 ORDER BY day DESC LIMIT 90", [s.id]) : [];
    const grades = settings.profile_show_grades ? await q(
      `SELECT e.title, e.exam_date, e.max_score, sub.name AS subject, sc.score
         FROM exams e JOIN scores sc ON sc.exam_id = e.id AND sc.student_id = $1 JOIN subjects sub ON sub.id = e.subject_id
        WHERE e.status = 'published' AND sc.score IS NOT NULL ORDER BY e.exam_date DESC NULLS LAST, e.id DESC`, [s.id]) : [];
    const teachers = settings.profile_show_teachers ? await q(
      `SELECT DISTINCT sub.name AS subject, t.full_name AS teacher FROM teacher_assignments a
         JOIN teachers t ON t.id = a.teacher_id JOIN subjects sub ON sub.id = a.subject_id WHERE a.class_id = $1
        ORDER BY sub.name`, [s.class_id]) : [];
    const news = await q(
      "SELECT title, body, created_at FROM announcements WHERE class_id IS NULL OR class_id = $1 ORDER BY id DESC LIMIT 20", [s.class_id]);

    let fees = null;
    if (s.fees_enabled) {
      fees = {
        ...(await studentSummary(q, s.id)),
        invoices: (await listInvoices(q, "i.student_id = $1", [s.id])).map(({ student_name, class_name, student_id, ...i }) => i),
        receipts: await listPayments(q, s.id),
        claims: await claimsForStudent(q, s.id),
        accounts: (await listAccounts(q, { activeOnly: true })).map(({ is_active, ...a }) => a),
        payment_note: (await q("SELECT payment_note FROM tenants WHERE id = app_tenant()"))[0].payment_note,
      };
    }
    return {
      school: tenant.name,
      student: { id: s.id, name: s.full_name, class_name: cls?.name || "غير محدد", guardian_name: s.guardian_name,
        guardian_phone: mask(s.guardian_phone), since: s.created_at },
      settings, attendance, grades, teachers, announcements: news, fees,
      timetable: settings.profile_show_timetable && s.class_id ? await forClass(q, s.class_id) : [],
      homework: settings.profile_show_homework && s.class_id ? await listForStudent(q, s) : [],
    };
  }));
}));

export default r;
