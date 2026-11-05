/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A visitor reports a published review as incorrect. The report goes to the owner only; the database function accepts
// it only for a published review and limits how often one address can report.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";

const r = Router();
const schema = z.object({
  reason: z.string().trim().min(5, "اكتب سبب البلاغ").max(500, "السبب طويل (500 حرف كحد أقصى)"),
  contact: t.optText(120),
});

// Only a review number matches, so a school whose id happens to be "reviews" keeps its own routes.
r.post("/:id/report", (req, res, next) => next(/^[0-9]{1,18}$/.test(req.params.id) ? undefined : "router"), limits.login, handle(async (req, res) => {
  const { id } = parse(z.object({ id: t.id }), req.params);
  const b = parse(schema, req.body);
  await transaction({ ip: req.ip }, (q) => q("SELECT report_testimonial($1, $2, $3)", [id, b.reason, b.contact]));
  res.status(201).json({ ok: true, message: "وصلنا بلاغك، وسنراجعه. شكرًا لك." });
}));

export default r;
