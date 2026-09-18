// تصدير كل بيانات المدرسة (نسخة يحتفظ بها المدير)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const data = await inTenant(req, async (q) => ({
    school: req.tenant.name,
    exported_at: new Date().toISOString(),
    classes: await q("SELECT id, name FROM classes ORDER BY id"),
    subjects: await q("SELECT id, name FROM subjects ORDER BY id"),
    teachers: await q(`SELECT t.id, t.full_name AS name, t.phone, u.username FROM teachers t
                       LEFT JOIN users u ON u.teacher_id = t.id ORDER BY t.id`),
    students: await q(`SELECT s.id, s.full_name AS name, c.name AS class_name, s.guardian_name, s.guardian_phone,
                              s.access_key, s.fees_enabled, s.archived_at, s.created_at
                         FROM students s LEFT JOIN classes c ON c.id = s.class_id ORDER BY s.full_name`),
    attendance: await q(`SELECT a.day, s.full_name AS student, a.status, a.note, a.recorded_by
                           FROM attendance a JOIN students s ON s.id = a.student_id ORDER BY a.day DESC LIMIT 20000`),
    exams: await q(`SELECT e.id, e.title, c.name AS class_name, sub.name AS subject, e.exam_date, e.max_score, e.status
                      FROM exams e JOIN classes c ON c.id = e.class_id JOIN subjects sub ON sub.id = e.subject_id ORDER BY e.id`),
    scores: await q(`SELECT e.title AS exam, sub.name AS subject, s.full_name AS student, sc.score, e.max_score
                       FROM scores sc JOIN exams e ON e.id = sc.exam_id JOIN subjects sub ON sub.id = e.subject_id
                       JOIN students s ON s.id = sc.student_id ORDER BY e.id`),
    timetable: await q(`SELECT c.name AS class_name, t.day, t.period, sub.name AS subject, te.full_name AS teacher, t.room
                          FROM timetable_slots t JOIN classes c ON c.id = t.class_id JOIN subjects sub ON sub.id = t.subject_id
                          LEFT JOIN teachers te ON te.id = t.teacher_id ORDER BY c.id, t.day, t.period`),
    invoices: await q(`SELECT i.id, s.full_name AS student, i.title, i.amount, invoice_net_paid(i.id) AS paid,
                              i.due_date, i.status, i.created_at
                         FROM invoices i JOIN students s ON s.id = i.student_id ORDER BY i.id`),
    payments: await q(`SELECT p.receipt_no, s.full_name AS student, i.title, p.kind, p.amount, p.method, p.created_at
                         FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = i.student_id
                        ORDER BY p.id`),
    announcements: await q("SELECT title, body, created_at FROM announcements ORDER BY id DESC"),
  }));
  res.set("Cache-Control", "no-store").json(data);
}));

export default r;
