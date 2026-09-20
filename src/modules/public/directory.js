// صفحة المدرسة العامة: محتواها يتحدد من إعدادات الإدارة
//   - access_mode: مفتوحة أو تحتاج رمزًا
//   - الصفوف، أسماء الطلاب، البحث، جدول المعلمين، الأعداد، الإعلانات، شارات السداد
// لا يُعرض أي عنصر إلا إذا فعّلته المدرسة.
import { Router } from "express";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, accessSchema, checkAccess } from "./context.js";
import { getSettings } from "../shared/public-settings.service.js";
import { studentSummaries } from "../shared/finance.service.js";
import { forAllClasses } from "../shared/timetable.service.js";

const r = Router({ mergeParams: true });
const openSchema = accessSchema.partial();
const searchSchema = openSchema.extend({ q: z.string().trim().min(2, "اكتب حرفين على الأقل").max(60) });

// في الوضع المفتوح لا يُطلب رمز، وفي وضع الرمز يُتحقق منه في كل طلب
function gate(settings, tenant, access) {
  if (settings.access_mode === "code") checkAccess(tenant, access);
}

// حالة السداد تُحسب فقط إذا فعّلت المدرسة إظهارها للجميع، وباستعلام واحد لكل الطلاب
async function withBadges(q, students, settings) {
  if (!settings.public_fee_badges) return students.map(({ id, name }) => ({ id, name }));
  const summaries = await studentSummaries(q, students.filter((s) => s.fees_enabled).map((s) => s.id));
  return students.map((s) => {
    const fees = s.fees_enabled ? summaries.get(Number(s.id)) : null;
    return { id: s.id, name: s.name, fees: fees && fees.status !== "none" ? fees.status : null };
  });
}

const classTeachers = (q) => q(
  `SELECT a.class_id, t.full_name AS teacher, sub.name AS subject
     FROM teacher_assignments a JOIN teachers t ON t.id = a.teacher_id JOIN subjects sub ON sub.id = a.subject_id
    ORDER BY sub.name`);

/* التحقق من الرمز (وضع الرمز فقط) */
r.post("/open", limits.studentKey, handle(async (req, res) => {
  const b = parse(openSchema, req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    return { ok: true, school: tenant.name };
  }));
}));

/* محتوى الصفحة حسب الإعدادات */
r.post("/page", limits.api, handle(async (req, res) => {
  const b = parse(openSchema, req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);

    const payload = { school: { name: tenant.name }, settings, classes: [], unassigned: [], announcements: [] };

    if (settings.show_classes) {
      const classes = await q("SELECT id, name FROM classes ORDER BY id");
      const counts = settings.show_class_counts
        ? await q("SELECT class_id, count(*)::int AS n FROM students WHERE archived_at IS NULL GROUP BY class_id") : [];
      const teachers = settings.show_teachers ? await classTeachers(q) : [];
      const slots = settings.show_timetable ? await forAllClasses(q) : [];
      const students = settings.show_student_names
        ? await q("SELECT id, full_name AS name, class_id, fees_enabled FROM students WHERE archived_at IS NULL ORDER BY full_name") : [];

      const badged = settings.show_student_names ? await withBadges(q, students, settings) : [];
      const badgedById = new Map(badged.map((b) => [Number(b.id), b]));
      const withBadge = (list) => list.map((s) => badgedById.get(Number(s.id)));

      for (const c of classes) {
        const mine = students.filter((s) => s.class_id === c.id);
        payload.classes.push({
          id: c.id,
          name: c.name,
          count: settings.show_class_counts ? (counts.find((x) => x.class_id === c.id)?.n ?? 0) : null,
          students: settings.show_student_names ? withBadge(mine) : null,
          teachers: settings.show_teachers ? teachers.filter((t) => t.class_id === c.id).map(({ teacher, subject }) => ({ teacher, subject })) : null,
          timetable: settings.show_timetable
            ? slots.filter((x) => x.class_id === c.id).map(({ day, period, subject, teacher, room }) => ({ day, period, subject, teacher, room }))
            : null,
        });
      }
      if (settings.show_student_names) {
        payload.unassigned = withBadge(students.filter((s) => !s.class_id));
      }
    }

    if (settings.show_announcements) {
      payload.announcements = await q("SELECT title, body, created_at FROM announcements WHERE class_id IS NULL ORDER BY id DESC LIMIT 5");
    }
    payload.admissions = settings.show_admissions;
    return payload;
  }));
}));

/* البحث عن طالب بالاسم (يعمل حتى لو كانت القوائم مخفية) */
r.post("/search", limits.studentKey, handle(async (req, res) => {
  const b = parse(searchSchema, req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    if (!settings.show_search) throw forbidden("البحث غير متاح في هذه المدرسة");
    const rows = await q(
      `SELECT s.id, s.full_name AS name, s.fees_enabled, c.name AS class_name
         FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.archived_at IS NULL AND s.full_name ILIKE '%' || $1 || '%'
        ORDER BY s.full_name LIMIT 20`, [b.q]);
    const named = await withBadges(q, rows, settings);
    return { results: named.map((s, i) => ({ ...s, class_name: rows[i].class_name })) };
  }));
}));

export default r;
