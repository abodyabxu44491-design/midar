// التقارير: كشف درجات الطالب (للطباعة أو الحفظ PDF) وتقرير الصف
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import { buildReportCard, classReportCards } from "../shared/reports.service.js";

const r = Router();

r.get("/report-card/:studentId", handle(async (req, res) => {
  const id = parse(t.id, req.params.studentId);
  res.json(await inTenant(req, async (q) => {
    const card = await buildReportCard(q, id);
    if (!card) throw notFound("الطالب غير موجود");
    return card;
  }));
}));

r.get("/report-cards", handle(async (req, res) => {
  const classId = parse(t.id, req.query.class_id);
  res.json(await inTenant(req, (q) => classReportCards(q, classId)));
}));

export default r;
