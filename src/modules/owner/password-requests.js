// طلبات تغيير كلمة المرور — اعتماد مالك المنصة وإصدار الرابط
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import { env } from "../../config/env.js";
import * as reqs from "../shared/password-requests.service.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const baseUrl = (req) => env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

r.get("/", handle(async (req, res) => res.json(await platform(req, reqs.listForOwner))));

r.post("/:id/review", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(reqs.ownerReviewSchema, req.body);
  res.json(await platform(req, (q) => reqs.ownerReview(q, id, b, req.actor, baseUrl(req))));
}));

export default r;
