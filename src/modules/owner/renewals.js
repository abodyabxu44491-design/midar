// طلبات التجديد والترقية من المدارس — واجهة متوافقة مع النسخة السابقة فوق جدول الطلبات الموحد (leads)
// أسماء الحالات القديمة تُحوَّل: contacted ⇄ reviewing، done ⇄ active
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { toOld, kindOld } from "../shared/subscription.service.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const toNew = { new: "new", contacted: "reviewing", done: "active", rejected: "rejected" };
const patchSchema = z.object({ status: z.enum(["new", "contacted", "done", "rejected"]).optional(), owner_note: t.optText(500) });

r.get("/", handle(async (req, res) => {
  const rows = await platform(req, (q) => q(
    `SELECT l.id, l.tenant_id, t.name AS school_name, l.kind, l.months, l.students_count AS students_wanted, l.note,
            l.contact_name, l.phone AS contact_phone, l.status, l.owner_note, l.requested_by, l.created_at,
            t.subscription_end, t.max_students, t.subscription_price, t.status AS school_status
       FROM leads l JOIN tenants t ON t.id = l.tenant_id
      WHERE l.source = 'school' AND l.kind IN ('renewal', 'upgrade', 'contact')
      ORDER BY l.status = 'new' DESC, l.id DESC LIMIT 200`));
  res.json(rows.map((x) => ({ ...x, kind: kindOld(x.kind), status: toOld(x.status) })));
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(patchSchema, req.body);
  await platform(req, async (q) => {
    const [cur] = await q("SELECT status, owner_note FROM leads WHERE id = $1 AND source = 'school'", [id]);
    if (!cur) throw notFound("الطلب غير موجود");
    await q("UPDATE leads SET status = $2, owner_note = $3, handled_by = $4 WHERE id = $1",
      [id, b.status ? toNew[b.status] : cur.status, b.owner_note !== undefined ? b.owner_note : cur.owner_note, req.actor]);
  });
  res.json({ ok: true });
}));

export default r;
