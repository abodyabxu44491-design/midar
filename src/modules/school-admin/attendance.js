// الحضور (الإدارة تستطيع كل الفصول)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import * as attendance from "../shared/attendance.service.js";
import { getSettings } from "../shared/public-settings.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const b = parse(attendance.listQuery, req.query);
  res.json(await inTenant(req, async (q) => {
    const [c] = await q("SELECT id FROM classes WHERE id = $1", [b.class_id]);
    if (!c) throw notFound("الفصل غير موجود");
    return attendance.listForClass(q, b.class_id, b.date, { withContact: true });
  }));
}));

r.get("/day-status", handle(async (req, res) => {
  const { date } = parse(attendance.dayQuery, req.query);
  res.json(await inTenant(req, (q) => attendance.dayStatus(q, date)));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(attendance.markSchema, req.body);
  res.json(await inTenant(req, (q) => attendance.mark(q, b, { actor: req.actor, allowedClass: async (id) => id !== null })));
}));

// متابعة يوم: الفصول المسجّلة وغير المسجّلة، والغائبون والمتأخرون، ومن بلغ غيابه الحد
r.get("/overview", handle(async (req, res) => {
  const { date } = parse(attendance.dayQuery, req.query);
  res.json(await inTenant(req, async (q) => {
    const settings = await getSettings(q);
    return { ...(await attendance.overview(q, date)), threshold: settings.absence_alert_threshold,
      at_risk: await attendance.atRisk(q, settings.absence_alert_threshold),
      pending_excuses: (await attendance.pendingExcuses(q)).length };
  }));
}));

r.get("/report", handle(async (req, res) => {
  const b = parse(attendance.reportQuery, req.query);
  res.json(await inTenant(req, (q) => attendance.report(q, b)));
}));

r.patch("/excuse", handle(async (req, res) => {
  const b = parse(attendance.excuseSchema, req.body);
  res.json(await inTenant(req, (q) => attendance.setExcuse(q, b)));
}));

r.get("/excuses", handle(async (req, res) => res.json(await inTenant(req, attendance.pendingExcuses))));

r.post("/excuses/decide", handle(async (req, res) => {
  const b = parse(attendance.decideSchema, req.body);
  res.json(await inTenant(req, (q) => attendance.decideExcuse(q, b)));
}));

export default r;
