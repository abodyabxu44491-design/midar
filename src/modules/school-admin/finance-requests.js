/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as fr from "../shared/finance-requests.service.js";

const r = Router();
const need = (power, message) => (req, res, next) => (fr.powers(req.user)[power] ? next() : next(forbidden(message)));

r.get("/", handle(async (req, res) => {
  const f = parse(z.object({ status: z.enum(Object.keys(fr.STATUSES)).optional().or(z.literal("")) }), req.query);
  res.json({ ...(await inTenant(req, (q) => fr.list(q, { status: f.status || null }))), powers: fr.powers(req.user), kinds: fr.KINDS, statuses: fr.STATUSES });
}));

r.get("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => fr.getOne(q, id)));
}));

r.post("/", need("create", "تقديم الطلبات من حساب الإدارة"), handle(async (req, res) => {
  const b = parse(fr.createSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => fr.create(q, b, req.user, req.actor)));
}));

r.post("/:id/cancel", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => fr.cancel(q, id, req.user, req.actor));
  res.json({ ok: true });
}));

r.post("/:id/decide", need("decide", "اعتماد الطلبات للإدارة العامة أو المحاسب المخوّل"), handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(fr.decideSchema, req.body);
  await inTenant(req, (q) => fr.decide(q, id, b, req.actor));
  res.json({ ok: true });
}));

r.post("/:id/pay", need("pay", "الصرف للإدارة العامة أو المحاسب المخوّل"), handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(fr.paySchema, req.body);
  res.json(await inTenant(req, (q) => fr.pay(q, id, b, req.actor)));
}));

export default r;
