// صفحة الطلاب: الفصول والأسماء فقط (بدون أي بيانات أخرى)
import { Router } from "express";
import { handle } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool, accessSchema, checkAccess } from "./context.js";

const r = Router({ mergeParams: true });

r.post("/open", limits.studentKey, handle(async (req, res) => {
  const b = parse(accessSchema, req.body);
  const name = await inSchool(req, "زائر", async (q, tenant) => { checkAccess(tenant, b.access); return tenant.name; });
  res.json({ ok: true, school: name });
}));

r.post("/directory", limits.api, handle(async (req, res) => {
  const b = parse(accessSchema, req.body);
  res.json(await inSchool(req, "زائر", async (q, tenant) => {
    checkAccess(tenant, b.access);
    const classes = await q("SELECT id, name FROM classes ORDER BY id");
    const students = await q("SELECT id, full_name AS name, class_id FROM students WHERE archived_at IS NULL ORDER BY full_name");
    const news = await q("SELECT title, body, created_at FROM announcements WHERE class_id IS NULL ORDER BY id DESC LIMIT 5");
    const pick = (s) => ({ id: s.id, name: s.name });
    return {
      school: { name: tenant.name },
      classes: classes.map((c) => ({ ...c, students: students.filter((s) => s.class_id === c.id).map(pick) })),
      unassigned: students.filter((s) => !s.class_id).map(pick),
      announcements: news,
    };
  }));
}));

export default r;
