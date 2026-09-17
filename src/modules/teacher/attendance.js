// حضور فصول المعلم فقط
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import * as attendance from "../shared/attendance.service.js";
import { teachesClass } from "./access.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const b = parse(attendance.listQuery, req.query);
  res.json(await inTenant(req, async (q) => {
    if (!(await teachesClass(q, req.user.teacher_id, b.class_id))) throw forbidden("هذا الفصل غير مسند لك");
    return attendance.listForClass(q, b.class_id, b.date);
  }));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(attendance.markSchema, req.body);
  res.json(await inTenant(req, (q) => attendance.mark(q, b, {
    actor: req.actor,
    allowedClass: (classId) => classId !== null && teachesClass(q, req.user.teacher_id, classId),
  })));
}));

export default r;
