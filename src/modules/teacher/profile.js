// بيانات المعلم، فصوله، والإعلانات
import { Router } from "express";
import { accessSummary } from "../shared/subscription.service.js";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { myLoad } from "./access.js";
import { current } from "../shared/academic.service.js";

const r = Router();

r.get("/me", handle(async (req, res) => {
  const data = await inTenant(req, async (q) => ({ load: await myLoad(q, req.user.teacher_id), academic: await current(q) }));
  res.json({ access: accessSummary(req), modules: req.modules, name: req.user.full_name, must_change_password: req.user.must_change_password, school: { id: req.tenant.id, name: req.tenant.name }, ...data });
}));

r.get("/announcements", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(
    `SELECT a.title, a.body, a.created_at, c.name AS class_name FROM announcements a LEFT JOIN classes c ON c.id = a.class_id
      WHERE a.class_id IS NULL OR a.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = $1)
      ORDER BY a.id DESC LIMIT 50`, [req.user.teacher_id])));
}));

export default r;
