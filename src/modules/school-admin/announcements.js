// الإعلانات
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { notify } from "../shared/notify.service.js";

const r = Router();
const schema = z.object({ title: t.shortText("عنوان الإعلان"), body: t.optText(2000), class_id: t.optId });

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(`SELECT a.id, a.title, a.body, a.class_id, c.name AS class_name, a.created_by, a.created_at
    FROM announcements a LEFT JOIN classes c ON c.id = a.class_id ORDER BY a.id DESC LIMIT 200`)));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  const [row] = await inTenant(req, async (q) => {
    const rows = await q(
      "INSERT INTO announcements (tenant_id, class_id, title, body, created_by) VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id",
      [b.class_id, b.title, b.body, req.actor]);
    const students = await q("SELECT id FROM students WHERE archived_at IS NULL AND ($1::bigint IS NULL OR class_id = $1)", [b.class_id ?? null]);
    await notify(q, { event: "announcement", students: students.map((s) => s.id), title: `تعميم: ${b.title}`, body: b.body, link: "news" });
    return rows;
  });
  res.status(201).json(row);
}));

r.delete("/:id", handle(async (req, res) => {
  const rows = await inTenant(req, (q) => q("DELETE FROM announcements WHERE id = $1 RETURNING id", [parse(t.id, req.params.id)]));
  if (!rows.length) throw notFound();
  res.json({ ok: true });
}));

export default r;
