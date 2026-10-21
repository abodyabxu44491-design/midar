/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
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

r.get("/holidays", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({ holidays: await academic.listHolidays(q), kinds: academic.HOLIDAY_KINDS })));
}));
// What declaring a holiday on these days would change (attendance already recorded on them).
r.get("/holidays/impact", handle(async (req, res) => {
  const f = parse(z.object({ from: t.date, to: t.date }), req.query);
  res.json(await inTenant(req, (q) => academic.holidayImpact(q, f.from, f.to)));
}));
// Every change to holidays re-applies them to attendance: records inside a holiday are set aside (the days
// count as a holiday), and records of days no longer in a holiday come back.
const notifySchema = z.object({ notify: z.boolean().default(false) });
r.post("/holidays", handle(async (req, res) => {
  const b = parse(academic.holidaySchema, req.body);
  const { notify: tell } = parse(notifySchema, req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    const row = await academic.addHoliday(q, b);
    const sync = await academic.syncHolidayAttendance(q);
    if (tell) await academic.announceHoliday(q, b);
    return { ...row, ...sync };
  }));
}));
r.put("/holidays/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(academic.holidaySchema, req.body);
  res.json(await inTenant(req, async (q) => {
    await academic.updateHoliday(q, id, b);
    return { ok: true, ...(await academic.syncHolidayAttendance(q)) };
  }));
}));
r.delete("/holidays/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, async (q) => {
    await academic.deleteHoliday(q, id);
    return { ok: true, ...(await academic.syncHolidayAttendance(q)) };
  }));
}));

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

r.post("/start-year", handle(async (req, res) => {
  const b = parse(academic.rolloverSchema, req.body);
  res.json(await inTenant(req, (q) => academic.startNewYear(q, b)));
}));

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
