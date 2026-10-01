// الشهادات (الإدارة): معاينة وإصدار لشعبة، وشهادة مخصصة، والطباعة، والإلغاء
import { Router } from "express";
import { env } from "../../config/env.js";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as certs from "../shared/certificates.service.js";

const r = Router();
export const originOf = (req) => env.PUBLIC_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;

r.get("/", handle(async (req, res) => {
  const f = parse(z.object({ class_id: t.optId, student_id: t.optId }), req.query);
  res.json(await inTenant(req, (q) => certs.list(q, f)));
}));
r.post("/issue", handle(async (req, res) => {
  const b = parse(certs.issueSchema, req.body);
  res.status(b.dry_run ? 200 : 201).json(await inTenant(req, (q) => certs.issue(q, b, req.actor)));
}));
r.post("/custom", handle(async (req, res) => {
  const b = parse(certs.customSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => certs.issueCustom(q, b, req.actor)));
}));
r.post("/print", handle(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(t.id).min(1).max(500) }), req.body);
  res.json(await inTenant(req, (q) => certs.forPrint(q, ids, originOf(req))));
}));
r.post("/:id/revoke", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { reason } = parse(z.object({ reason: t.shortText("سبب الإلغاء", 200) }), req.body);
  await inTenant(req, (q) => certs.revoke(q, id, reason));
  res.json({ ok: true });
}));
export default r;
