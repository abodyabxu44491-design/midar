// ولي الأمر: الاستبيانات، ومواعيده مع المعلمين والإدارة (بمعرّف الطالب)
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules } from "../shared/notify.service.js";
import * as en from "../shared/engagement.service.js";

const r = Router({ mergeParams: true });
const run = (req, mod, fn) => inSchool(req, "ولي أمر", async (q, tenant) => {
  const s = await verifyStudent(req, tenant, q, req.body);
  if (!(await activeModules(q))[mod]) throw badRequest("هذا القسم غير مفعّل");
  return fn(q, s);
});
r.post("/student/surveys", limits.studentKey, handle(async (req, res) => res.json(await run(req, "surveys", (q, s) => en.availableFor(q, { student_id: s.id })))));
r.post("/student/surveys/:id", limits.studentKey, handle(async (req, res) => {
  const { answers } = parse(en.respondSchema, req.body);
  res.json(await run(req, "surveys", (q, s) => en.respond(q, parse(t.id, req.params.id), { student_id: s.id }, answers)));
}));
r.post("/student/meetings", limits.studentKey, handle(async (req, res) => res.json(await run(req, "meetings", (q, s) => en.slotsForStudent(q, s)))));
r.post("/student/meetings/book", limits.studentKey, handle(async (req, res) => {
  const b = parse(en.bookSchema, req.body);
  res.json(await run(req, "meetings", (q, s) => en.book(q, s, b)));
}));
r.post("/student/meetings/:id/cancel", limits.studentKey, handle(async (req, res) => {
  res.json(await run(req, "meetings", async (q, s) => { await en.cancelByParent(q, s, parse(t.id, req.params.id)); return { ok: true }; }));
}));

export default r;
