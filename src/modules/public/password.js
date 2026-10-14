/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import * as activation from "../shared/activation.service.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool } from "./context.js";
import * as reqs from "../shared/password-requests.service.js";

const r = Router({ mergeParams: true });
const anon = (req, fn) => transaction({ actor: "زائر", ip: req.ip }, fn);

r.post("/:school/password-request", limits.login, handle(async (req, res) => {
  const b = parse(reqs.requestSchema, req.body);
  const out = await inSchool(req, "زائر", (q) => reqs.submit(q, b));
  res.status(201).json(out);
}));

r.get("/password-reset/check", limits.login, handle(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().length(64) }), req.query);
  res.json(await anon(req, (q) => reqs.checkToken(q, token)));
}));

r.post("/password-reset", limits.login, handle(async (req, res) => {
  const b = parse(reqs.resetSchema, req.body);
  res.json(await anon(req, (q) => reqs.reset(q, b)));
}));

// School activation: the manager verifies a mobile number by SMS, then sets the password and signs in.
const tokenQ = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, "الرابط غير صحيح") });
r.get("/activation/check", limits.login, handle(async (req, res) => {
  const { token } = parse(tokenQ, req.query);
  res.json(await activation.info(token));
}));
r.post("/activation/send-code", limits.login, handle(async (req, res) => {
  const b = parse(tokenQ.extend({ phone: z.string().trim().min(6, "أدخل رقم الجوال").max(25).optional() }), req.body);
  res.json(await activation.sendCode(b.token, b.phone));
}));
r.post("/activation/verify", limits.login, handle(async (req, res) => {
  const b = parse(tokenQ.extend({ code: z.string().trim().max(10) }), req.body);
  res.json(await activation.verifyCode(b.token, b.code));
}));
r.post("/activation", limits.login, handle(async (req, res) => {
  const b = parse(tokenQ.extend({ password: t.password }), req.body);
  res.json(await activation.complete(b.token, b.password, req, res));
}));

export default r;
