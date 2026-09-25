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
  students_count: z.union([z.coerce.number().int().min(1).max(100000), z.literal(""), z.null()]).optional().transform((v) => v || null),
  note: t.optText(1000),
  kind: z.enum(["trial", "subscription", "contact"]).default("trial"),
  plan_id: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  // مدة الاشتراك: تقبل غيابها أو قيمة فارغة أو null (التجربة والتواصل ليس فيهما مدة)،
  // وتُحسم بعد التحقق حسب نوع الطلب (انظر normalize أدناه) — لا تُرفض ولا تُخمَّن
  billing_cycle: z.union([z.enum(["monthly", "yearly"]), z.literal(""), z.null()]).optional(),
  months: z.union([z.coerce.number().int().min(1).max(36), z.literal(""), z.null()]).optional().transform((v) => v || null),
  try_plan: z.boolean().nullable().optional().transform((v) => v ?? true),
  addon_keys: z.array(z.string().max(40)).max(30).nullable().optional().transform((v) => v ?? []),
});

// توحيد القيم حسب نوع الطلب (نفس القيم المسموحة في قاعدة البيانات):
//   اشتراك: المدة شهري أو سنوي، والافتراضي سنوي إن لم يُختر شيء
//   تجربة/تواصل: لا مدة ولا عدد أشهر ولا إضافات (مجانية أو استفسار)
function normalize(b) {
  if (b.kind === "subscription") return { ...b, billing_cycle: b.billing_cycle || "yearly" };
  return { ...b, billing_cycle: null, months: null, addon_keys: b.kind === "contact" ? [] : b.addon_keys,
    plan_id: b.kind === "contact" ? null : b.plan_id };
}

r.post("/", limits.login, handle(async (req, res) => {
  const b = normalize(parse(leadSchema, req.body));
  await transaction({ actor: "زائر", ip: req.ip }, (q) => q("SELECT submit_lead($1::jsonb)", [JSON.stringify(b)]));
  res.status(201).json({ ok: true });
}));

export default r;
