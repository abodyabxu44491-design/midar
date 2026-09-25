// موقع المدرسة المصغّر (صفحة الطلاب وأولياء الأمور):
//   الرئيسية ← الطلاب ← المراحل ← الصفوف ← الشعب ← قائمة الطلاب (صفحة بعد صفحة)
// يستهلك بيانات الطلاب الموجودة في النظام نفسه، مع طبقة نشر تتحكم بها الإدارة:
// لا يظهر أي عنصر إلا إذا فعّلته المدرسة، وبطاقة الطالب لا تحمل إلا ما سمحت بنشره.
import { Router } from "express";
import { handle, forbidden, notFound, unauthorized } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { recentFailures, securityEvent } from "../../core/audit.js";
import { transaction } from "../../core/db/pool.js";
import { inSchool, accessSchema, checkAccess } from "./context.js";
import { getSettings } from "../shared/public-settings.service.js";
import { studentSummaries } from "../shared/finance.service.js";
import { forAllClasses } from "../shared/timetable.service.js";

const r = Router({ mergeParams: true });
const base = accessSchema.partial();
const gate = (settings, tenant, access) => { if (settings.access_mode === "code") checkAccess(tenant, access); };
const ACTIVE = "s.status = 'active'";

// بطاقة الطالب: الاسم، وحالة السداد فقط إن فعّلت المدرسة إظهارها للجميع
async function cards(q, rows, settings) {
  if (!settings.public_fee_badges) return rows.map(({ id, name }) => ({ id, name }));
  const sums = await studentSummaries(q, rows.filter((s) => s.fees_enabled).map((s) => s.id));
  return rows.map((s) => {
    const f = s.fees_enabled ? sums.get(Number(s.id)) : null;
    return { id: s.id, name: s.name, fees: f && f.status !== "none" ? f.status : null };
  });
}

/* ---------- الرئيسية ---------- */
r.post("/home", limits.api, handle(async (req, res) => {
  const b = parse(base, req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    const [profile] = settings.show_contact
      ? await q("SELECT city, address, phone, email FROM school_profile WHERE tenant_id = app_tenant()") : [];
    const [logo] = await q("SELECT logo_image_id FROM exam_paper_settings WHERE tenant_id = app_tenant() AND show_logo");
    const [counts] = settings.show_class_counts ? await q(
      `SELECT (SELECT count(*) FROM students s WHERE ${ACTIVE})::int AS students,
              (SELECT count(*) FROM classes)::int AS sections,
              (SELECT count(*) FROM grades)::int AS grades`) : [null];
    return {
      school: { name: tenant.name, about: settings.about || null, logo: Boolean(logo?.logo_image_id) },
      contact: settings.show_contact && profile ? profile : null,
      counts: counts || null,
      announcements: settings.show_announcements
        ? await q("SELECT title, body, created_at FROM announcements WHERE class_id IS NULL ORDER BY id DESC LIMIT 6") : [],
      features: {
        directory: settings.show_classes, names: settings.show_student_names, search: settings.show_search,
        admissions: settings.show_admissions, find_by_key: true, access_mode: settings.access_mode,
      },
    };
  }));
}));

/* ---------- المراحل والصفوف ---------- */
r.post("/structure", limits.api, handle(async (req, res) => {
  const b = parse(base, req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    if (!settings.show_classes) throw forbidden("قائمة الصفوف غير معروضة في هذه المدرسة");
    const rows = await q(
      `SELECT st.id AS stage_id, st.name AS stage, g.id AS grade_id, g.name AS grade,
              count(DISTINCT c.id)::int AS sections,
              count(s.id) FILTER (WHERE ${ACTIVE})::int AS students
         FROM grades g LEFT JOIN stages st ON st.id = g.stage_id
         LEFT JOIN classes c ON c.grade_id = g.id LEFT JOIN students s ON s.class_id = c.id
        GROUP BY st.id, st.name, st.sort_order, g.id, g.name, g.sort_order
        ORDER BY st.sort_order NULLS LAST, st.id NULLS LAST, g.sort_order NULLS LAST, g.id`);
    const loose = await q(`SELECT count(*)::int AS n FROM classes WHERE grade_id IS NULL`);
    const stages = [];
    for (const x of rows) {
      let st = stages.find((s) => s.id === (x.stage_id ?? 0));
      if (!st) stages.push(st = { id: x.stage_id ?? 0, name: x.stage || "صفوف أخرى", grades: [] });
      st.grades.push({ id: x.grade_id, name: x.grade, sections: x.sections, students: settings.show_class_counts ? x.students : null });
    }
    // شعب بلا صف (مدارس لم تستخدم المراحل والصفوف): تظهر كصف واحد «شعب أخرى»
    if (loose[0].n) stages.push({ id: -1, name: "صفوف أخرى", grades: [{ id: 0, name: "شعب أخرى", sections: loose[0].n, students: null }] });
    return { stages, counts: settings.show_class_counts };
  }));
}));

