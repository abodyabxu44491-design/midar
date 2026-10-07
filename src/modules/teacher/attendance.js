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

r.post("/", handle(async (req, res) => {
  const b = parse(attendance.markSchema, req.body);
  res.json(await inTenant(req, async (q) => attendance.mark(q, b, {
    actor: req.actor, source: "teacher", ip: req.ip, lockGate: !(await featureSettings(q, "gate")).teacher_can_edit,
    allowedClass: (classId) => classId !== null && teachesClass(q, req.user.teacher_id, classId),
  })));
}));

// عذر أو ملاحظة على غياب أو تأخر طالب في فصله (إن سمحت المدرسة)
r.patch("/excuse", handle(async (req, res) => {
  const b = parse(attendance.excuseSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    if (!(await featureSettings(q, "gate")).teacher_can_excuse) throw forbidden("إضافة الأعذار متاحة للإدارة فقط في مدرستك");
    const [s] = await q("SELECT class_id FROM students WHERE id = $1", [b.student_id]);
    if (!s || !(await teachesClass(q, req.user.teacher_id, s.class_id))) throw forbidden("الطالب ليس في فصولك");
    return attendance.setExcuse(q, b);
  }));
}));

export default r;
