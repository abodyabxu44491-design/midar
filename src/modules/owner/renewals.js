// طلبات التجديد والترقية الواردة من المدارس
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const patchSchema = z.object({
  status: z.enum(["new", "contacted", "done", "rejected"]).optional(),
  owner_note: t.optText(500),
});

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT rr.id, rr.tenant_id, t.name AS school_name, rr.kind, rr.months, rr.students_wanted, rr.note,
            rr.contact_name, rr.contact_phone, rr.status, rr.owner_note, rr.requested_by, rr.created_at,
            t.subscription_end, t.max_students, t.subscription_price, t.status AS school_status
       FROM renewal_requests rr JOIN tenants t ON t.id = rr.tenant_id
      ORDER BY rr.status = 'new' DESC, rr.id DESC LIMIT 200`)));
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(patchSchema, req.body);
  await platform(req, async (q) => {
    const [cur] = await q("SELECT status, owner_note FROM renewal_requests WHERE id = $1", [id]);
    if (!cur) throw notFound("الطلب غير موجود");
    await q("UPDATE renewal_requests SET status = $2, owner_note = $3 WHERE id = $1",
      [id, b.status ?? cur.status, b.owner_note !== undefined ? b.owner_note : cur.owner_note]);
  });
  res.json({ ok: true });
}));

export default r;
