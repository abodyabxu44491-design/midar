/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import crypto from "node:crypto";
import { handle, notFound } from "../../core/http/errors.js";
import { hashPassword } from "../../core/auth/password.js";
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

// School activation: the school's administrator sets their own password from the link the owner handed over.
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
r.get("/activation/check", limits.login, handle(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, "الرابط غير صحيح") }), req.query);
  const [row] = await anon(req, (q) => q("SELECT * FROM school_activation_check($1)", [tokenHash(token)]));
  if (!row) throw notFound("رابط التفعيل غير صالح أو انتهت صلاحيته أو استُخدم مسبقًا. اطلب رابطًا جديدًا من إدارة مدار.");
  res.json({ school: row.school, school_id: row.school_id, username: row.username, full_name: row.full_name, expires_at: row.expires_at,
    login: `/${row.school_id}/idara?role=admin` });
}));

r.post("/activation", limits.login, handle(async (req, res) => {
  const b = parse(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, "الرابط غير صحيح"), password: t.password }), req.body);
  const passwordHash = await hashPassword(b.password);
  const [row] = await anon(req, (q) => q("SELECT school_activation_apply($1, $2) AS school_id", [tokenHash(b.token), passwordHash]));
  res.json({ ok: true, login: `/${row.school_id}/idara?role=admin` });
}));

export default r;
