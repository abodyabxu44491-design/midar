// الباقات كما تظهر للزائر وللمدرسة: من قاعدة البيانات مباشرة (لا أسعار ولا مميزات ثابتة في الكود)
import { transaction } from "../../core/db/pool.js";

const today = () => new Date().toISOString().slice(0, 10);

// السعر بعد الخصم العام أو العرض المؤقت الساري (الأكبر منهما)
export function displayPrice(p, cycle) {
  const base = p[`${cycle}_price`];
  if (base == null) return null;
  const promo = p.promo_percent && p.promo_ends_at && String(p.promo_ends_at).slice(0, 10) >= today() ? Number(p.promo_percent) : 0;
  const pct = Math.max(promo, Number(p.discount_percent || 0));
  return { base: Number(base), final: Math.round(Number(base) * (100 - pct)) / 100, percent: pct, promo: promo > 0 && promo >= Number(p.discount_percent || 0) };
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
      promo_label: p.promo_percent && String(p.promo_ends_at).slice(0, 10) >= today() ? p.promo_label : null,
      promo_ends_at: p.promo_percent && String(p.promo_ends_at).slice(0, 10) >= today() ? p.promo_ends_at : null,
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
