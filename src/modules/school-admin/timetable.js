// الجدول الدراسي (الإدارة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as timetable from "../shared/timetable.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const classId = req.query.class_id ? parse(t.id, req.query.class_id) : null;
  res.json(await inTenant(req, (q) => (classId ? timetable.forClass(q, classId) : timetable.forAllClasses(q))));
}));

r.put("/slot", handle(async (req, res) => {
  const b = parse(timetable.slotSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const [c] = await q("SELECT id FROM classes WHERE id = $1", [b.class_id]);
    if (!c) throw notFound("الصف غير موجود");
    return timetable.setSlot(q, b);
  }));
}));

r.delete("/class/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json({ deleted: await inTenant(req, (q) => timetable.clearClass(q, id)) });
}));

export default r;
