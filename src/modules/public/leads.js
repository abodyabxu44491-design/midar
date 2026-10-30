/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { kickOwnerPush } from "../shared/alerts.service.js";
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { publicTypes, fromLegacy } from "../shared/org-types.service.js";

const r = Router();
const leadSchema = z.object({
  school_name: t.shortText("اسم المدرسة", 150),
  contact_name: t.name("اسم المسؤول"),
  phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح"),
  email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  city: t.optText(60),
  students_count: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(100000)]).optional().transform((v) => v || null),
  note: t.optText(1000),
  kind: z.enum(["trial", "subscription", "contact"]).prefault("trial"),
  plan_id: z.union([z.literal(""), z.null(), z.coerce.number().int().positive()]).optional().transform((v) => v || null),
  billing_cycle: z.union([z.enum(["monthly", "yearly"]), z.literal(""), z.null()]).optional(),
  months: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(36)]).optional().transform((v) => v || null),
  try_plan: z.boolean().nullable().optional().transform((v) => v ?? true),
  addon_keys: z.array(z.string().max(40)).max(30).nullable().optional().transform((v) => v ?? []),
  details: z.object({
    short_name: t.optText(60),
    // A type key from the list the form shows (older forms sent private/public/international/institute/other).
    org_type: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "نوع المؤسسة غير صحيح").optional(),
    country: z.string().trim().max(60).optional(),
    region: t.optText(60), address: t.optText(200),
    school_phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "هاتف المدرسة غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
    school_email: z.string().trim().email("بريد المدرسة غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
    website: z.string().trim().url("رابط الموقع غير صحيح").max(200).optional().or(z.literal("")).transform((v) => v || null),
    license_no: t.optText(60),
    stages: z.array(z.enum(["kg", "primary", "middle", "secondary"])).max(4).optional(),
    classes_count: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(2000)]).optional().transform((v) => v || null),
    academic_year: t.optText(20),
    manager: z.object({
      first: t.optText(40), second: t.optText(40), third: t.optText(40), family: t.optText(40),
      title: t.optText(60), preferred: z.enum(["whatsapp", "call", "email"]).optional(),
    }).optional(),
  }).optional().prefault({}),
});

function normalize(b) {
  if (b.kind === "subscription") return { ...b, billing_cycle: b.billing_cycle || "yearly" };
  return { ...b, billing_cycle: null, months: null, addon_keys: b.kind === "contact" ? [] : b.addon_keys,
    plan_id: b.kind === "contact" ? null : b.plan_id };
}

const STATUS = {
  new: "وصل طلبك وينتظر المراجعة", reviewing: "قيد المراجعة، وسنتواصل معك قريبًا", approved: "تمت الموافقة، ونجهّز مدرستك",
  awaiting_payment: "بانتظار إتمام الدفع", active: "مدرستك جاهزة، وأرسلنا لكم رابط دخولها", rejected: "اعتذرنا عن الطلب",
  canceled: "أُلغي الطلب", expired: "انتهت صلاحية الطلب",
};
const KIND = { trial: "تجربة مجانية", subscription: "اشتراك", contact: "رسالة تواصل" };

r.post("/", limits.login, handle(async (req, res) => {
  const b = normalize(parse(leadSchema, req.body));
  const m = b.details.manager;
  if (m && (m.first || m.family)) b.contact_name = [m.first, m.second, m.third, m.family].filter(Boolean).join(" ") || b.contact_name;
  const [{ id }] = await transaction({ actor: "زائر", ip: req.ip }, async (q) => {
    if (b.details.org_type) {
      const key = fromLegacy(b.details.org_type);
      const offered = await publicTypes(q);
      if (!offered.some((x) => x.key === key)) throw badRequest("نوع المؤسسة المختار غير متاح");
      b.details.org_type = key;
    }
    return q("SELECT submit_lead($1::jsonb) AS id", [JSON.stringify(b)]);
  });
  kickOwnerPush();
  res.status(201).json({ ok: true, id: Number(id), status: "new", status_label: STATUS.new });
}));

r.post("/status", limits.login, handle(async (req, res) => {
  const b = parse(z.object({ id: z.coerce.number().int().positive("رقم الطلب غير صحيح"), phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح") }), req.body);
  const [row] = await transaction({ ip: req.ip }, (q) => q("SELECT * FROM lead_status($1, $2)", [b.id, b.phone]));
  if (!row) return res.status(404).json({ error: "لم نجد طلبًا بهذا الرقم وهذا الجوال. تأكد من البيانات." });
  res.json({ id: Number(row.id), kind: KIND[row.kind] || row.kind, status: row.status, status_label: STATUS[row.status] || row.status,
    school_name: row.school_name, created_at: row.created_at, updated_at: row.updated_at });
}));

export default r;
