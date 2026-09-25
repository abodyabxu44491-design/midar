// طلبات تغيير كلمة المرور — مراجعة إدارة المدرسة
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as reqs from "../shared/password-requests.service.js";

const r = Router();

r.get("/", handle(async (req, res) => res.json(await inTenant(req, reqs.listForSchool))));

r.post("/:id/review", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(reqs.adminReviewSchema, req.body);
  res.json(await inTenant(req, (q) => reqs.adminReview(q, id, b, req.actor)));
}));

export default r;
