/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { logEvent } from "../../core/audit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { threadMessages } from "../shared/chat.service.js";

const r = Router();
const idP = z.object({ id: t.id });

r.get("/teachers", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(
    `SELECT t.id, t.full_name AS name, t.chat_enabled,
            count(th.id)::int AS threads, count(th.id) FILTER (WHERE th.flagged_at IS NOT NULL)::int AS flagged
       FROM teachers t LEFT JOIN chat_threads th ON th.teacher_id = t.id
      GROUP BY t.id ORDER BY t.full_name`)));
}));

const enableSchema = z.object({ enabled: z.boolean() });
r.put("/teachers/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { enabled } = parse(enableSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const [row] = await q("UPDATE teachers SET chat_enabled = $2 WHERE id = $1 RETURNING id, full_name, chat_enabled", [id, enabled]);
    if (!row) throw notFound("المعلم غير موجود");
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: `${enabled ? "تفعيل" : "إيقاف"} مراسلة أولياء الأمور للمعلم ${row.full_name}` });
    return { id: row.id, chat_enabled: row.chat_enabled };
  }));
}));

r.put("/teachers", handle(async (req, res) => {
  const { enabled } = parse(enableSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const rows = await q("UPDATE teachers SET chat_enabled = $1 WHERE chat_enabled IS DISTINCT FROM $1 RETURNING id", [enabled]);
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: `${enabled ? "تفعيل" : "إيقاف"} مراسلة أولياء الأمور لكل المعلمين (${rows.length})` });
    return { changed: rows.length };
  }));
}));

const listSchema = z.object({ flagged: z.enum(["1", "0"]).optional(), teacher_id: t.optId, q: z.string().trim().max(60).optional() });
r.get("/threads", handle(async (req, res) => {
  const f = parse(listSchema, req.query);
  res.json(await inTenant(req, (q) => q(
    `SELECT th.id, th.teacher_id, t.full_name AS teacher_name, th.student_id, s.full_name AS student_name, c.name AS class_name,
            th.last_message_at, th.last_preview, th.closed_at, th.close_reason, th.flagged_at,
            (SELECT count(*)::int FROM chat_messages m WHERE m.thread_id = th.id) AS messages
       FROM chat_threads th JOIN teachers t ON t.id = th.teacher_id JOIN students s ON s.id = th.student_id
       LEFT JOIN classes c ON c.id = s.class_id
      WHERE ($1::boolean IS NOT TRUE OR th.flagged_at IS NOT NULL)
        AND ($2::bigint IS NULL OR th.teacher_id = $2)
        AND ($3::text IS NULL OR s.full_name ILIKE '%' || $3 || '%' OR t.full_name ILIKE '%' || $3 || '%')
      ORDER BY (th.flagged_at IS NOT NULL) DESC, th.last_message_at DESC LIMIT 300`,
    [f.flagged === "1" ? true : null, f.teacher_id ?? null, f.q || null])));
}));

async function threadById(q, id) {
  const [th] = await q(
    `SELECT th.*, t.full_name AS teacher_name, s.full_name AS student_name, c.name AS class_name
       FROM chat_threads th JOIN teachers t ON t.id = th.teacher_id JOIN students s ON s.id = th.student_id
       LEFT JOIN classes c ON c.id = s.class_id WHERE th.id = $1`, [id]);
  if (!th) throw notFound("المحادثة غير موجودة");
  return th;
}

r.get("/threads/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const before = req.query.before ? parse(t.id, req.query.before) : null;
  res.json(await inTenant(req, async (q) => {
    const th = await threadById(q, id);
    if (!before) await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: `اطلاع على محادثة ${th.teacher_name} مع ولي أمر ${th.student_name}` });
    return { thread: { id: th.id, teacher_name: th.teacher_name, student_name: th.student_name, class_name: th.class_name,
      closed_at: th.closed_at, closed_by: th.closed_by, close_reason: th.close_reason, flagged_at: th.flagged_at },
    ...(await threadMessages(q, th.id, before, { withFlags: true })) };
  }));
}));

const closeSchema = z.object({ closed: z.boolean(), reason: t.optText(200) });
r.post("/threads/:id/close", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(closeSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const th = await threadById(q, id);
    await q(`UPDATE chat_threads SET closed_at = CASE WHEN $2 THEN now() END, closed_by = CASE WHEN $2 THEN $3 END,
              close_reason = CASE WHEN $2 THEN $4 END WHERE id = $1`, [id, b.closed, req.user?.full_name || req.actor, b.reason || null]);
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor,
      action: `${b.closed ? "إغلاق" : "إعادة فتح"} محادثة ${th.teacher_name} مع ولي أمر ${th.student_name}${b.reason ? `: ${b.reason}` : ""}` });
    return { ok: true };
  }));
}));

r.post("/threads/:id/reviewed", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, async (q) => {
    const th = await threadById(q, id);
    await q("UPDATE chat_threads SET flagged_at = NULL WHERE id = $1", [id]);
    await q("UPDATE chat_messages SET flagged = false WHERE thread_id = $1 AND flagged", [id]);
    await logEvent(q, { tenantId: req.tenantId, actor: req.actor, action: `مراجعة محادثة ${th.teacher_name} مع ولي أمر ${th.student_name} (لا مخالفة)` });
    return { ok: true };
  }));
}));

export default r;
