/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's inbox: every message from the site's forms and the platform's email addresses, with its status, notes
// and a log of what was done. A reply is sent from here only when an outgoing mail service is set up; otherwise the
// owner replies from the mailbox and records it here.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { STATUSES, KINDS } from "../shared/inquiries.service.js";
import { loadMail, sendMail } from "../shared/mail.service.js";
import { signedMail } from "../shared/mail-signature.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const idP = z.object({ id: t.id });

r.get("/", handle(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum([...Object.keys(STATUSES), "open", "all"]).prefault("open") }), req.query);
  res.json(await platform(req, async (q) => ({
    statuses: STATUSES, kinds: KINDS, can_reply: Boolean(await loadMail()),
    counts: Object.fromEntries((await q("SELECT status, count(*)::int AS n FROM inquiries GROUP BY status")).map((x) => [x.status, x.n])),
    items: await q(
      `SELECT id, channel, kind, name, email, phone, organization, subject, left(body, 240) AS preview, to_address, status, created_at, updated_at
         FROM inquiries WHERE ($1 = 'all' OR ($1 = 'open' AND status IN ('new', 'in_progress')) OR status = $1)
        ORDER BY status = 'new' DESC, id DESC LIMIT 300`, [status]),
  })));
}));

r.get("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await platform(req, async (q) => {
    const [x] = await q("SELECT *, host(ip) AS ip FROM inquiries WHERE id = $1", [id]);
    if (!x) throw notFound("الرسالة غير موجودة");
    return { ...x, events: await q("SELECT * FROM inquiry_events WHERE inquiry_id = $1 ORDER BY id", [id]) };
  }));
}));

r.patch("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(z.object({ status: z.enum(Object.keys(STATUSES)).optional(), note: t.optText(2000) })
    .refine((x) => x.status || x.note, "اختر حالة أو اكتب ملاحظة"), req.body);
  res.json(await platform(req, async (q) => {
    const [x] = await q("SELECT status FROM inquiries WHERE id = $1 FOR UPDATE", [id]);
    if (!x) throw notFound("الرسالة غير موجودة");
    if (b.status && b.status !== x.status) {
      await q("UPDATE inquiries SET status = $2 WHERE id = $1", [id, b.status]);
      await q("INSERT INTO inquiry_events (inquiry_id, kind, body, actor) VALUES ($1, 'status', $2, $3)",
        [id, `${STATUSES[x.status]} ← ${STATUSES[b.status]}`, req.actor]);
    }
    if (b.note) await q("INSERT INTO inquiry_events (inquiry_id, kind, body, actor) VALUES ($1, 'note', $2, $3)", [id, b.note, req.actor]);
    return { ok: true };
  }));
}));

// A reply by email through the platform's outgoing mail service, with the official signature, logged with its text.
r.post("/:id/reply", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(z.object({ body: z.string().trim().min(5, "اكتب الرد").max(8000) }), req.body);
  const [x] = await platform(req, (q) => q("SELECT * FROM inquiries WHERE id = $1", [id]));
  if (!x) throw notFound("الرسالة غير موجودة");
  if (!x.email) throw conflict("لا يوجد بريد لهذا المرسل. تواصل معه بالجوال ثم سجّل ما تم في ملاحظة.");
  if (!(await loadMail())) throw conflict("لا توجد خدمة إرسال بريد مهيأة في المنصة. رد من صندوق بريدك، ثم سجّل الرد هنا كملاحظة.");
  const [s] = await platform(req, (q) => q("SELECT site_url, email_info, email_support FROM platform_settings WHERE id"));
  await sendMail(signedMail({ to: x.email, subject: `رد: ${x.subject} [#${x.id}]`, body: b.body, settings: s }));
  await platform(req, async (q) => {
    await q("INSERT INTO inquiry_events (inquiry_id, kind, body, actor) VALUES ($1, 'reply', $2, $3)", [id, b.body, req.actor]);
    await q("UPDATE inquiries SET status = 'replied' WHERE id = $1 AND status IN ('new', 'in_progress')", [id]);
  });
  res.json({ ok: true });
}));

// Spam only: a message removed here leaves no trace, so the panel asks first.
r.delete("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const n = await platform(req, async (q) => (await q("DELETE FROM inquiries WHERE id = $1 RETURNING id", [id])).length);
  if (!n) throw notFound("الرسالة غير موجودة");
  res.json({ ok: true });
}));

export default r;
