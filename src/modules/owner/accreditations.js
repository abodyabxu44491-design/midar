/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Certifications the company holds, entered by the owner. One is published only with a way to verify it (an
// official link or a certificate number) and the owner's confirmation that the evidence is on file.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const idP = z.object({ id: t.id });
const day = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح")]).optional().transform((v) => v || null);
const schema = z.object({
  issuer: t.shortText("الجهة المانحة", 150),
  title: t.shortText("اسم الشهادة أو الاعتماد", 150),
  number: t.optText(80),
  issued_on: day,
  expires_on: day,
  verify_url: z.union([z.literal(""), z.null(), z.string().trim().url("رابط التحقق غير صحيح").max(500)
    .refine((v) => v.startsWith("https://"), "رابط التحقق يجب أن يبدأ بـ https://")]).optional().transform((v) => v || null),
  scope: z.string().trim().min(5, "اكتب نطاق الاعتماد وما الذي يغطيه").max(500),
  evidence_confirmed: z.boolean().prefault(false),
  status: z.enum(["draft", "published"]).prefault("draft"),
  sort: z.coerce.number().int().min(0).max(1000).prefault(100),
}).refine((x) => !x.expires_on || !x.issued_on || x.expires_on >= x.issued_on, { message: "تاريخ الانتهاء قبل تاريخ الإصدار", path: ["expires_on"] })
  .refine((x) => x.status !== "published" || x.verify_url || x.number,
    { message: "لا يُنشر اعتماد بلا رابط تحقق رسمي أو رقم شهادة", path: ["verify_url"] })
  .refine((x) => x.status !== "published" || x.evidence_confirmed,
    { message: "أكّد أن وثيقة الاعتماد الرسمية محفوظة لديك قبل النشر", path: ["evidence_confirmed"] });
const COLS = ["issuer", "title", "number", "issued_on", "expires_on", "verify_url", "scope", "evidence_confirmed", "status", "sort"];

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT *, to_char(issued_on, 'YYYY-MM-DD') AS issued_on, to_char(expires_on, 'YYYY-MM-DD') AS expires_on,
            (expires_on IS NOT NULL AND expires_on < CURRENT_DATE) AS expired
       FROM accreditations ORDER BY status DESC, sort, id DESC`)));
}));
r.post("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  res.status(201).json(await platform(req, async (q) => (await q(
    `INSERT INTO accreditations (${COLS.join(", ")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    COLS.map((k) => b[k] ?? null)))[0]));
}));
r.put("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(schema, req.body);
  res.json(await platform(req, async (q) => {
    const [row] = await q(`UPDATE accreditations SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING id`,
      [id, ...COLS.map((k) => b[k] ?? null)]);
    if (!row) throw notFound("الاعتماد غير موجود");
    return row;
  }));
}));
r.delete("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await platform(req, async (q) => {
    if (!(await q("DELETE FROM accreditations WHERE id = $1 RETURNING id", [id])).length) throw notFound("الاعتماد غير موجود");
    return { ok: true };
  }));
}));

export default r;
