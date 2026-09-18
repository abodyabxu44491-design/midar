// طلبات الالتحاق (الإدارة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as admissions from "../shared/admissions.service.js";

const r = Router();

r.get("/", handle(async (req, res) => res.json(await inTenant(req, admissions.list))));

r.post("/:id/review", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(admissions.reviewSchema, req.body);
  res.json(await inTenant(req, (q) => admissions.review(q, id, b, req.tenant, req.actor)));
}));

export default r;
