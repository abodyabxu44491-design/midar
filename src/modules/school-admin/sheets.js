// أوراق جاهزة للطباعة: بطاقات معرّفات الطلاب، وسجل الحضور الشهري
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { qrDataUrl } from "../shared/certificates.service.js";
import { logoId } from "../shared/school-logo.service.js";
import { originOf } from "./certificates.js";

const r = Router();

// بطاقات ولي الأمر: اسم الطالب وصفه ورقمه وولي أمره ومعرّفه، ورابط يفتح ملفه مباشرة مع رمز QR له
r.get("/cards", handle(async (req, res) => {
  const { class_id: classId, student_id: studentId } = parse(
    z.object({ class_id: t.id.optional(), student_id: t.id.optional() }), req.query);
  const origin = originOf(req);
  res.json(await inTenant(req, async (q) => {
    const [school] = await q(`SELECT id, name, directory_code,
        COALESCE((SELECT country_code FROM school_messages WHERE tenant_id = app_tenant()), '967') AS country_code
      FROM tenants WHERE id = app_tenant()`);
    const students = await q(
      `SELECT s.id, s.full_name AS name, s.access_key, s.student_no, s.guardian_name, s.guardian_phone, c.name AS class_name
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.status = 'active' AND ($1::bigint IS NULL OR s.class_id = $1) AND ($2::bigint IS NULL OR s.id = $2)
        ORDER BY c.sort_order NULLS LAST, c.id NULLS LAST, s.full_name`, [classId ?? null, studentId ?? null]);
    const base = `${origin}/${encodeURIComponent(school.id)}`;
    return {
      school: school.name, school_id: school.id, directory_code: school.directory_code, link: base, logo: await logoId(q),
      country_code: school.country_code,
      students: students.map((s) => {
        const link = `${base}?k=${encodeURIComponent(s.access_key)}`;
        return { ...s, link, qr: qrDataUrl(link) };
      }),
    };
  }));
}));

// سجل الحضور الشهري: صفوف الطلاب × أيام الشهر
r.get("/attendance-month", handle(async (req, res) => {
  const { class_id: classId, month } = parse(
    z.object({ class_id: t.id, month: z.string().regex(/^\d{4}-\d{2}$/, "الشهر بصيغة YYYY-MM") }), req.query);
  const from = `${month}-01`;

  res.json(await inTenant(req, async (q) => {
    const [cls] = await q("SELECT id, name FROM classes WHERE id = $1", [classId]);
    if (!cls) throw notFound("الفصل غير موجود");
    const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");
    const [range] = await q(
      `SELECT $1::date AS start, ($1::date + interval '1 month - 1 day')::date AS finish,
              extract(day FROM ($1::date + interval '1 month - 1 day'))::int AS days`, [from]);

    const students = await q(
      "SELECT id, full_name AS name FROM students WHERE class_id = $1 AND status = 'active' ORDER BY full_name",
      [classId]);
    const marks = await q(
      `SELECT a.student_id, extract(day FROM a.day)::int AS day, a.status
         FROM attendance a JOIN students s ON s.id = a.student_id
        WHERE s.class_id = $1 AND a.day BETWEEN $2 AND $3`, [classId, range.start, range.finish]);

    const rows = students.map((s) => {
      const mine = marks.filter((m) => Number(m.student_id) === Number(s.id));
      const byDay = Object.fromEntries(mine.map((m) => [m.day, m.status]));
      const count = (st) => mine.filter((m) => m.status === st).length;
      const recorded = mine.length;
      const attended = count("present") + count("late");
      return {
        id: s.id, name: s.name, days: byDay,
        present: count("present"), absent: count("absent"), late: count("late"), excused: count("excused"),
        rate: recorded ? Math.round((attended / recorded) * 100) : null,
      };
    });

    return { school: school.name, class_name: cls.name, month, days: range.days, students: rows };
  }));
}));

export default r;
