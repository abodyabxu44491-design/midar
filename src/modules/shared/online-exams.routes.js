/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as oe from "./online-exams.service.js";
import { sendMedia } from "./exam-media.service.js";

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
  const qid = z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/);
  r.get("/:id/attempts/:aid/files/:qid", handle(async (req, res) => sendMedia(req, res, await inTenant(req, (q) =>
    oe.attemptFile(q, who(req), parse(t.id, req.params.id), parse(t.id, req.params.aid), parse(qid, req.params.qid))))));
  r.get("/:id/assets/:kind/:aid", handle(async (req, res) => sendMedia(req, res, await inTenant(req, (q) =>
    oe.examAsset(q, who(req), parse(t.id, req.params.id), parse(z.enum(["image", "media"]), req.params.kind), parse(t.id, req.params.aid))))));
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
