// الاختبار الإلكتروني للطالب: من ملفه بمعرّفه. البدء والحفظ التلقائي والتسليم والمراجعة
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules } from "../shared/notify.service.js";
import * as oe from "../shared/online-exams.service.js";

const r = Router({ mergeParams: true });
const run = (req, fn) => inSchool(req, "طالب", async (q, tenant) => {
  const s = await verifyStudent(req, tenant, q, req.body);
  if (!(await activeModules(q)).online_exams) throw badRequest("الاختبارات الإلكترونية غير مفعّلة");
  return fn(q, s);
});
const idOf = (req) => parse(t.id, req.params.id);

r.post("/student/online-exams", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => oe.forStudent(q, s)))));
r.post("/student/online-exams/:id/start", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => oe.start(q, s, idOf(req), req.ip)))));
r.post("/student/online-exams/:id/save", limits.api, handle(async (req, res) => {
  const { answers } = parse(oe.saveSchema, req.body);
  res.json(await run(req, (q, s) => oe.save(q, s, idOf(req), answers)));
}));
r.post("/student/online-exams/:id/submit", limits.studentKey, handle(async (req, res) => {
  const { answers } = parse(oe.saveSchema, req.body);
  res.json(await run(req, (q, s) => oe.save(q, s, idOf(req), answers, { submit: true })));
}));
r.post("/student/online-exams/:id/review", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => oe.review(q, s, idOf(req))))));
r.post("/student/online-exams/:id/image", limits.api, handle(async (req, res) => {
  const { image_id } = parse(z.object({ image_id: t.id }), req.body);
  res.json(await run(req, (q, s) => oe.imageFor(q, s, idOf(req), image_id)));
}));
export default r;
