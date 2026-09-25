// «اشتراكي» في لوحة المدرسة: الباقة والحالة والتواريخ والاستخدام، والمميزات المتاحة والمقفلة،
// والباقات المتاحة للترقية، وطلبات المدرسة (ميزة، ترقية، تجديد، اشتراك). يبقى متاحًا حتى عند توقف الاشتراك.
import { Router } from "express";
import { inTenant, transaction } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { accessSummary, entitlements, STATUS_LABEL } from "../shared/subscription.service.js";
import { publicPlans } from "../shared/plans-public.service.js";

const r = Router();

const EVENT_LABEL = {
  migrated: "تحويل من النظام السابق", trial_started: "بدء التجربة المجانية", trial_extended: "تمديد التجربة",
  trial_ended: "إنهاء التجربة", trial_expired: "انتهت التجربة", activated: "تفعيل الاشتراك", converted: "تحويل التجربة لاشتراك",
  renewed: "تجديد", upgraded: "ترقية", downgraded: "تغيير إلى باقة أقل", reactivated: "إعادة تفعيل", extended: "تمديد",
  expired: "انتهاء الاشتراك", suspended: "إيقاف", resumed: "استئناف", canceled: "إلغاء", paid: "تأكيد السداد",
  addon_added: "إضافة ميزة", addon_removed: "إزالة ميزة", plan_updated: "تحديث مميزات الباقة", reminder: "تنبيه قرب الانتهاء",
};

r.get("/", handle(async (req, res) => {
  const data = await inTenant(req, async (q) => {
    const sub = req.subscription;
    const [use] = await q(`SELECT (SELECT count(*) FROM students WHERE status = 'active')::int AS students,
                                  (SELECT count(*) FROM teachers)::int AS teachers`);
    const catalog = await q("SELECT key, name, description, category, kind, requestable FROM features WHERE is_active ORDER BY sort, key");
    const ent = entitlements(sub);
    const addonKeys = new Set((sub?.addons || []).filter((a) => !a.until || a.until >= new Date().toISOString().slice(0, 10)).map((a) => a.key));
    const requests = await q(
      `SELECT l.id, l.kind, l.status, l.feature_key, f.name AS feature_name, p.name AS plan_name, l.months, l.note, l.owner_note, l.created_at
         FROM leads l LEFT JOIN features f ON f.key = l.feature_key LEFT JOIN plans p ON p.id = l.plan_id
        WHERE l.source = 'school' ORDER BY l.id DESC LIMIT 30`);
    const events = await q("SELECT event, details, created_at FROM subscription_events WHERE event <> 'reminder' ORDER BY id DESC LIMIT 30");
    return { use, catalog, ent, addonKeys, requests, events };
  });
  const [ps] = await transaction({}, (q) => q(
    `SELECT feature_request_mode, show_plans_after_expiry, support_whatsapp, support_note, brand_email, trial_days
       FROM platform_settings WHERE id`));
  const sub = req.subscription;
  const access = accessSummary(req);
  res.json({
    access,
    subscription: sub ? {
      plan_name: sub.plan_name, kind: sub.kind, status: sub.status, status_label: STATUS_LABEL[access.status] || STATUS_LABEL[sub.status],
      starts_on: sub.starts_on, ends_on: sub.ends_on, billing_cycle: sub.billing_cycle,
      max_students: sub.max_students, max_teachers: sub.max_teachers, addons: sub.addons,
    } : null,
    usage: data.use,
    features: data.catalog.map((f) => ({ ...f, included: data.ent.has(f.key), addon: data.addonKeys.has(f.key) })),
    plans: access.locked && !ps.show_plans_after_expiry ? [] : await publicPlans(),
    requests: data.requests,
    history: data.events.map((e) => ({ ...e, label: EVENT_LABEL[e.event] || e.event })),
    feature_request_mode: ps.feature_request_mode,
    support: { whatsapp: ps.support_whatsapp, note: ps.support_note, email: ps.brand_email },
  });
}));

const requestSchema = z.object({
  kind: z.enum(["feature", "upgrade", "renewal", "subscription", "contact"]),
  feature_key: z.string().max(40).optional(),
  plan_id: t.optId,
  billing_cycle: z.enum(["monthly", "yearly"]).optional(),
  months: z.coerce.number().int().min(1).max(36).optional(),
  note: t.optText(1000),
  contact_name: t.optText(120),
  contact_phone: z.string().trim().max(25).optional().or(z.literal("")).transform((v) => v || null),
});

r.post("/requests", handle(async (req, res) => {
  const b = parse(requestSchema, req.body);
  const row = await inTenant(req, async (q) => {
    const [ps] = await q("SELECT feature_request_mode FROM platform_settings WHERE id");
    if (b.kind === "feature") {
      if (ps.feature_request_mode === "hidden") throw badRequest("طلب المميزات غير متاح حاليًا. تواصل مع إدارة المنصة.");
      const [f] = await q("SELECT key, requestable FROM features WHERE key = $1 AND is_active", [b.feature_key || ""]);
      if (!f) throw badRequest("الميزة غير موجودة");
      if (!f.requestable) throw badRequest("هذه الميزة لا تُطلب منفردة. اطلب ترقية الباقة.");
      if (entitlements(req.subscription).has(f.key)) throw badRequest("هذه الميزة متاحة في اشتراكك أصلًا");
    }
    if (b.plan_id) {
      const [p] = await q("SELECT 1 FROM plans WHERE id = $1 AND status = 'active'", [b.plan_id]);
      if (!p) throw badRequest("الباقة غير متاحة");
    }
    const [open] = await q(
      `SELECT id FROM leads WHERE source = 'school' AND kind = $1 AND status IN ('new', 'reviewing')
         AND COALESCE(feature_key, '') = COALESCE($2, '')`, [b.kind, b.feature_key || null]);
    if (open) throw badRequest("لديك طلب مماثل بانتظار الرد. سنتواصل معك قريبًا.");
    const [tn] = await q("SELECT name FROM tenants WHERE id = app_tenant()");
    const [created] = await q(
      `INSERT INTO leads (school_name, contact_name, phone, note, tenant_id, kind, source, feature_key, plan_id,
                          billing_cycle, months, requested_by)
       VALUES ($1, $2, $3, $4, app_tenant(), $5, 'school', $6, $7, $8, $9, $10)
       RETURNING id, kind, status, created_at`,
      [tn.name, b.contact_name || req.user.full_name, b.contact_phone, b.note ?? null, b.kind, b.feature_key || null,
       b.plan_id ?? null, b.billing_cycle ?? null, b.months ?? null, req.actor]);
    return created;
  });
  res.status(201).json(row);
}));

export default r;
