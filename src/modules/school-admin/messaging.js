// رسائل واتساب: قوالب المدرسة + تجهيز روابط المحادثة
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { getTemplates, updateTemplates, templateSchema } from "../shared/messages.service.js";
import { studentSummary } from "../shared/finance.service.js";

const r = Router();

r.get("/templates", handle(async (req, res) => res.json(await inTenant(req, getTemplates))));

r.put("/templates", handle(async (req, res) => {
  const b = parse(templateSchema, req.body);
  res.json(await inTenant(req, (q) => updateTemplates(q, b)));
}));

// بيانات جاهزة لبناء رسالة لطالب معيّن (الرسالة تُفتح في واتساب من جهاز المستخدم)
r.get("/student/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const kind = parse(z.enum(["absence", "late", "fees", "general"]).default("general"), req.query.kind || undefined);
  res.json(await inTenant(req, async (q) => {
    const [s] = await q(
      `SELECT s.id, s.full_name AS name, s.guardian_name, s.guardian_phone, s.fees_enabled, c.name AS class_name
         FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1 AND s.archived_at IS NULL`, [id]);
    if (!s) throw notFound("الطالب غير موجود");
    const templates = await getTemplates(q);
    const fees = s.fees_enabled ? await studentSummary(q, s.id) : null;
    return { student: s, templates, kind, fees, school: req.tenant.name };
  }));
}));

export default r;
