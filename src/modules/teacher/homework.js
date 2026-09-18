// واجبات المعلم: إنشاء ورصد التسليم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as homework from "../shared/homework.service.js";
import { teachesPair } from "./access.js";

const r = Router();

async function mine(q, req) {
  const a = await homework.get(q, parse(t.id, req.params.id));
  if (!(await teachesPair(q, req.user.teacher_id, a.class_id, a.subject_id))) throw forbidden("هذا الواجب ليس ضمن موادك");
  return a;
}

r.get("/", handle(async (req, res) => res.json(await inTenant(req, (q) => homework.listForTeacher(q, req.user.teacher_id)))));

r.post("/", handle(async (req, res) => {
  const b = parse(homework.createSchema, req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    if (!(await teachesPair(q, req.user.teacher_id, b.class_id, b.subject_id))) throw forbidden("هذه المادة غير مسندة لك في هذا الفصل");
    return homework.create(q, b, { teacherId: req.user.teacher_id, actor: req.actor });
  }));
}));

r.get("/:id/submissions", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => homework.sheet(q, await mine(q, req))));
}));

r.put("/:id/submissions", handle(async (req, res) => {
  const b = parse(homework.markSchema, req.body);
  res.json({ saved: await inTenant(req, async (q) => homework.markSubmissions(q, await mine(q, req), b.entries, req.actor)) });
}));

r.delete("/:id", handle(async (req, res) => {
  await inTenant(req, async (q) => homework.remove(q, (await mine(q, req)).id));
  res.json({ ok: true });
}));

export default r;