/* ---------- صفحة الصف: شعبه ---------- */
r.post("/grade", limits.api, handle(async (req, res) => {
  const b = parse(base.extend({ grade_id: z.coerce.number().int().min(0) }), req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    if (!settings.show_classes) throw forbidden("قائمة الصفوف غير معروضة في هذه المدرسة");
    const [grade] = b.grade_id ? await q(
      `SELECT g.id, g.name, st.name AS stage FROM grades g LEFT JOIN stages st ON st.id = g.stage_id WHERE g.id = $1`, [b.grade_id])
      : [{ id: 0, name: "شعب أخرى", stage: null }];
    if (!grade) throw notFound("الصف غير موجود");
    const sections = await q(
      `SELECT c.id, c.name, count(s.id) FILTER (WHERE ${ACTIVE})::int AS students
         FROM classes c LEFT JOIN students s ON s.class_id = c.id
        WHERE ${b.grade_id ? "c.grade_id = $1" : "c.grade_id IS NULL"}
        GROUP BY c.id, c.name, c.sort_order ORDER BY c.sort_order NULLS LAST, c.id`, b.grade_id ? [b.grade_id] : []);
    return { grade, sections: sections.map((c) => ({ id: c.id, name: c.name, students: settings.show_class_counts ? c.students : null })),
      names: settings.show_student_names };
  }));
}));

/* ---------- الشعبة: الطلاب صفحة بعد صفحة، ومعلموها وجدولها إن سُمح ---------- */
r.post("/section", limits.api, handle(async (req, res) => {
  const b = parse(base.extend({
    class_id: t.id, offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(60).default(30), q: z.string().trim().max(60).optional(),
  }), req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    if (!settings.show_classes) throw forbidden("قائمة الصفوف غير معروضة في هذه المدرسة");
    const [cls] = await q("SELECT id, name FROM classes WHERE id = $1", [b.class_id]);
    if (!cls) throw notFound("الشعبة غير موجودة");
    const out = { section: cls, students: null, total: null, teachers: null, timetable: null };
    if (settings.show_student_names) {
      const params = [b.class_id];
      let filter = "";
      if (b.q) { params.push(b.q); filter = ` AND s.full_name ILIKE '%' || $2 || '%'`; }
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM students s WHERE s.class_id = $1 AND ${ACTIVE}${filter}`, params);
      const rows = await q(
        `SELECT s.id, s.full_name AS name, s.fees_enabled FROM students s
          WHERE s.class_id = $1 AND ${ACTIVE}${filter} ORDER BY s.full_name LIMIT ${b.limit} OFFSET ${b.offset}`, params);
      out.students = await cards(q, rows, settings);
      out.total = n;
    }
    if (b.offset === 0 && settings.show_teachers) {
      out.teachers = await q(
        `SELECT t.full_name AS teacher, sub.name AS subject FROM teacher_assignments a
           JOIN teachers t ON t.id = a.teacher_id JOIN subjects sub ON sub.id = a.subject_id
          WHERE a.class_id = $1 ORDER BY sub.sort_order NULLS LAST, sub.name`, [b.class_id]);
    }
    if (b.offset === 0 && settings.show_timetable) {
      out.timetable = (await forAllClasses(q)).filter((x) => Number(x.class_id) === Number(b.class_id))
        .map(({ day, period, subject, teacher, room }) => ({ day, period, subject, teacher, room }));
    }
    return out;
  }));
}));

/* ---------- البحث عن طالب بمعرّفه (يفتح ملفه مباشرة) ---------- */
// المعرّف سري لكل طالب، والمحاولات الخاطئة تُسجل وتُحسب (مثل فتح الملف تمامًا)
r.post("/find", limits.studentKey, handle(async (req, res) => {
  const b = parse(base.extend({ key: t.studentKey }), req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const settings = await getSettings(q);
    gate(settings, tenant, b.access);
    const ipSubject = `${tenant.id}:find:${req.ip || "unknown"}`;
    if ((await recentFailures(q, "student_key_failed_ip", ipSubject, 30)) >= 10) {
      throw unauthorized("تم إيقاف المحاولة مؤقتًا بسبب محاولات خاطئة كثيرة. حاول بعد 30 دقيقة.");
    }
    const [s] = await q(`SELECT s.id FROM students s WHERE s.access_key = $1 AND ${ACTIVE}`, [b.key]);
    if (!s) {
      // التسجيل في معاملة مستقلة: الخطأ يلغي المعاملة الحالية، والمحاولة يجب أن تُحسب
      await transaction({ tenantId: tenant.id, actor: "زائر", ip: req.ip }, (q2) =>
        securityEvent(q2, { kind: "student_key_failed_ip", subject: ipSubject, tenantId: tenant.id, ip: req.ip }));
      throw unauthorized("المعرّف غير صحيح. تأكد منه كما في بطاقة الطالب.");
    }
    return { student_id: s.id };
  }));
}));

/* ---------- شعار المدرسة (عام، مثل اسمها) ---------- */
r.get("/logo", handle(async (req, res) => {
  const img = await inSchool(req, "زائر", async (q) => {
    const [row] = await q(
      `SELECT i.mime, i.data FROM exam_paper_settings s JOIN exam_images i ON i.id = s.logo_image_id
        WHERE s.tenant_id = app_tenant() AND s.show_logo`);
    return row;
  });
  if (!img) throw notFound("لا يوجد شعار");
  res.set("Cache-Control", "public, max-age=3600").type(img.mime).send(img.data);
}));

export default r;
