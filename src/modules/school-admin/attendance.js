// الحضور (الإدارة تستطيع كل الفصول)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import * as attendance from "../shared/attendance.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const b = parse(attendance.listQuery, req.query);
  res.json(await inTenant(req, async (q) => {
    const [c] = await q("SELECT id FROM classes WHERE id = $1", [b.class_id]);
    if (!c) throw notFound("الفصل غير موجود");
    return attendance.listForClass(q, b.class_id, b.date);
  }));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(attendance.markSchema, req.body);
  res.json(await inTenant(req, (q) => attendance.mark(q, b, { actor: req.actor, allowedClass: async (id) => id !== null })));
}));

export default r;
