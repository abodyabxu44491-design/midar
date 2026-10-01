// شؤون الموظفين (الإدارة): الحضور، الإجازات، حصص الانتظار، تحضير الدروس، التقويم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { requireModule } from "../../core/auth/guards.js";
import * as sa from "../shared/staff-affairs.service.js";
import * as plans from "../shared/lesson-plans.service.js";
import * as cal from "../shared/calendar.service.js";

export const staff = Router();
const att = Router();
att.get("/", handle(async (req, res) => {
  const { day } = parse(z.object({ day: t.date.optional() }), req.query);
  const d = day || sa.localDay();
  res.json(await inTenant(req, async (q) => ({ day: d, staff: await sa.board(q, d) })));
}));
att.post("/", handle(async (req, res) => {
  const b = parse(sa.markSchema, req.body);
  res.json(await inTenant(req, (q) => sa.mark(q, b, req.actor)));
}));
att.get("/report", handle(async (req, res) => {
  const { from, to } = parse(z.object({ from: t.date, to: t.date }), req.query);
  if (to < from) throw badRequest("تاريخ النهاية قبل البداية");
  res.json(await inTenant(req, (q) => sa.report(q, from, to)));
}));
att.get("/leaves", handle(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional() }), req.query);
  res.json(await inTenant(req, (q) => sa.leaves(q, { status })));
}));
att.post("/leaves", handle(async (req, res) => {
  const b = parse(sa.leaveSchema, req.body);
  if (!b.staff_id) throw badRequest("اختر الموظف");
  res.status(201).json(await inTenant(req, async (q) => {
    const [s] = await q("SELECT id FROM staff WHERE id = $1", [b.staff_id]);
    if (!s) throw badRequest("الموظف غير موجود");
    return sa.requestLeave(q, b, { staffId: b.staff_id, actor: req.actor, approveNow: true });
  }));
}));
att.post("/leaves/:id/decide", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(z.object({ approve: z.boolean(), note: t.optText(300) }), req.body);
  await inTenant(req, (q) => sa.decideLeave(q, id, b, req.actor));
  res.json({ ok: true });
}));
staff.use("/attendance", requireModule("staff_attendance"), att);

const subs = Router();
subs.get("/", handle(async (req, res) => {
  const { day } = parse(z.object({ day: t.date.optional() }), req.query);
  res.json(await inTenant(req, (q) => sa.substitutionNeeds(q, day || sa.localDay())));
}));
subs.post("/", handle(async (req, res) => {
  const b = parse(sa.assignSchema, req.body);
  await inTenant(req, (q) => sa.assign(q, b, req.actor));
  res.json({ ok: true });
}));
subs.delete("/", handle(async (req, res) => {
  const { slot_id, day } = parse(z.object({ slot_id: t.id, day: t.date }), req.query);
  await inTenant(req, (q) => sa.unassign(q, slot_id, day));
  res.json({ ok: true });
}));
staff.use("/substitutes", requireModule("substitutes"), subs);

const lp = Router();
lp.get("/", handle(async (req, res) => {
  const f = parse(z.object({ week: t.date.optional(), status: z.enum(Object.keys(plans.STATUS)).optional(), teacher_id: t.optId }), req.query);
  res.json(await inTenant(req, (q) => plans.list(q, { teacherId: f.teacher_id ?? null, week: f.week ? plans.weekOf(f.week) : null, status: f.status ?? null })));
}));
lp.get("/coverage", handle(async (req, res) => {
  const { week } = parse(z.object({ week: t.date.optional() }), req.query);
  const w = plans.weekOf(week || sa.localDay());
  res.json(await inTenant(req, async (q) => ({ week: w, rows: await plans.coverage(q, w) })));
}));
lp.post("/:id/review", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(plans.reviewSchema, req.body);
  await inTenant(req, (q) => plans.review(q, id, b, req.actor));
  res.json({ ok: true });
}));
staff.use("/lesson-plans", requireModule("lesson_plans"), lp);

export const calendar = Router();
calendar.get("/", handle(async (req, res) => {
  const r = parse(cal.rangeSchema, req.query);
  res.json(await inTenant(req, (q) => cal.feed(q, r, { view: "admin" })));
}));
calendar.post("/", handle(async (req, res) => {
  const b = parse(cal.eventSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => cal.add(q, b, req.actor)));
}));
calendar.put("/:id", handle(async (req, res) => {
  const b = parse(cal.eventSchema, req.body);
  await inTenant(req, (q) => cal.update(q, parse(t.id, req.params.id), b));
  res.json({ ok: true });
}));
calendar.delete("/:id", handle(async (req, res) => {
  await inTenant(req, (q) => cal.remove(q, parse(t.id, req.params.id)));
  res.json({ ok: true });
}));
