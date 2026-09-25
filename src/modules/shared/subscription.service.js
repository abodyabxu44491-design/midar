// الاشتراكات: حالة الوصول، والمميزات المستحقة، وكل عمليات المالك (تجربة، تفعيل، تجديد، ترقية، إضافات…)
//
// قاعدة ثابتة: الاشتراك يحدد «الوصول» فقط. انتهاؤه لا يحذف شيئًا من بيانات المدرسة،
// وتفعيل اشتراك جديد يعيد المدرسة للعمل ببياناتها نفسها.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { MODULES, KEYS } from "./modules.service.js";
import { displayPrice } from "./plans-public.service.js";

export const STATUS_LABEL = {
  trial: "تجربة مجانية", active: "فعّال", pending_payment: "بانتظار الدفع", trial_expired: "انتهت التجربة",
  expired: "منتهي", suspended: "موقوف", canceled: "ملغي", ended: "منتهٍ (استُبدل)",
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

/* ======================= كتالوج المميزات ======================= */
// كل قسم برمجي جديد يُعرَّف مرة واحدة في MODULES (modules.service.js) فيظهر هنا تلقائيًا،
// ثم يحدد المالك الباقات التي تحتويه من لوحته.
export async function syncCatalog(q) {
  for (const [i, m] of MODULES.entries()) {
    await q(`INSERT INTO features (key, name, description, category, kind, sort)
             VALUES ($1, $2, $3, 'أقسام جديدة', 'module', $4) ON CONFLICT (key) DO NOTHING`, [m.key, m.name, m.note || null, 200 + i]);
  }
}

/* ======================= حالة الوصول ======================= */
/**
 * sub: صف الاشتراك الحالي، trialGrace: أيام السماح بعد التجربة
 * يعيد: { state, locked, days_left, ends_on, message }
 *   state: trial | trial_grace | active | grace | locked
 */
export function accessOf(sub, trialGrace = 0, now = today()) {
  if (!sub) return { state: "active", locked: false, status: "active", kind: "paid" };
  const ends = iso(sub.ends_on);
  const left = ends ? daysBetween(now, ends) : null;
  const base = { status: sub.status, kind: sub.kind, ends_on: ends, days_left: left, plan_name: sub.plan_name };
  if (sub.status === "trial") {
    if (left >= 0) return { ...base, state: "trial", locked: false };
    if (-left <= trialGrace) return { ...base, state: "trial_grace", locked: false };
    return { ...base, status: "trial_expired", state: "locked", locked: true };
  }
  if (sub.status === "active") {
    if (left === null || left >= 0) return { ...base, state: "active", locked: false };
    if (-left <= sub.grace_days) return { ...base, state: "grace", locked: false, grace_left: sub.grace_days + left };
    return { ...base, status: "expired", state: "locked", locked: true };
  }
  return { ...base, state: "locked", locked: true };
}

export const LOCK_MESSAGE = {
  trial_expired: "انتهت فترة التجربة المجانية. اختر باقة للاستمرار، وبياناتك كلها محفوظة.",
  expired: "انتهى اشتراك مدرستك. جدّد الاشتراك للمتابعة، وبياناتك كلها محفوظة.",
  pending_payment: "اشتراك مدرستك بانتظار الدفع. سيُفعَّل فور تأكيد السداد.",
  suspended: "اشتراك مدرستك موقوف مؤقتًا. تواصل مع إدارة المنصة.",
  canceled: "اشتراك مدرستك ملغي. تواصل مع إدارة المنصة لإعادة التفعيل.",
  ended: "لا يوجد اشتراك فعّال لمدرستك. تواصل مع إدارة المنصة.",
};

// المميزات المستحقة = لقطة الباقة وقت التفعيل + الإضافات السارية
export function entitlements(sub, now = today()) {
  if (!sub) return new Set(KEYS);
  const set = new Set(sub.snapshot?.features || []);
  for (const a of sub.addons || []) if (!a.until || a.until >= now) set.add(a.key);
  return set;
}

// الاشتراك الحالي للمدرسة (داخل سياق المدرسة)
export async function currentSub(q) {
  const [row] = await q(
    `SELECT s.*, (SELECT trial_grace_days FROM platform_settings WHERE id) AS trial_grace
       FROM tenants t JOIN subscriptions s ON s.id = t.subscription_id WHERE t.id = app_tenant()`);
  return row || null;
}

// كل ما يحتاجه الحارس في طلب واحد: حالة الوصول والمميزات المستحقة
export async function accessContext(q) {
  const sub = await currentSub(q);
  return { sub, access: accessOf(sub, sub?.trial_grace || 0), entitled: entitlements(sub) };
}

/* ======================= اللقطة ======================= */
export async function planSnapshot(q, planId) {
  const [p] = await q("SELECT * FROM plans WHERE id = $1", [planId]);
  if (!p) throw notFound("الباقة غير موجودة");
  const feats = await q("SELECT feature_key FROM plan_features WHERE plan_id = $1 ORDER BY sort, feature_key", [planId]);
  return {
    plan: p,
    snapshot: {
      features: feats.map((f) => f.feature_key),
      limits: { max_students: p.max_students, max_teachers: p.max_teachers },
      prices: { monthly: p.monthly_price, yearly: p.yearly_price, setup_fee: p.setup_fee, currency: p.currency },
      plan_code: p.code, captured_at: new Date().toISOString(),
    },
  };
}

// السعر الفعلي لمدرسة: سعرها الخاص إن وُجد، وإلا سعر الباقة بعد الخصم الساري (نفس دالة الصفحة العامة)
export async function priceFor(q, tenantId, plan, cycle) {
  if (!["monthly", "yearly"].includes(cycle)) return 0;
  const [custom] = tenantId ? await q("SELECT * FROM tenant_prices WHERE tenant_id = $1 AND plan_id = $2", [tenantId, plan.id]) : [];
  if (custom && custom[`${cycle}_price`] != null) return Number(custom[`${cycle}_price`]);
  return displayPrice(plan, cycle)?.final ?? 0;
}

/* ======================= السجل ======================= */
export const logEvent = (q, tenantId, subId, event, details, actor) => q(
  "INSERT INTO subscription_events (tenant_id, subscription_id, event, details, actor) VALUES ($1, $2, $3, $4, $5)",
  [tenantId, subId, event, details || {}, actor]);

/* ======================= عمليات المالك (سياق المنصة) ======================= */
export const activateSchema = z.object({
  kind: z.enum(["trial", "paid", "free"]),
  plan_id: t.optId,
  features: z.array(z.string().max(40)).max(100).optional(),     // لباقة مخصصة بلا plan_id
  plan_name: z.string().trim().min(2).max(60).optional(),
  billing_cycle: z.enum(["monthly", "yearly", "custom", "none"]).default("yearly"),
  starts_on: t.optDate,
  ends_on: t.optDate,                     // يُتجاهل في التجربة (يُحسب تلقائيًا)
  months: z.coerce.number().int().min(1).max(60).optional(),
  price: z.union([z.coerce.number().min(0).max(10_000_000), z.literal(""), z.null()]).optional(),
  discount: z.coerce.number().min(0).max(10_000_000).default(0),
  addons: z.array(z.object({ key: z.string().max(40), until: t.optDate, price: z.coerce.number().min(0).optional(), note: z.string().max(100).optional() })).max(40).default([]),
  max_students: z.union([z.coerce.number().int().min(1).max(100000), z.literal(""), z.null()]).optional(),
  max_teachers: z.union([z.coerce.number().int().min(1).max(10000), z.literal(""), z.null()]).optional(),
  status: z.enum(["active", "pending_payment"]).default("active"),
  grace_days: z.coerce.number().int().min(0).max(120).optional(),
  force_trial: z.boolean().default(false),          // منح تجربة جديدة رغم استنفاد التجارب
  note: z.string().trim().max(500).optional(),
  lead_id: t.optId,
});

async function settings(q) { return (await q("SELECT * FROM platform_settings WHERE id"))[0]; }

export async function trialHistory(q, tenantId) {
  return q(`SELECT id, plan_name, starts_on, ends_on, status, created_at FROM subscriptions
             WHERE tenant_id = $1 AND kind = 'trial' ORDER BY id`, [tenantId]);
}

/**
 * إنشاء اشتراك جديد وجعله الحالي. الاشتراك السابق يُغلق (ended) ويبقى في السجل.
 * التجربة: تاريخ النهاية يُحسب تلقائيًا من مدة التجربة في الإعدادات.
 */
export async function activate(q, tenantId, b, actor, opts = {}) {
  const s = await settings(q);
  const [tenant] = await q("SELECT * FROM tenants WHERE id = $1 FOR UPDATE", [tenantId]);
  if (!tenant) throw notFound("المدرسة غير موجودة");
  const [prev] = tenant.subscription_id ? await q("SELECT * FROM subscriptions WHERE id = $1", [tenant.subscription_id]) : [];

  let plan = null; let snapshot;
  if (b.plan_id) ({ plan, snapshot } = await planSnapshot(q, b.plan_id));
  else {
    if (!b.features?.length) throw badRequest("اختر الباقة أو حدد المميزات");
    const valid = (await q("SELECT key FROM features WHERE key = ANY($1)", [b.features])).map((r) => r.key);
    snapshot = { features: valid, limits: { max_students: b.max_students || null, max_teachers: b.max_teachers || null }, captured_at: new Date().toISOString() };
  }
  if (plan && plan.status === "archived") throw badRequest("الباقة مؤرشفة. اخترْ باقة فعالة.");

  const start = b.starts_on || today();
  let end; let status; let price = 0;
  if (b.kind === "trial") {
    if (!s.trial_enabled && !b.force_trial) throw badRequest("التجربة المجانية متوقفة من إعدادات المنصة");
    if (plan && !s.trial_all_plans && !plan.trial_enabled && !b.force_trial) throw badRequest("هذه الباقة لا تتيح تجربة مجانية");
    const used = (await trialHistory(q, tenantId)).length;
    if (used >= s.trials_per_school && !b.force_trial) {
      throw conflict(`استُخدمت التجربة المجانية لهذه المدرسة (${used} من ${s.trials_per_school}). يمكنك منح تجربة جديدة يدويًا.`);
    }
    end = addDays(start, s.trial_days);           // لا إدخال يدوي لتاريخ نهاية التجربة
    status = "trial";
  } else {
    end = b.ends_on || (b.months ? addMonths(start, b.months)
      : b.billing_cycle === "monthly" ? addMonths(start, 1) : b.billing_cycle === "yearly" ? addMonths(start, 12) : null);
    status = b.status;
    if (b.kind === "paid") {
      price = b.price !== undefined && b.price !== "" && b.price !== null ? Number(b.price)
        : plan ? await priceFor(q, tenantId, plan, b.billing_cycle) : 0;
    }
  }
  const limits = {
    max_students: b.max_students !== undefined && b.max_students !== "" ? b.max_students : snapshot.limits?.max_students ?? null,
    max_teachers: b.max_teachers !== undefined && b.max_teachers !== "" ? b.max_teachers : snapshot.limits?.max_teachers ?? null,
  };
  snapshot.limits = limits;
  const addons = (b.addons || []).map((a) => ({ key: a.key, until: a.until || null, price: a.price ?? 0, note: a.note || null }));

  const [sub] = await q(
    `INSERT INTO subscriptions (tenant_id, kind, status, plan_id, plan_name, snapshot, addons, billing_cycle, price, discount,
        currency, starts_on, ends_on, grace_days, max_students, max_teachers, source_lead_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
    [tenantId, b.kind, status, plan?.id ?? opts.plan_id ?? null, plan?.name ?? b.plan_name ?? "باقة مخصصة", snapshot, JSON.stringify(addons),
     b.kind === "trial" ? "none" : b.billing_cycle, price, b.discount || 0, plan?.currency ?? tenant.currency ?? "SAR",
     start, end, b.grace_days ?? (b.kind === "trial" ? 0 : s.default_grace_days), limits.max_students, limits.max_teachers,
     b.lead_id ?? null, b.note ?? null, actor]);

  if (prev && !["ended", "canceled"].includes(prev.status)) {
    await q("UPDATE subscriptions SET status = 'ended', ended_at = now() WHERE id = $1", [prev.id]);
  }
  await syncTenant(q, tenantId, sub);

  // نوع الحدث للسجل: بداية تجربة، تفعيل، تجديد، ترقية، تخفيض، إعادة تفعيل
  let event = b.kind === "trial" ? "trial_started" : "activated";
  if (b.kind !== "trial" && prev) {
    const prevPrice = Number(prev.snapshot?.prices?.yearly ?? prev.price ?? 0);
    const newPrice = Number(snapshot.prices?.yearly ?? price);
    if (["expired", "trial_expired", "suspended", "canceled"].includes(prev.status)) event = "reactivated";
    else if (prev.plan_id && plan && prev.plan_id === plan.id) event = "renewed";
    else if (prev.kind === "trial") event = "converted";
    else if (newPrice > prevPrice) event = "upgraded";
    else if (newPrice < prevPrice) event = "downgraded";
  }
  if (opts.event) event = opts.event;
  await logEvent(q, tenantId, sub.id, event, { plan: sub.plan_name, price, starts_on: start, ends_on: end, addons: addons.map((a) => a.key) }, actor);
  if (b.lead_id) await q("UPDATE leads SET status = $2, tenant_id = $3, handled_by = $4 WHERE id = $1",
    [b.lead_id, status === "pending_payment" ? "awaiting_payment" : "active", tenantId, actor]);
  return sub;
}

// حقول المدرسة القديمة (يعتمد عليها حد الطلاب وقوائم الفوترة) تبقى متزامنة مع الاشتراك الحالي
export async function syncTenant(q, tenantId, sub) {
  await q(
    `UPDATE tenants SET subscription_id = $2, plan = $3, max_students = COALESCE($4, 100000), subscription_end = $5,
        subscription_price = $6, grace_days = $7,
        status = CASE WHEN status = 'suspended' AND auto_suspended_at IS NOT NULL THEN 'active' ELSE status END,
        auto_suspended_at = NULL
      WHERE id = $1`,
    [tenantId, sub.id, sub.plan_name, sub.max_students, sub.ends_on, sub.price, sub.grace_days]);
}

async function current(q, tenantId) {
  const [s] = await q("SELECT s.* FROM subscriptions s JOIN tenants t ON t.subscription_id = s.id WHERE t.id = $1 FOR UPDATE OF s", [tenantId]);
  if (!s) throw notFound("لا يوجد اشتراك لهذه المدرسة");
  return s;
}

export const actionSchema = z.object({
  action: z.enum(["extend", "end_trial", "suspend", "resume", "cancel", "set_addons", "renew", "mark_paid"]),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  until: t.optDate,
  months: z.coerce.number().int().min(1).max(60).optional(),
  addons: activateSchema.shape.addons.optional(),
  note: z.string().trim().max(300).optional(),
});

/** عمليات على الاشتراك الحالي: تمديد، إنهاء تجربة، إيقاف، استئناف، إلغاء، إضافات، تجديد، تأكيد دفع */
export async function act(q, tenantId, b, actor) {
  const s = await current(q, tenantId);
  const set = await settings(q);
  switch (b.action) {
    case "extend": {
      if (s.kind === "trial" && !set.trial_owner_extend) throw badRequest("تمديد التجربة متوقف من إعدادات التجربة");
      if (!s.ends_on) throw badRequest("الاشتراك بلا تاريخ نهاية");
      const base = iso(s.ends_on) < today() ? today() : iso(s.ends_on);
      const end = b.until || addDays(base, b.days || 7);
      const status = s.status === "trial_expired" ? "trial" : s.status === "expired" ? "active" : s.status;
      await q("UPDATE subscriptions SET ends_on = $2, status = $3 WHERE id = $1", [s.id, end, status]);
      await logEvent(q, tenantId, s.id, s.kind === "trial" ? "trial_extended" : "extended", { from: iso(s.ends_on), to: end, note: b.note }, actor);
      break;
    }
    case "end_trial":
      if (s.kind !== "trial") throw badRequest("الاشتراك الحالي ليس تجربة");
      await q("UPDATE subscriptions SET status = 'trial_expired', ends_on = LEAST(ends_on, CURRENT_DATE) WHERE id = $1", [s.id]);
      await logEvent(q, tenantId, s.id, "trial_ended", { note: b.note }, actor);
      break;
    case "suspend":
      if (["suspended", "canceled", "ended"].includes(s.status)) throw badRequest("الاشتراك غير فعّال أصلًا");
      await q("UPDATE subscriptions SET status = 'suspended', snapshot = snapshot || jsonb_build_object('suspended_from', status) WHERE id = $1", [s.id]);
      await logEvent(q, tenantId, s.id, "suspended", { note: b.note }, actor);
      break;
    case "resume": {
      if (!["suspended", "pending_payment", "expired", "trial_expired", "canceled"].includes(s.status)) throw badRequest("الاشتراك فعّال أصلًا");
      const back = s.status === "suspended" ? (s.snapshot?.suspended_from || "active") : s.kind === "trial" ? "trial" : "active";
      await q("UPDATE subscriptions SET status = $2 WHERE id = $1", [s.id, back === "trial_expired" ? "trial" : back === "expired" ? "active" : back]);
      await logEvent(q, tenantId, s.id, "resumed", { note: b.note }, actor);
      break;
    }
    case "mark_paid":
      if (s.status !== "pending_payment") throw badRequest("الاشتراك ليس بانتظار الدفع");
      await q("UPDATE subscriptions SET status = 'active' WHERE id = $1", [s.id]);
      await logEvent(q, tenantId, s.id, "paid", { note: b.note }, actor);
      await q("UPDATE leads SET status = 'active' WHERE tenant_id = $1 AND status = 'awaiting_payment'", [tenantId]);
      break;
    case "cancel":
      await q("UPDATE subscriptions SET status = 'canceled', ended_at = now() WHERE id = $1", [s.id]);
      await logEvent(q, tenantId, s.id, "canceled", { note: b.note }, actor);
      break;
    case "set_addons": {
      const addons = (b.addons || []).map((a) => ({ key: a.key, until: a.until || null, price: a.price ?? 0, note: a.note || null }));
      const valid = new Set((await q("SELECT key FROM features WHERE key = ANY($1)", [addons.map((a) => a.key)])).map((r) => r.key));
      const clean = addons.filter((a) => valid.has(a.key));
      const before = new Set((s.addons || []).map((a) => a.key));
      await q("UPDATE subscriptions SET addons = $2 WHERE id = $1", [s.id, JSON.stringify(clean)]);
      for (const a of clean) if (!before.has(a.key)) await logEvent(q, tenantId, s.id, "addon_added", a, actor);
      for (const k of before) if (!clean.some((a) => a.key === k)) await logEvent(q, tenantId, s.id, "addon_removed", { key: k }, actor);
      break;
    }
    case "renew": {
      // تجديد بنفس الباقة واللقطة: فترة جديدة تبدأ بعد نهاية الحالية (أو من اليوم إن انتهت)
      const start = s.ends_on && iso(s.ends_on) >= today() ? addDays(iso(s.ends_on), 1) : today();
      const months = b.months || (s.billing_cycle === "monthly" ? 1 : 12);
      return activate(q, tenantId, {
        kind: s.kind === "trial" ? "paid" : s.kind, plan_id: undefined, features: s.snapshot.features, plan_name: s.plan_name,
        billing_cycle: s.billing_cycle === "none" ? "yearly" : s.billing_cycle, starts_on: start, months, price: s.price,
        discount: Number(s.discount), addons: s.addons || [], max_students: s.max_students, max_teachers: s.max_teachers,
        status: "active", grace_days: s.grace_days, note: b.note,
      }, actor, { event: "renewed", plan_id: s.plan_id });
    }
    default: throw badRequest("إجراء غير معروف");
  }
  const [fresh] = await q("SELECT * FROM subscriptions WHERE id = $1", [s.id]);
  await syncTenant(q, tenantId, fresh);
  return fresh;
}

/* ======================= تطبيق تعديل الباقة ======================= */
// الافتراضي: الاشتراكات الجديدة فقط. «الحالية» تحدّث لقطة كل اشتراك فعّال على هذه الباقة.
export async function applyPlanChange(q, planId, scope, tenantId, actor) {
  if (scope === "new") return 0;
  const { snapshot } = await planSnapshot(q, planId);
  const params = [planId];
  let where = "s.plan_id = $1 AND s.status IN ('trial', 'active', 'pending_payment') AND t.subscription_id = s.id";
  if (scope === "tenant") { params.push(tenantId); where += " AND s.tenant_id = $2"; }
  const rows = await q(`SELECT s.* FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE ${where}`, params);
  for (const s of rows) {
    const snap = { ...snapshot, limits: { ...snapshot.limits } };
    await q("UPDATE subscriptions SET snapshot = $2, max_students = $3, max_teachers = $4 WHERE id = $1",
      [s.id, snap, snap.limits.max_students, snap.limits.max_teachers]);
    await q("UPDATE tenants SET max_students = COALESCE($2, 100000) WHERE id = $1", [s.tenant_id, snap.limits.max_students]);
    await logEvent(q, s.tenant_id, s.id, "plan_updated", { features: snap.features.length }, actor);
  }
  return rows.length;
}

export { today, addDays, addMonths, iso };

// ملخص حالة الاشتراك لواجهات المدرسة (بدون أسعار أو ملاحظات المالك)
export function accessSummary(req) {
  const a = req.access || {};
  return { state: a.state, locked: Boolean(a.locked), status: a.status, kind: a.kind, plan_name: a.plan_name,
    ends_on: a.ends_on, days_left: a.days_left, grace_left: a.grace_left ?? null, message: a.locked ? (LOCK_MESSAGE[a.status] || LOCK_MESSAGE.ended) : null };
}

// فحص الانتهاء: التجارب والاشتراكات المنتهية تتحول حالتها فقط (بلا حذف)، وتُسجَّل تنبيهات قرب الانتهاء
export const runExpiry = (q) => q("SELECT * FROM expire_subscriptions()");

// أسماء حالات وأنواع طلبات التجديد في النسخة السابقة (للتوافق مع الواجهات القديمة)
export const toOld = (s) => ({ reviewing: "contacted", active: "done", approved: "contacted", awaiting_payment: "contacted" }[s] || s);
export const kindOld = (k) => ({ renewal: "renew", upgrade: "upgrade" }[k] || "support");
