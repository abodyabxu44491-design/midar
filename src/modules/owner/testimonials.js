/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const idP = z.object({ id: t.id });
const schema = z.object({
  school_name: t.shortText("اسم المدرسة", 150),
  author_name: t.optText(120),
  author_title: t.optText(80),
  body: z.string().trim().min(10, "نص التقييم قصير").max(600, "نص التقييم طويل (600 حرف كحد أقصى)"),
  rating: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(5)]).optional().transform((v) => v || null),
  logo: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/, "صيغة الشعار غير مدعومة").max(400000, "الشعار كبير").nullable().optional(),
  consent: z.boolean().prefault(false),
  status: z.enum(["pending", "approved", "hidden"]).prefault("pending"),
  tenant_id: z.string().max(30).nullable().optional().transform((v) => v || null),
  sort: z.coerce.number().int().min(0).max(1000).prefault(100),
  service_used: t.optText(120),
  consent_by: t.optText(120),
  consent_at: z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ الموافقة غير صحيح")]).optional().transform((v) => v || null),
}).refine((x) => x.status !== "approved" || x.consent, { message: "لا يُنشر تقييم قبل موافقة المدرسة على نشره", path: ["consent"] })
  .refine((x) => x.status !== "approved" || (x.consent_by && x.consent_at),
    { message: "سجّل من وافق على النشر من المدرسة وتاريخ الموافقة قبل نشر التقييم", path: ["consent_by"] });
const COLS = ["school_name", "author_name", "author_title", "body", "rating", "logo", "consent", "status", "tenant_id", "sort",
  "service_used", "consent_by", "consent_at"];

// Database refusals that the owner can act on, in plain words.
function explain(e) {
  if (e.constraint === "testimonials_one_per_school") return badRequest("لهذه المدرسة رأي منشور بالفعل. عدّله أو أخفه قبل نشر غيره.");
  if (e.constraint === "testimonials_no_duplicate") return badRequest("هذا النص موجود في رأي آخر. لا يُنشر الرأي نفسه مرتين.");
  if (e.code === "23503") return badRequest("المدرسة المختارة غير موجودة");
  return e;
}

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT t.*, to_char(t.consent_at, 'YYYY-MM-DD') AS consent_at, x.name AS tenant_name,
            (SELECT count(*)::int FROM testimonial_reports r WHERE r.testimonial_id = t.id AND r.resolved_at IS NULL) AS open_reports
       FROM testimonials t LEFT JOIN tenants x ON x.id = t.tenant_id
      ORDER BY t.status = 'hidden', t.sort, t.id DESC`)));
}));
r.post("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  try {
    res.status(201).json(await platform(req, async (q) => (await q(
      `INSERT INTO testimonials (${COLS.join(", ")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, COLS.map((k) => b[k] ?? null)))[0]));
  } catch (e) { throw explain(e); }
}));
r.put("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(schema, req.body);
  try {
    res.json(await platform(req, async (q) => {
      const [row] = await q(`UPDATE testimonials SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [id, ...COLS.map((k) => b[k] ?? null)]);
      if (!row) throw notFound("التقييم غير موجود");
      return row;
    }));
  } catch (e) { throw explain(e); }
}));
r.delete("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await platform(req, async (q) => {
    const rows = await q("DELETE FROM testimonials WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) throw notFound("التقييم غير موجود");
    return { ok: true };
  }));
}));

// Reports visitors sent about a review, and closing one with what was done.
r.get("/:id/reports", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await platform(req, (q) => q(
    "SELECT id, reason, contact, created_at, resolved_at, resolution FROM testimonial_reports WHERE testimonial_id = $1 ORDER BY id DESC LIMIT 100", [id])));
}));
r.post("/reports/:id/resolve", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { resolution } = parse(z.object({ resolution: t.optText(300) }), req.body);
  res.json(await platform(req, async (q) => {
    const [row] = await q("UPDATE testimonial_reports SET resolved_at = now(), resolution = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING id", [id, resolution]);
    if (!row) throw notFound("البلاغ غير موجود أو أُغلق مسبقًا");
    return { ok: true };
  }));
}));

export default r;
