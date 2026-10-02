// اختبارات المعلم: إنشاء، إدخال درجات، إرسال للاعتماد
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden, badRequest } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as exams from "../shared/exams.service.js";
import { teachesPair } from "./access.js";
import { forClass } from "../shared/grade-components.service.js";

const r = Router();

async function myExam(q, req) {
  const e = await exams.get(q, parse(t.id, req.params.id));
  if (!(await teachesPair(q, req.user.teacher_id, e.class_id, e.subject_id))) throw forbidden("هذا الاختبار ليس ضمن موادك");
  return e;
}

r.get("/", handle(async (req, res) => res.json(await inTenant(req, (q) => exams.listForTeacher(q, req.user.teacher_id)))));

// أنواع الدرجات المتاحة لفصل يدرّسه المعلم (توزيع الدرجات الذي حددته الإدارة)
r.get("/components", handle(async (req, res) => {
  const classId = parse(t.id, req.query.class_id);
  res.json(await inTenant(req, async (q) => {
    const [ok] = await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 LIMIT 1", [req.user.teacher_id, classId]);
    if (!ok) throw forbidden("هذا الفصل غير مسند لك");
    return forClass(q, classId);
  }));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(exams.createSchema, req.body);
  const row = await inTenant(req, async (q) => {
    if (!(await teachesPair(q, req.user.teacher_id, b.class_id, b.subject_id))) throw forbidden("هذه المادة غير مسندة لك في هذا الفصل");
    return exams.create(q, b, req.actor);
  });
  res.status(201).json(row);
}));

r.get("/:id/scores", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => exams.sheet(q, await myExam(q, req))));
}));

r.put("/:id/scores", handle(async (req, res) => {
  const b = parse(exams.scoresSchema, req.body);
  const saved = await inTenant(req, async (q) => {
    const e = await myExam(q, req);
    if (e.status !== "draft") throw badRequest("لا يمكن التعديل بعد الإرسال للاعتماد");
    return exams.saveScores(q, e, b.scores, req.actor);
  });
  res.json({ saved });
}));

r.post("/:id/submit", handle(async (req, res) => {
  await inTenant(req, async (q) => {
    const e = await myExam(q, req);
    if (e.status !== "draft") throw badRequest("الاختبار مُرسل مسبقًا");
    await exams.setStatus(q, e, "pending");
  });
  res.json({ ok: true });
}));

export default r;
