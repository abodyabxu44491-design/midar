// مسارات الاختبارات الإلكترونية للمنسوبين (الإدارة: الكل، المعلم: اختباراته فقط)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as oe from "./online-exams.service.js";

export function onlineExamsRouter(role) {
  const r = Router();
  const who = (req) => (role === "teacher" ? { role, teacherId: req.user.teacher_id } : { role: "admin" });
  r.get("/", handle(async (req, res) => res.json(await inTenant(req, (q) => oe.list(q, who(req))))));
  r.post("/", handle(async (req, res) => {
    const b = parse(oe.publishSchema, req.body);
    res.status(201).json(await inTenant(req, (q) => oe.publish(q, who(req), b, req.actor)));
  }));
  r.get("/:id", handle(async (req, res) => {
    res.json(await inTenant(req, (q) => oe.results(q, who(req), parse(t.id, req.params.id))));
  }));
  r.get("/:id/attempts/:aid", handle(async (req, res) => {
    res.json(await inTenant(req, (q) => oe.attemptDetail(q, who(req), parse(t.id, req.params.id), parse(t.id, req.params.aid))));
  }));
  r.put("/:id/attempts/:aid/marks", handle(async (req, res) => {
    const { marks } = parse(oe.marksSchema, req.body);
    res.json(await inTenant(req, (q) => oe.setMarks(q, who(req), parse(t.id, req.params.id), parse(t.id, req.params.aid), marks, req.actor)));
  }));
  r.post("/:id/sync", handle(async (req, res) => {
    res.json(await inTenant(req, (q) => oe.syncScores(q, who(req), parse(t.id, req.params.id), req.actor)));
  }));
  r.post("/:id/close", handle(async (req, res) => {
    await inTenant(req, (q) => oe.close(q, who(req), parse(t.id, req.params.id)));
    res.json({ ok: true });
  }));
  r.delete("/:id", handle(async (req, res) => {
    await inTenant(req, (q) => oe.remove(q, who(req), parse(t.id, req.params.id)));
    res.json({ ok: true });
  }));
  return r;
}
