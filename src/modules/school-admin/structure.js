// الفصول والمواد
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const nameSchema = z.object({ name: t.shortText("الاسم", 80) });
const promoteSchema = z.object({ from: t.id, to: t.id }).refine((v) => v.from !== v.to, "اختر فصلين مختلفين");

for (const [path, table] of [["classes", "classes"], ["subjects", "subjects"]]) {
  r.get(`/${path}`, handle(async (req, res) => {
    const extra = table === "classes" ? ", (SELECT count(*) FROM students s WHERE s.class_id = x.id AND s.archived_at IS NULL)::int AS students" : "";
    res.json(await inTenant(req, (q) => q(`SELECT x.id, x.name ${extra} FROM ${table} x ORDER BY x.id`)));
  }));

  r.post(`/${path}`, handle(async (req, res) => {
    const b = parse(nameSchema, req.body);
    const [row] = await inTenant(req, (q) => q(`INSERT INTO ${table} (tenant_id, name) VALUES (app_tenant(), $1) RETURNING id`, [b.name]));
    res.status(201).json(row);
  }));

  r.patch(`/${path}/:id`, handle(async (req, res) => {
    const b = parse(nameSchema, req.body);
    const rows = await inTenant(req, (q) => q(`UPDATE ${table} SET name = $2 WHERE id = $1 RETURNING id`, [parse(t.id, req.params.id), b.name]));
    if (!rows.length) throw notFound();
    res.json({ ok: true });
  }));

  // الحذف مسموح فقط إذا لم يرتبط بطلاب أو اختبارات (تمنعه قاعدة البيانات تلقائيًا)
  r.delete(`/${path}/:id`, handle(async (req, res) => {
    const rows = await inTenant(req, (q) => q(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [parse(t.id, req.params.id)]));
    if (!rows.length) throw notFound();
    res.json({ ok: true });
  }));
}

// ترحيل طلاب فصل كامل إلى فصل آخر
r.post("/promote", handle(async (req, res) => {
  const b = parse(promoteSchema, req.body);
  const moved = await inTenant(req, async (q) => {
    const found = await q("SELECT id FROM classes WHERE id = ANY($1::bigint[])", [[b.from, b.to]]);
    if (found.length !== 2) throw badRequest("أحد الفصلين غير موجود");
    return (await q("UPDATE students SET class_id = $2 WHERE class_id = $1 AND archived_at IS NULL RETURNING id", [b.from, b.to])).length;
  });
  res.json({ moved });
}));

export default r;
