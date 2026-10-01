// السنة الدراسية والفصول الدراسية
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as academic from "../shared/academic.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    await academic.ensureDefaults(q);
    return {
    current: await academic.current(q),
    years: await academic.listYears(q),
    terms: await academic.listTerms(q),
    states: academic.STATES,
  };}));
}));

/* ---------- الإجازات والعطل ---------- */
r.get("/holidays", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({ holidays: await academic.listHolidays(q), kinds: academic.HOLIDAY_KINDS })));
}));
r.post("/holidays", handle(async (req, res) => {
  const b = parse(academic.holidaySchema, req.body);
  res.status(201).json(await inTenant(req, (q) => academic.addHoliday(q, b)));
}));
r.put("/holidays/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(academic.holidaySchema, req.body);
  await inTenant(req, (q) => academic.updateHoliday(q, id, b));
  res.json({ ok: true });
}));
r.delete("/holidays/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => academic.deleteHoliday(q, id));
  res.json({ ok: true });
}));

// تعديل السنة الحالية وعدد فصولها (نفس ما يفعله معالج الإعداد الأول)
r.put("/year", handle(async (req, res) => {
  const b = parse(academic.yearSchema.omit({ make_current: true }), req.body);
  res.json(await inTenant(req, (q) => academic.configureYear(q, b)));
}));

r.post("/years", handle(async (req, res) => {
  const b = parse(academic.yearSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => academic.createYear(q, b)));
}));

r.post("/terms/:id/current", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => academic.setCurrentTerm(q, id)));
}));

r.patch("/terms/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(academic.termSchema, req.body);
  await inTenant(req, (q) => academic.updateTerm(q, id, b));
  res.json({ ok: true });
}));

// معاينة النتائج والإجراء المقترح لكل طالب قبل التنفيذ
r.post("/promotion-preview", handle(async (req, res) => {
  const b = parse(academic.rolloverSchema.partial({ year: true }), req.body);
  res.json(await inTenant(req, (q) => academic.promotionPreview(q, b.moves || [])));
}));

r.patch("/years/:id/status", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(academic.yearStatusSchema, req.body);
  await inTenant(req, (q) => academic.setYearStatus(q, id, b.status));
  res.json({ ok: true });
}));

r.patch("/years/:id/pass-mark", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(academic.passMarkSchema, req.body);
  await inTenant(req, (q) => academic.setPassMark(q, id, b.pass_mark));
  res.json({ ok: true });
}));

// بدء سنة جديدة: أرشفة السنة المنتهية ونقل الطلاب
r.post("/start-year", handle(async (req, res) => {
  const b = parse(academic.rolloverSchema, req.body);
  res.json(await inTenant(req, (q) => academic.startNewYear(q, b)));
}));

// سجل الطالب عبر السنوات
r.get("/students/:id/history", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, async (q) => {
    if (!(await q("SELECT 1 FROM students WHERE id = $1", [id])).length) throw notFound("الطالب غير موجود");
    return q(
    `SELECT sy.year_id, y.name AS year_name, sy.class_name, sy.result, sy.outcome, sy.average, sy.attendance_rate, sy.note, sy.archived_at
       FROM student_years sy JOIN academic_years y ON y.id = sy.year_id
      WHERE sy.student_id = $1 ORDER BY y.start_date DESC`, [id]);
  }));
}));

export default r;
