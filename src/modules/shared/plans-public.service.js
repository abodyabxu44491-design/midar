// الباقات كما تظهر للزائر وللمدرسة: من قاعدة البيانات مباشرة (لا أسعار ولا مميزات ثابتة في الكود)
import { transaction } from "../../core/db/pool.js";

const today = () => new Date().toISOString().slice(0, 10);

const iso = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

// هل الخصم ساري اليوم؟ (بلا تواريخ = دائم حتى يلغيه المالك)
export function discountActive(p, now = today()) {
  if (!p.discount_kind || p.discount_kind === "none") return false;
  if (p.discount_starts_at && iso(p.discount_starts_at) > now) return false;
  if (p.discount_ends_at && iso(p.discount_ends_at) < now) return false;
  return true;
}

/**
 * السعر الفعلي لمدة (شهري/سنوي) — مصدر واحد للسعر في كل المنصة.
 * يعيد { base, final, percent, promo, ends } أو null إن لم تكن المدة متاحة.
 */
export function displayPrice(p, cycle, now = today()) {
  const base = p[`${cycle}_price`];
  if (base == null) return null;
  const b = Number(base);
  let final = b;
  const active = discountActive(p, now);
  if (active) {
    const v = Number(p.discount_value || 0);
    if (p.discount_kind === "percent") final = b * (100 - v) / 100;
    else if (p.discount_kind === "amount") final = Math.max(0, b - v);
    else if (p.discount_kind === "price" && p[`sale_${cycle}_price`] != null) final = Math.min(b, Number(p[`sale_${cycle}_price`]));
  }
  final = Math.round(final * 100) / 100;
  const promo = active && final < b;
  return { base: b, final, percent: promo && b > 0 ? Math.round((1 - final / b) * 100) : 0, promo, ends: promo ? iso(p.discount_ends_at) : null };
}

export async function publicPlans() {
  return transaction({}, async (q) => {
    const [s] = await q("SELECT trial_enabled, trial_all_plans, trial_days FROM platform_settings WHERE id");
    const plans = await q("SELECT * FROM plans WHERE status = 'active' AND is_public ORDER BY sort, id");
    const feats = await q(
      `SELECT pf.plan_id, f.key, f.name, f.category, f.kind FROM plan_features pf JOIN features f ON f.key = pf.feature_key
        WHERE f.is_active ORDER BY pf.sort, f.sort`);
    return plans.map((p) => ({
      id: p.id, code: p.code, name: p.name, tagline: p.tagline, description: p.description, badge: p.badge,
      highlight: p.highlight, currency: p.currency, contact_only: p.contact_only, setup_fee: Number(p.setup_fee),
      monthly: displayPrice(p, "monthly"), yearly: displayPrice(p, "yearly"),
      // نص العرض اختياري (لا يلزم ذكر سبب الخصم)، وتاريخ انتهاء العرض إن حدده المالك
      promo_label: discountActive(p) ? p.promo_label || null : null,
      promo_ends_at: discountActive(p) ? iso(p.discount_ends_at) : null,
      max_students: p.max_students, max_teachers: p.max_teachers,
      trial: s.trial_enabled && (s.trial_all_plans || p.trial_enabled), trial_days: s.trial_days,
      features: feats.filter((f) => f.plan_id === p.id).map(({ key, name, category, kind }) => ({ key, name, category, kind })),
    }));
  });
}

// كل ما تحتاجه الصفحة العامة في طلب واحد
export async function siteData() {
  const [s] = await transaction({}, (q) => q(
    `SELECT landing_mode, brand_phone, brand_email, support_whatsapp, trial_enabled, trial_days, trial_without_plan,
            site_headline, site_subheadline FROM platform_settings WHERE id`));
  if (s.landing_mode !== "marketing") return { landing_mode: s.landing_mode };
  const features = await transaction({}, (q) => q(
    `SELECT key, name, description, category, kind, requestable FROM features WHERE is_active ORDER BY sort, key`));
  return { ...s, plans: await publicPlans(), features };
}
