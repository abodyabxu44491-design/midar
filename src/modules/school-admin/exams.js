// الاختبارات: الاعتماد والنشر (الإدارة) — الإنشاء وإدخال الدرجات للمعلم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as exams from "../shared/exams.service.js";

const r = Router();

r.get("/", handle(async (req, res) => res.json(await inTenant(req, exams.listAll))));

r.get("/:id/scores", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, async (q) => exams.sheet(q, await exams.get(q, id))));
}));

// published = اعتماد ونشر | draft = إرجاع للمعلم أو إلغاء النشر
r.post("/:id/status", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { status } = parse(z.object({ status: z.enum(["published", "draft"]) }), req.body);
  await inTenant(req, async (q) => {
    const e = await exams.get(q, id);
    if (e.status === status) throw badRequest("الاختبار بهذه الحالة مسبقًا");
    await exams.setStatus(q, e, status);
  });
  res.json({ ok: true });
}));

export default r;
