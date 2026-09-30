// بيانات المعلم، فصوله، والإعلانات
import { Router } from "express";
import { logoId } from "../shared/school-logo.service.js";
import { accessSummary } from "../shared/subscription.service.js";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { myLoad, teachesClass } from "./access.js";
import { forTeacher } from "../shared/timetable.service.js";
import * as alerts from "../shared/student-alerts.service.js";
import { current } from "../shared/academic.service.js";

const r = Router();

r.get("/me", handle(async (req, res) => {
  const { school, photo, ...data } = await inTenant(req, async (q) => ({
    load: await myLoad(q, req.user.teacher_id), academic: await current(q),
    school: await logoId(q),
    photo: (await q("SELECT (photo IS NOT NULL) AS has, extract(epoch FROM updated_at)::bigint AS v FROM teachers WHERE id = $1", [req.user.teacher_id]))[0],
  }));
  res.json({ access: accessSummary(req), modules: req.modules, name: req.user.full_name, user_id: req.user.id, must_change_password: req.user.must_change_password,
    school: { id: req.tenant.id, name: req.tenant.name, logo: school },
    photo: photo?.has ? `/api/teacher/photo?v=${photo.v}` : null, ...data });
}));

// صورة المعلم نفسه (يرفعها المدير من ملف المعلم)
r.get("/photo", handle(async (req, res) => {
  const [p] = await inTenant(req, (q) => q("SELECT photo, photo_type FROM teachers WHERE id = $1 AND photo IS NOT NULL", [req.user.teacher_id]));
  if (!p) return res.status(404).json({ error: "لا توجد صورة" });
  res.set({ "Content-Type": p.photo_type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" }).send(p.photo);
}));

// ملف المعلم كاملًا لصفحة «حسابي» (بلا أي سر: لا كلمة مرور ولا hash)
r.get("/profile", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const [p] = await q(
      `SELECT full_name AS name, short_name, gender, birth_date, national_id, phone, email, address, emergency_name, emergency_phone,
              employee_no, job_title, specialty, qualification, department, hire_date, employment_type
         FROM teachers WHERE id = $1`, [req.user.teacher_id]);
    if (!p) throw notFound("الملف غير موجود");
    const [u] = await q("SELECT username, last_login_at, password_changed_at, created_at FROM users WHERE id = $1", [req.user.id]);
    const load = await myLoad(q, req.user.teacher_id);
    const classIds = [...new Set(load.map((l) => l.class_id))];
    const [{ n }] = await q("SELECT count(*)::int AS n FROM students WHERE class_id = ANY($1) AND archived_at IS NULL", [classIds]);
    return { profile: p, account: u, school: { id: req.tenant.id, name: req.tenant.name },
      summary: { classes: classIds.length, subjects: new Set(load.map((l) => l.subject_id)).size, students: n,
        periods_per_week: (await forTeacher(q, req.user.teacher_id)).length } };
  }));
}));

// المعلم يحدّث بيانات التواصل فقط؛ البيانات الوظيفية والشخصية تعدّلها الإدارة
const contactSchema = z.object({
  phone: t.phone, address: t.optText(200), emergency_name: t.optText(120), emergency_phone: t.phone,
  email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
});
r.patch("/profile", handle(async (req, res) => {
  const b = parse(contactSchema, req.body);
  await inTenant(req, (q) => q(
    "UPDATE teachers SET phone = $2, email = $3, address = $4, emergency_name = $5, emergency_phone = $6, updated_at = now() WHERE id = $1",
    [req.user.teacher_id, b.phone ?? null, b.email ?? null, b.address ?? null, b.emergency_name ?? null, b.emergency_phone ?? null]));
  res.json({ ok: true });
}));

// طلاب فصل مسند للمعلم مع ملخص حضورهم في السنة الحالية (بلا بيانات تواصل أولياء الأمور)
r.get("/students", handle(async (req, res) => {
  const { class_id } = parse(z.object({ class_id: t.id }), req.query);
  res.json(await inTenant(req, async (q) => {
    if (!(await teachesClass(q, req.user.teacher_id, class_id))) throw forbidden("هذا الفصل غير مسند لك");
    const year = await current(q);
    return q(
      `SELECT s.id, s.full_name AS name, s.student_no, s.gender, s.status,
              count(a.*) FILTER (WHERE a.status = 'absent')::int AS absent,
              count(a.*) FILTER (WHERE a.status = 'late')::int AS late,
              count(a.*) FILTER (WHERE a.status = 'excused')::int AS excused,
              count(a.*)::int AS days,
              max(a.status) FILTER (WHERE a.day = CURRENT_DATE) AS today,
              (SELECT count(*)::int FROM student_alerts al WHERE al.student_id = s.id) AS alerts
         FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND ($2::date IS NULL OR a.day >= $2::date)
        WHERE s.class_id = $1 AND s.archived_at IS NULL
        GROUP BY s.id ORDER BY s.full_name`, [class_id, year?.year_start ?? null]);
  }));
}));

// تنبيهات طلاب فصوله: يرى كل تنبيهات الطالب، ويضيف، ويحذف ما كتبه فقط
const ownStudent = async (q, teacherId, studentId) => {
  const [s] = await q("SELECT class_id FROM students WHERE id = $1 AND archived_at IS NULL", [studentId]);
  if (!s || !(await teachesClass(q, teacherId, s.class_id))) throw forbidden("هذا الطالب ليس ضمن فصولك");
};
r.get("/students/:id/alerts", handle(async (req, res) => {
  const { id } = parse(z.object({ id: t.id }), req.params);
  res.json(await inTenant(req, async (q) => { await ownStudent(q, req.user.teacher_id, id); return alerts.list(q, id); }));
}));
r.post("/students/:id/alerts", handle(async (req, res) => {
  const { id } = parse(z.object({ id: t.id }), req.params);
  const b = parse(alerts.alertSchema, req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    await ownStudent(q, req.user.teacher_id, id);
    return alerts.create(q, id, b, { actor: req.actor, teacherId: req.user.teacher_id });
  }));
}));
r.delete("/alerts/:alertId", handle(async (req, res) => {
  const { alertId } = parse(z.object({ alertId: t.id }), req.params);
  res.json(await inTenant(req, (q) => alerts.remove(q, alertId, { teacherId: req.user.teacher_id })));
}));

r.get("/announcements", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(
    `SELECT a.title, a.body, a.created_at, c.name AS class_name FROM announcements a LEFT JOIN classes c ON c.id = a.class_id
      WHERE a.class_id IS NULL OR a.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = $1)
      ORDER BY a.id DESC LIMIT 50`, [req.user.teacher_id])));
}));

export default r;
