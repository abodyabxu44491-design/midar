/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as exams from "../shared/exams.service.js";

const r = Router();

r.get("/", handle(async (req, res) => res.json(await inTenant(req, exams.listAll))));

r.get("/:id/scores", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, async (q) => exams.sheet(q, await exams.get(q, id))));
}));

// The administration reviews and corrects any grade (draft, waiting, or published).
r.put("/:id/scores", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(exams.scoresSchema, req.body);
  const saved = await inTenant(req, async (q) => {
    const e = await exams.get(q, id);
    for (const v of Object.values(b.scores)) if (v !== "" && v !== null && Number(v) > Number(e.max_score)) throw badRequest(`الدرجة ${v} أكبر من الدرجة القصوى ${Number(e.max_score)}`);
    const clash = await exams.changedSince(q, e, b.scores, b.base);
    if (clash.length) throw Object.assign(conflict("عدّل شخص آخر بعض هذه الدرجات بعد فتحك للصفحة."), { details: { changed: clash } });
    return exams.saveScores(q, e, b.scores, req.actor, { admin: true });
  });
  res.json({ saved });
}));

r.post("/:id/status", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { status } = parse(z.object({ status: z.enum(["published", "draft"]) }), req.body);
  await inTenant(req, async (q) => {
    const e = await exams.get(q, id);
    if (e.status === status) throw badRequest("الاختبار بهذه الحالة مسبقًا");
    await exams.setStatus(q, e, status);
  });
  res.json({ ok: true });
}));

export default r;
