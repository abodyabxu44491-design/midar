// الاستيراد من ملفات: تنزيل القالب، معاينة الملف، ثم الاستيراد
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { KINDS, template, importRows, rowsSchema } from "../shared/import.service.js";
import * as studentsImport from "../shared/import-students.service.js";
import * as teachersImport from "../shared/import-teachers.service.js";

const r = Router();
const kindParam = z.enum(Object.keys(KINDS));

// قائمة أنواع الاستيراد وأعمدتها (تُبنى منها الواجهة)
r.get("/kinds", handle(async (req, res) => {
  res.json(Object.entries(KINDS).map(([key, def]) => ({
    key, name: def.name, note: def.note,
    columns: def.columns.map((c) => ({ header: c.header, required: Boolean(c.required) })),
  })));
}));

/* ---------- استيراد الطلاب (Excel/CSV): قالب، تحليل، تنفيذ ---------- */
const studentsRows = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1, "الملف فارغ").max(2000, "الحد 2000 سطر في المرة"),
  // اختيارات المستخدم للصفوف الملتبسة: { "مفتاح القيمة": رقم الصف }
  grade_map: z.record(z.string().max(120), z.coerce.number().int().positive()).default({}),
  include_duplicates: z.boolean().default(false),
});
const templateQuery = z.object({
  grade_id: z.coerce.number().int().positive().optional(),
  class_id: z.coerce.number().int().positive().optional(),
  existing: z.enum(["1"]).optional(),
});

r.get("/students/template", handle(async (req, res) => {
  const f = parse(templateQuery, req.query);
  const { buffer, filename } = await inTenant(req, (q) => studentsImport.buildTemplate(q, { ...f, existing: f.existing === "1" }));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}));

// تحليل بلا أي كتابة في قاعدة البيانات
r.post("/students/analyze", handle(async (req, res) => {
  const b = parse(studentsRows, req.body);
  const a = await inTenant(req, (q) => studentsImport.analyze(q, req.tenant, b.rows, { gradeMap: b.grade_map, includeDuplicates: b.include_duplicates }));
  const { _internal, ...out } = a;
  res.json(out);
}));

// التنفيذ: يعيد التحليل في الخادم ثم يكتب الأسطر الصحيحة كلها في معاملة واحدة
r.post("/students/commit", handle(async (req, res) => {
  const b = parse(studentsRows, req.body);
  res.json(await inTenant(req, (q) => studentsImport.commit(q, req.tenant, b.rows, { gradeMap: b.grade_map, includeDuplicates: b.include_duplicates })));
}));

/* ---------- استيراد المعلمين (Excel/CSV): مطابقة أعمدة، تحليل، تنفيذ، قالب، تصدير ---------- */
const teachersRows = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1, "الملف فارغ").max(teachersImport.MAX_ROWS, `الحد ${teachersImport.MAX_ROWS} معلم في المرة`),
  grade_map: z.record(z.string().max(120), z.coerce.number().int().positive()).default({}),
});

r.get("/teachers/fields", handle(async (req, res) => {
  res.json(teachersImport.FIELDS.map(({ key, label, required }) => ({ key, label, required: Boolean(required) })));
}));
r.post("/teachers/map", handle(async (req, res) => {
  const { headers } = parse(z.object({ headers: z.array(z.string().max(120)).min(1).max(80) }), req.body);
  res.json(teachersImport.suggestMapping(headers));
}));
r.get("/teachers/template", handle(async (req, res) => {
  const f = parse(z.object({ stage_id: z.coerce.number().int().positive().optional(), subject_id: z.coerce.number().int().positive().optional(), existing: z.enum(["1"]).optional() }), req.query);
  const { buffer, filename } = await inTenant(req, (q) => teachersImport.buildTemplate(q, { ...f, existing: f.existing === "1" }));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}));
r.get("/teachers/export", handle(async (req, res) => {
  const buffer = await inTenant(req, (q) => teachersImport.exportXlsx(q));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent("المعلمون.xlsx")}`);
  res.send(buffer);
}));
r.post("/teachers/analyze", handle(async (req, res) => {
  const b = parse(teachersRows, req.body);
  const a = await inTenant(req, (q) => teachersImport.analyze(q, b.rows, { gradeMap: b.grade_map, maxTeachers: req.subscription?.max_teachers ?? null }));
  const { _internal, ...out } = a;
  res.json(out);
}));
r.post("/teachers/commit", handle(async (req, res) => {
  const b = parse(teachersRows, req.body);
  res.set("Cache-Control", "no-store");   // الاستجابة فيها كلمات مرور مؤقتة: لا تُخزَّن
  res.json(await inTenant(req, (q) => teachersImport.commit(q, req.tenantId, b.rows, { gradeMap: b.grade_map, maxTeachers: req.subscription?.max_teachers ?? null })));
}));

// تنزيل القالب جاهزًا للتعبئة في Excel
r.get("/template/:kind", handle(async (req, res) => {
  const kind = parse(kindParam, req.params.kind);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`قالب-${KINDS[kind].name}.csv`)}`);
  res.send(template(kind));
}));

// معاينة أو استيراد. الاستيراد كامل أو لا شيء.
r.post("/:kind", handle(async (req, res) => {
  const kind = parse(kindParam, req.params.kind);
  const b = parse(rowsSchema, req.body);
  const result = await inTenant(req, async (q) => {
    const out = await importRows(q, req.tenant, kind, b.rows, { dryRun: b.dry_run, actor: req.actor });
    if (out.errors.length) throw badRequest(`الملف يحتاج تصحيحًا: ${out.errors.length} خطأ`, { errors: out.errors });
    return out;
  });
  res.json(result);
}));

export default r;
