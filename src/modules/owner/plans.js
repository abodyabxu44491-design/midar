// لوحة المالك: كتالوج المميزات والباقات والأسعار الخاصة — كلها بلا أي تعديل في الكود
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, badRequest, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { syncCatalog, applyPlanChange } from "../shared/subscription.service.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const money = z.union([z.coerce.number().min(0).max(10_000_000), z.literal(""), z.null()]).optional()
  .transform((v) => (v === "" ? null : v));
const optInt = (max) => z.union([z.coerce.number().int().min(1).max(max), z.literal(""), z.null()]).optional()
  .transform((v) => (v === "" ? null : v));

/* ---------- كتالوج المميزات ---------- */
const featureSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "المفتاح: حروف إنجليزية صغيرة وأرقام و _"),
  name: t.shortText("اسم الميزة", 80),
  description: t.optText(300),
  category: z.string().trim().min(2).max(40).default("الخدمات"),
  sort: z.coerce.number().int().min(0).max(10000).default(100),
  requestable: z.boolean().default(true),
  addon_monthly: money, addon_yearly: money,
});
const featurePatch = featureSchema.omit({ key: true }).partial().extend({ is_active: z.boolean().optional() });

r.get("/catalog", handle(async (req, res) => {
  res.json(await platform(req, async (q) => {
    await syncCatalog(q);
    return q(`SELECT f.*, (SELECT count(*)::int FROM plan_features pf WHERE pf.feature_key = f.key) AS plans
                FROM features f ORDER BY f.sort, f.key`);
  }));
}));

// الميزة الجديدة من اللوحة تكون «خدمة» (دعم، تدريب…). الأقسام البرمجية تظهر هنا تلقائيًا عند إضافتها للمنصة.
r.post("/catalog", handle(async (req, res) => {
  const b = parse(featureSchema, req.body);
  res.status(201).json(await platform(req, async (q) => {
    const [dup] = await q("SELECT 1 FROM features WHERE key = $1", [b.key]);
    if (dup) throw conflict("هذا المفتاح مستخدم");
    const [row] = await q(
      `INSERT INTO features (key, name, description, category, kind, sort, requestable, addon_monthly, addon_yearly)
       VALUES ($1, $2, $3, $4, 'service', $5, $6, $7, $8) RETURNING *`,
      [b.key, b.name, b.description ?? null, b.category, b.sort, b.requestable, b.addon_monthly ?? null, b.addon_yearly ?? null]);
    return row;
  }));
}));

r.patch("/catalog/:key", handle(async (req, res) => {
  const key = parse(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), req.params.key);
  const b = parse(featurePatch, req.body);
  await platform(req, async (q) => {
    const [cur] = await q("SELECT * FROM features WHERE key = $1", [key]);
    if (!cur) throw notFound("الميزة غير موجودة");
    const keys = Object.keys(b).filter((k) => b[k] !== undefined);
    if (!keys.length) return;
    await q(`UPDATE features SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE key = $1`, [key, ...keys.map((k) => b[k])]);
  });
  res.json({ ok: true });
}));

/* ---------- الباقات ---------- */
const planSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,29}$/, "رمز الباقة: حروف إنجليزية صغيرة وأرقام"),
  name: t.shortText("اسم الباقة", 60),
  tagline: t.optText(80), description: t.optText(500), badge: t.optText(30),
  currency: z.enum(["SAR", "YER", "USD"]).default("SAR"),
  monthly_price: money, yearly_price: money,
  setup_fee: z.coerce.number().min(0).max(10_000_000).default(0),
  discount_percent: z.coerce.number().min(0).max(90).default(0),
  promo_label: t.optText(60),
  promo_percent: z.union([z.coerce.number().min(1).max(90), z.literal(""), z.null()]).optional().transform((v) => (v === "" ? null : v)),
  promo_ends_at: t.optDate,
  contact_only: z.boolean().default(false),
  max_students: optInt(100000), max_teachers: optInt(10000),
  trial_enabled: z.boolean().default(true),
  is_public: z.boolean().default(true),
  highlight: z.boolean().default(false),
  sort: z.coerce.number().int().min(0).max(1000).default(100),
  features: z.array(z.string().max(40)).max(200).default([]),          // بالترتيب المطلوب في الصفحة
}).refine((p) => !p.promo_percent === !p.promo_ends_at, "العرض المؤقت يحتاج نسبة وتاريخ انتهاء معًا");
// التعديل: نفس الحقول + أين يُطبَّق التغيير
const planUpdate = z.object({
  plan: z.any(),
  apply: z.enum(["new", "existing", "tenant"]).default("new"),
  tenant_id: z.string().max(30).optional(),
  confirm: z.boolean().default(false),
});

async function listPlans(q) {
  const plans = await q(
    `SELECT p.*,
            (SELECT count(*)::int FROM subscriptions s JOIN tenants t ON t.subscription_id = s.id
              WHERE s.plan_id = p.id AND s.status IN ('trial', 'active')) AS schools
       FROM plans p ORDER BY p.status = 'archived', p.sort, p.id`);
  const feats = await q("SELECT plan_id, feature_key FROM plan_features ORDER BY sort, feature_key");
  return plans.map((p) => ({ ...p, features: feats.filter((f) => f.plan_id === p.id).map((f) => f.feature_key) }));
}

