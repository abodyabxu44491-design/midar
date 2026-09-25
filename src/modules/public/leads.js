// طلب تجربة المنصة من الصفحة التسويقية (يصل إلى لوحة المالك)
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";

const r = Router();
const leadSchema = z.object({
  school_name: t.shortText("اسم المدرسة", 150),
  contact_name: t.name("اسم المسؤول"),
  phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح"),
  email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  city: t.optText(60),
  students_count: z.union([z.coerce.number().int().min(1).max(100000), z.literal("")]).optional().transform((v) => v || null),
  note: t.optText(1000),
  kind: z.enum(["trial", "subscription", "contact"]).default("trial"),
  plan_id: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  billing_cycle: z.enum(["monthly", "yearly"]).optional().or(z.literal("")).transform((v) => v || null),
  months: z.union([z.coerce.number().int().min(1).max(36), z.literal(""), z.null()]).optional().transform((v) => v || null),
  try_plan: z.boolean().default(true),
  addon_keys: z.array(z.string().max(40)).max(30).default([]),
});

r.post("/", limits.login, handle(async (req, res) => {
  const b = parse(leadSchema, req.body);
  await transaction({ actor: "زائر", ip: req.ip }, (q) => q("SELECT submit_lead($1::jsonb)", [JSON.stringify(b)]));
  res.status(201).json({ ok: true });
}));

export default r;
