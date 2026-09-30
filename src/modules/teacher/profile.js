// بيانات المعلم، فصوله، والإعلانات
import { Router } from "express";
import { logoId } from "../shared/school-logo.service.js";
import { accessSummary } from "../shared/subscription.service.js";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { myLoad } from "./access.js";
import { current } from "../shared/academic.service.js";

const r = Router();

r.get("/me", handle(async (req, res) => {
  const { school, photo, ...data } = await inTenant(req, async (q) => ({
    load: await myLoad(q, req.user.teacher_id), academic: await current(q),
    school: await logoId(q),
    photo: (await q("SELECT (photo IS NOT NULL) AS has, extract(epoch FROM updated_at)::bigint AS v FROM teachers WHERE id = $1", [req.user.teacher_id]))[0],
  }));
  res.json({ access: accessSummary(req), modules: req.modules, name: req.user.full_name, user_id: req.user.id, must_change_password: req.user.must_change_password,
    school: { id: req.tenant.id, name: req.tenant.name, logo: school },
    photo: photo?.has ? `/api/teacher/photo?v=${photo.v}` : null, ...data });
}));

// صورة المعلم نفسه (يرفعها المدير من ملف المعلم)
r.get("/photo", handle(async (req, res) => {
  const [p] = await inTenant(req, (q) => q("SELECT photo, photo_type FROM teachers WHERE id = $1 AND photo IS NOT NULL", [req.user.teacher_id]));
  if (!p) return res.status(404).json({ error: "لا توجد صورة" });
  res.set({ "Content-Type": p.photo_type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" }).send(p.photo);
}));

r.get("/announcements", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(
    `SELECT a.title, a.body, a.created_at, c.name AS class_name FROM announcements a LEFT JOIN classes c ON c.id = a.class_id
      WHERE a.class_id IS NULL OR a.class_id IN (SELECT class_id FROM teacher_assignments WHERE teacher_id = $1)
      ORDER BY a.id DESC LIMIT 50`, [req.user.teacher_id])));
}));

export default r;
