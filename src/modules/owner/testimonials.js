/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const idP = z.object({ id: t.id });
const schema = z.object({
  school_name: t.shortText("اسم المدرسة", 150),
  author_name: t.optText(120),
  author_title: t.optText(80),
  body: z.string().trim().min(10, "نص التقييم قصير").max(600, "نص التقييم طويل (600 حرف كحد أقصى)"),
  rating: z.union([z.coerce.number().int().min(1).max(5), z.literal(""), z.null()]).optional().transform((v) => v || null),
  logo: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/, "صيغة الشعار غير مدعومة").max(400000, "الشعار كبير").nullable().optional(),
  consent: z.boolean().default(false),
  status: z.enum(["pending", "approved", "hidden"]).default("pending"),
  tenant_id: z.string().max(30).nullable().optional().transform((v) => v || null),
  sort: z.coerce.number().int().min(0).max(1000).default(100),
}).refine((x) => x.status !== "approved" || x.consent, { message: "لا يُنشر تقييم قبل موافقة المدرسة على نشره", path: ["consent"] });
const COLS = ["school_name", "author_name", "author_title", "body", "rating", "logo", "consent", "status", "tenant_id", "sort"];

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q("SELECT * FROM testimonials ORDER BY status = 'hidden', sort, id DESC")));
}));
r.post("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  res.status(201).json(await platform(req, async (q) => (await q(
    `INSERT INTO testimonials (${COLS.join(", ")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, COLS.map((k) => b[k] ?? null)))[0]));
}));
r.put("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(schema, req.body);
  res.json(await platform(req, async (q) => {
    const [row] = await q(`UPDATE testimonials SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [id, ...COLS.map((k) => b[k] ?? null)]);
    if (!row) throw notFound("التقييم غير موجود");
    return row;
  }));
}));
r.delete("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await platform(req, async (q) => {
    const rows = await q("DELETE FROM testimonials WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) throw notFound("التقييم غير موجود");
    return { ok: true };
  }));
}));

export default r;
