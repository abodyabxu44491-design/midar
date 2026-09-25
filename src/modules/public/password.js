// طلب تغيير كلمة المرور من بوابة المدرسة، وصفحة تنفيذ التغيير بالرابط
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool } from "./context.js";
import * as reqs from "../shared/password-requests.service.js";

const r = Router({ mergeParams: true });
const anon = (req, fn) => transaction({ actor: "زائر", ip: req.ip }, fn);

// إرسال الطلب (من صفحة دخول المدرسة)
r.post("/:school/password-request", limits.login, handle(async (req, res) => {
  const b = parse(reqs.requestSchema, req.body);
  const out = await inSchool(req, "زائر", (q) => reqs.submit(q, b));
  res.status(201).json(out);
}));

// التحقق من الرابط قبل عرض النموذج
r.get("/password-reset/check", limits.login, handle(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().length(64) }), req.query);
  res.json(await anon(req, (q) => reqs.checkToken(q, token)));
}));

// تنفيذ التغيير
r.post("/password-reset", limits.login, handle(async (req, res) => {
  const b = parse(reqs.resetSchema, req.body);
  res.json(await anon(req, (q) => reqs.reset(q, b)));
}));

export default r;
