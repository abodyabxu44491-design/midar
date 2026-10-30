/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { publicTypes } from "./org-types.service.js";
import { transaction } from "../../core/db/pool.js";
import { demoSchool } from "./demo.service.js";

const today = () => new Date().toISOString().slice(0, 10);

const iso = (d) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

export function discountActive(p, now = today()) {
  if (!p.discount_kind || p.discount_kind === "none") return false;
  if (p.discount_starts_at && iso(p.discount_starts_at) > now) return false;
  if (p.discount_ends_at && iso(p.discount_ends_at) < now) return false;
  return true;
}

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
      promo_label: discountActive(p) ? p.promo_label || null : null,
      promo_ends_at: discountActive(p) ? iso(p.discount_ends_at) : null,
      max_students: p.max_students, max_teachers: p.max_teachers, audience: p.audience || null,
      first_year: p.first_year_price != null && p.yearly_price != null && Number(p.first_year_price) < Number(p.yearly_price)
        ? { price: Number(p.first_year_price), renewal: Number(p.yearly_price) } : null,
      max_schools: p.max_schools, extra_school_price: p.extra_school_price != null ? Number(p.extra_school_price) : null,
      trial: s.trial_enabled && (s.trial_all_plans || p.trial_enabled), trial_days: s.trial_days,
      features: feats.filter((f) => f.plan_id === p.id).map(({ key, name, category, kind }) => ({ key, name, category, kind })),
    }));
  });
}

// The public site's data changes only when the owner edits it, but each visit (bots included) would wake the
// database: it is kept in memory for a few minutes, and dropped at once after any change in the owner panel.
let siteCache = null;
export const clearSiteCache = () => { siteCache = null; };
export async function siteData() {
  if (siteCache && siteCache.until > Date.now()) return siteCache.data;
  const data = await loadSiteData();
  siteCache = { data, until: Date.now() + 5 * 60_000 };
  return data;
}
async function loadSiteData() {
  const [s] = await transaction({}, (q) => q(
    `SELECT landing_mode, brand_phone, brand_email, brand_instagram, support_whatsapp, trial_enabled, trial_days, trial_without_plan,
            site_headline, site_subheadline FROM platform_settings WHERE id`));
  if (s.landing_mode !== "marketing") return { landing_mode: s.landing_mode, brand_email: s.brand_email, brand_phone: s.brand_phone, brand_instagram: s.brand_instagram, support_whatsapp: s.support_whatsapp };
  const features = await transaction({}, (q) => q(
    `SELECT key, name, description, category, kind, requestable FROM features WHERE is_active ORDER BY sort, key`));
  const testimonials = await transaction({}, (q) => q(
    `SELECT id, school_name, author_name, author_title, body, rating, logo FROM testimonials
      WHERE status = 'approved' AND consent ORDER BY sort, id LIMIT 12`));
  const org_types = await transaction({}, publicTypes);
  return { ...s, plans: await publicPlans(), features, testimonials, org_types, demo: Boolean(await demoSchool()) };
}
