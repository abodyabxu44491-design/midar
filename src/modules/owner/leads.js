// طلبات التجربة الواردة من الصفحة التسويقية
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const patchSchema = z.object({
  status: z.enum(["new", "contacted", "converted", "rejected"]).optional(),
  owner_note: t.optText(500),
  tenant_id: z.string().max(30).optional().nullable(),
});

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT id, school_name, contact_name, phone, email, city, students_count, note, status, owner_note,
            tenant_id, host(ip) AS ip, created_at
       FROM leads ORDER BY status = 'new' DESC, id DESC LIMIT 200`)));
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(patchSchema, req.body);
  await platform(req, async (q) => {
    const [cur] = await q("SELECT * FROM leads WHERE id = $1", [id]);
    if (!cur) throw notFound("الطلب غير موجود");
    await q("UPDATE leads SET status = $2, owner_note = $3, tenant_id = $4 WHERE id = $1",
      [id, b.status ?? cur.status, b.owner_note !== undefined ? b.owner_note : cur.owner_note,
       b.tenant_id !== undefined ? b.tenant_id : cur.tenant_id]);
  });
  res.json({ ok: true });
}));

export default r;
