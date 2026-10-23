/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { handle, badRequest } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules } from "../shared/notify.service.js";
import * as oe from "../shared/online-exams.service.js";
import { answerUploadSchema } from "../shared/exam-media.service.js";

const r = Router({ mergeParams: true });
const run = (req, fn) => inSchool(req, "طالب", async (q, tenant) => {
  const s = await verifyStudent(req, tenant, q, req.body);
  if (!(await activeModules(q)).online_exams) throw badRequest("الاختبارات الإلكترونية غير مفعّلة");
  return fn(q, s);
});
const idOf = (req) => parse(t.id, req.params.id);

r.post("/student/online-exams", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => oe.forStudent(q, s)))));
r.post("/student/online-exams/:id/start", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => oe.start(q, s, idOf(req), req.ip)))));
r.post("/student/online-exams/:id/save", limits.publicApi, handle(async (req, res) => {
  const { answers } = parse(oe.saveSchema, req.body);
  res.json(await run(req, (q, s) => oe.save(q, s, idOf(req), answers)));
}));
r.post("/student/online-exams/:id/submit", limits.studentKey, handle(async (req, res) => {
  const { answers } = parse(oe.saveSchema, req.body);
  res.json(await run(req, (q, s) => oe.save(q, s, idOf(req), answers, { submit: true })));
}));
r.post("/student/online-exams/:id/review", limits.studentKey, handle(async (req, res) => res.json(await run(req, (q, s) => oe.review(q, s, idOf(req))))));
r.post("/student/online-exams/:id/image", limits.publicApi, handle(async (req, res) => {
  const { image_id } = parse(z.object({ image_id: t.id }), req.body);
  res.json(await run(req, (q, s) => oe.imageFor(q, s, idOf(req), image_id)));
}));
// A question's clip and the student's own answer file come back as the file itself (the page plays it from memory).
const sendFile = (res, f) => res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).type(f.mime).send(Buffer.from(f.data));
r.post("/student/online-exams/:id/media", limits.publicApi, handle(async (req, res) => {
  const { media_id } = parse(z.object({ media_id: t.id }), req.body);
  sendFile(res, await run(req, (q, s) => oe.mediaFor(q, s, idOf(req), media_id)));
}));
r.post("/student/online-exams/:id/answer-file", limits.publicApi, handle(async (req, res) => {
  const b = parse(answerUploadSchema, req.body);
  res.json(await run(req, (q, s) => oe.answerFile(q, s, idOf(req), b)));
}));
r.post("/student/online-exams/:id/answer-file/view", limits.publicApi, handle(async (req, res) => {
  const { question_id } = parse(z.object({ question_id: z.string().regex(/^[a-z]_[a-z0-9]{3,20}$/) }), req.body);
  sendFile(res, await run(req, (q, s) => oe.myAnswerFile(q, s, idOf(req), question_id)));
}));
export default r;
