// معالج إعداد المدرسة والهيكل الأكاديمي
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as S from "../shared/structure.service.js";

const r = Router();

// حالة الإعداد: الملف + الهيكل + الكتالوج المقترح
r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    profile: await S.getProfile(q),
    structure: await S.structure(q),
    catalog: S.catalog(),
  })));
}));

r.put("/profile", handle(async (req, res) => {
  const b = parse(S.profileSchema, req.body);
  res.json(await inTenant(req, (q) => S.updateProfile(q, b)));
}));

r.post("/template", handle(async (req, res) => {
  const b = parse(S.templateSchema, req.body);
  res.json(await inTenant(req, (q) => S.applyTemplate(q, b)));
}));

r.post("/complete", handle(async (req, res) => {
  await inTenant(req, S.completeSetup);
  res.json({ ok: true });
}));

r.post("/reopen", handle(async (req, res) => {
  await inTenant(req, (q) => q("UPDATE school_profile SET setup_completed_at = NULL WHERE tenant_id = app_tenant()"));
  res.json({ ok: true });
}));

/* ---------- المراحل ---------- */
r.post("/stages", handle(async (req, res) => {
  const b = parse(S.stageSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => S.addStage(q, b)));
}));
r.patch("/stages/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(S.stageSchema, req.body);
  await inTenant(req, (q) => S.updateStage(q, id, b));
  res.json({ ok: true });
}));
r.delete("/stages/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => S.deleteStage(q, id));
  res.json({ ok: true });
}));

/* ---------- الصفوف ---------- */
r.post("/grades", handle(async (req, res) => {
  const b = parse(S.gradeSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => S.addGrade(q, b)));
}));
r.patch("/grades/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(S.gradeSchema.partial(), req.body);
  await inTenant(req, (q) => S.updateGrade(q, id, b));
  res.json({ ok: true });
}));
r.delete("/grades/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => S.deleteGrade(q, id));
  res.json({ ok: true });
}));
r.post("/stages/:id/reorder", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { ids } = parse(z.object({ ids: z.array(t.id).max(60) }), req.body);
  await inTenant(req, (q) => S.reorderGrades(q, id, ids));
  res.json({ ok: true });
}));

/* ---------- الشعب ---------- */
r.post("/grades/:id/sections", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(S.sectionsSchema, req.body);
  const created = await inTenant(req, (q) => S.createSections(q, id, b));
  res.status(201).json({ created: created.length, sections: created });
}));
r.patch("/sections/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(z.object({ name: t.shortText("اسم الشعبة", 60).optional(), grade_id: t.optId,
    sort_order: z.coerce.number().int().min(0).max(99).optional() }), req.body);
  await inTenant(req, (q) => S.updateSection(q, id, b));
  res.json({ ok: true });
}));

/* ---------- النسخ ---------- */
// نسخ مواد صف إلى صف آخر (نفس الإعدادات، ثم عدّل الفروق)
r.post("/grades/:id/copy-subjects", handle(async (req, res) => {
  const from = parse(t.id, req.params.id);
  const { to_grade_id: to, replace } = parse(
    z.object({ to_grade_id: t.id, replace: z.boolean().default(false) }), req.body);
  res.json(await inTenant(req, async (q) => {
    const [target] = await q("SELECT id FROM grades WHERE id = $1", [to]);
    if (!target) throw notFound("الصف الهدف غير موجود");
    if (replace) await q("DELETE FROM subject_grades WHERE grade_id = $1", [to]);
    const rows = await q(
      `INSERT INTO subject_grades (tenant_id, subject_id, grade_id)
       SELECT app_tenant(), sg.subject_id, $2 FROM subject_grades sg WHERE sg.grade_id = $1
       ON CONFLICT DO NOTHING RETURNING subject_id`, [from, to]);
    return { copied: rows.length };
  }));
}));

/* ---------- المواد ---------- */
r.post("/subjects", handle(async (req, res) => {
  const b = parse(S.subjectSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => S.addSubject(q, b)));
}));
r.patch("/subjects/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(S.subjectSchema.partial(), req.body);
  await inTenant(req, (q) => S.updateSubject(q, id, b));
  res.json({ ok: true });
}));

export default r;