async function writeFeatures(q, planId, keys) {
  const valid = new Set((await q("SELECT key FROM features WHERE key = ANY($1)", [keys])).map((r) => r.key));
  await q("DELETE FROM plan_features WHERE plan_id = $1", [planId]);
  let i = 0;
  for (const k of keys) if (valid.has(k)) await q("INSERT INTO plan_features (plan_id, feature_key, sort) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [planId, k, i++]);
}

const PLAN_COLS = ["code", "name", "tagline", "description", "badge", "currency", "monthly_price", "yearly_price", "setup_fee",
  "discount_percent", "promo_label", "promo_percent", "promo_ends_at", "contact_only", "max_students", "max_teachers",
  "trial_enabled", "is_public", "highlight", "sort"];

r.get("/plans", handle(async (req, res) => res.json(await platform(req, listPlans))));

r.post("/plans", handle(async (req, res) => {
  const b = parse(planSchema, req.body);
  res.status(201).json(await platform(req, async (q) => {
    const [dup] = await q("SELECT 1 FROM plans WHERE code = $1", [b.code]);
    if (dup) throw conflict("رمز الباقة مستخدم");
    const [row] = await q(`INSERT INTO plans (${PLAN_COLS.join(", ")}) VALUES (${PLAN_COLS.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      PLAN_COLS.map((k) => b[k] ?? null));
    await writeFeatures(q, row.id, b.features);
    return row;
  }));
}));

/**
 * تعديل الباقة. التطبيق الافتراضي على الاشتراكات الجديدة فقط (اللقطات القديمة لا تتغير).
 * «existing» يحدّث لقطات كل الاشتراكات الحالية على الباقة، و«tenant» مدرسة واحدة، ويحتاج confirm.
 */
r.put("/plans/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const u = parse(planUpdate, req.body);
  const b = parse(planSchema, u.plan);
  if (u.apply !== "new" && !u.confirm) throw badRequest("تطبيق التغيير على الاشتراكات الحالية يحتاج تأكيدًا");
  if (u.apply === "tenant" && !u.tenant_id) throw badRequest("حدد المدرسة");
  res.json(await platform(req, async (q) => {
    const [cur] = await q("SELECT * FROM plans WHERE id = $1 FOR UPDATE", [id]);
    if (!cur) throw notFound("الباقة غير موجودة");
    const [dup] = await q("SELECT 1 FROM plans WHERE code = $1 AND id <> $2", [b.code, id]);
    if (dup) throw conflict("رمز الباقة مستخدم");
    await q(`UPDATE plans SET ${PLAN_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...PLAN_COLS.map((k) => b[k] ?? null)]);
    await writeFeatures(q, id, b.features);
    const affected = await applyPlanChange(q, id, u.apply, u.tenant_id, req.actor);
    return { ok: true, affected };
  }));
}));

// الحالة: فعّالة / موقوفة مؤقتًا (لا تُباع) / مؤرشفة. الاشتراكات القائمة عليها لا تتأثر.
r.post("/plans/:id/status", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(z.object({ status: z.enum(["active", "paused", "archived"]) }), req.body);
  await platform(req, async (q) => {
    const rows = await q("UPDATE plans SET status = $2 WHERE id = $1 RETURNING id", [id, b.status]);
    if (!rows.length) throw notFound("الباقة غير موجودة");
  });
  res.json({ ok: true });
}));

/* ---------- سعر خاص لمدرسة ---------- */
r.get("/prices/:tenant", handle(async (req, res) => {
  const tenant = parse(z.string().max(30), req.params.tenant);
  res.json(await platform(req, (q) => q(
    `SELECT tp.*, p.name AS plan_name, p.monthly_price AS base_monthly, p.yearly_price AS base_yearly
       FROM tenant_prices tp JOIN plans p ON p.id = tp.plan_id WHERE tp.tenant_id = $1 ORDER BY p.sort`, [tenant])));
}));
r.put("/prices/:tenant/:plan", handle(async (req, res) => {
  const tenant = parse(z.string().max(30), req.params.tenant);
  const plan = parse(t.id, req.params.plan);
  const b = parse(z.object({ monthly_price: money, yearly_price: money, note: t.optText(200) }), req.body);
  await platform(req, async (q) => {
    const [tn] = await q("SELECT 1 FROM tenants WHERE id = $1", [tenant]);
    if (!tn) throw notFound("المدرسة غير موجودة");
    await q(`INSERT INTO tenant_prices (tenant_id, plan_id, monthly_price, yearly_price, note) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, plan_id) DO UPDATE SET monthly_price = $3, yearly_price = $4, note = $5, updated_at = now()`,
      [tenant, plan, b.monthly_price ?? null, b.yearly_price ?? null, b.note ?? null]);
  });
  res.json({ ok: true });
}));
r.delete("/prices/:tenant/:plan", handle(async (req, res) => {
  const tenant = parse(z.string().max(30), req.params.tenant);
  const plan = parse(t.id, req.params.plan);
  await platform(req, (q) => q("DELETE FROM tenant_prices WHERE tenant_id = $1 AND plan_id = $2", [tenant, plan]));
  res.json({ ok: true });
}));

export default r;
