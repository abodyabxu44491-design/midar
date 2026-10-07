// حضور فصول المعلم فقط
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import * as attendance from "../shared/attendance.service.js";
import { teachesClass } from "./access.js";
import { featureSettings } from "../shared/feature-settings.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const b = parse(attendance.listQuery, req.query);
  res.json(await inTenant(req, async (q) => {
    if (!(await teachesClass(q, req.user.teacher_id, b.class_id))) throw forbidden("هذا الفصل غير مسند لك");
    return attendance.listForClass(q, b.class_id, b.date);
  }));
}));

r.get("/day-status", handle(async (req, res) => {
  const { date } = parse(attendance.dayQuery, req.query);
  res.json(await inTenant(req, (q) => attendance.dayStatus(q, date)));
}));

// بوابة الحضور (إن سمحت الإدارة للمعلمين بالمسح): لأي طالب في المدرسة، فالمناوب عند البوابة قد يكون معلمًا
r.post("/gate", handle(async (req, res) => {
  const { code } = parse(attendance.gateSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    if (!(await featureSettings(q, "gate")).teacher_can_scan) throw forbidden("مسح البطاقات عند البوابة متاح للإدارة فقط في مدرستك");
    return attendance.gateCheckIn(q, code, { actor: req.actor, schoolId: req.tenantId });
  }));
}));
r.get("/gate", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({ ...(await attendance.gateToday(q)), allowed: (await featureSettings(q, "gate")).teacher_can_scan })));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(attendance.markSchema, req.body);
  res.json(await inTenant(req, (q) => attendance.mark(q, b, {
    actor: req.actor,
    allowedClass: (classId) => classId !== null && teachesClass(q, req.user.teacher_id, classId),
  })));
}));

export default r;
