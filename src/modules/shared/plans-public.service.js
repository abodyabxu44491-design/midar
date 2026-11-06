/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { KINDS } from "./trust.service.js";
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
// The public site's data changes only when the owner edits it, and every change clears the cache (owner/index.js), so
// it is kept for hours: visitors and search engines then never wake the database. On Workers each instance has its
// own memory, so the data is shared through KV (the platform's `cache` hook) and each instance keeps it only a minute,
// which is how soon an owner's change reaches every instance.
const SITE_TTL = 6 * 60 * 60_000;
const shared = () => globalThis.__midarPlatform?.cache;
let siteCache = null;
export const clearSiteCache = () => { siteCache = null; shared()?.del("site-data"); };
export async function siteData() {
  if (siteCache && siteCache.until > Date.now()) return siteCache.data;
  const cache = shared();
  const kept = cache ? await cache.get("site-data").catch(() => null) : null;
  if (kept) { siteCache = { data: kept, until: Date.now() + 60_000 }; return kept; }
  const data = await loadSiteData();
  siteCache = { data, until: Date.now() + (cache ? 60_000 : SITE_TTL) };
  cache?.put("site-data", data, SITE_TTL);
  return data;
}
async function loadSiteData() {
  const [s] = await transaction({}, (q) => q(
    `SELECT landing_mode, brand_phone, brand_email, brand_instagram, support_whatsapp, trial_enabled, trial_days, trial_without_plan,
            site_headline, site_subheadline, company_name, company_name_en, company_legal_name, company_reg_no, company_country,
            company_address, site_url, email_info, email_support, email_sales, email_admin, founded_year, social_links, about_summary,
            about_audience, services_upcoming FROM platform_settings WHERE id`));
  const company = companyOf(s);
  const official = officialOf(s);
  for (const k of Object.keys(s)) if (/^(company_|email_|about_|social_links|site_url|founded_year|services_upcoming)/.test(k)) delete s[k];
  if (s.landing_mode !== "marketing") return { landing_mode: s.landing_mode, brand_email: s.brand_email, brand_phone: s.brand_phone, brand_instagram: s.brand_instagram, support_whatsapp: s.support_whatsapp, company, official };
  const features = await transaction({}, (q) => q(
    `SELECT key, name, description, category, kind, requestable FROM features WHERE is_active ORDER BY sort, key`));
  // Platform scope only to see whether the linked school is a current customer (schools are isolated otherwise); the
  // query is fixed and returns public fields only, never the school's id.
  const testimonials = await transaction({ platform: true }, (q) => q(
    `SELECT t.id, t.school_name, t.author_name, t.author_title, t.body, t.rating, t.logo, t.service_used,
            to_char(COALESCE(t.consent_at, t.created_at::date), 'YYYY-MM') AS month,
            (t.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenants x WHERE x.id = t.tenant_id AND x.status = 'active')) AS subscriber
       FROM testimonials t WHERE t.status = 'approved' AND t.consent ORDER BY t.sort, t.id LIMIT 12`));
  // Only certifications that can be checked and are still valid.
  const accreditations = await transaction({}, (q) => q(
    `SELECT id, issuer, title, number, verify_url, scope, to_char(issued_on, 'YYYY-MM-DD') AS issued_on,
            to_char(expires_on, 'YYYY-MM-DD') AS expires_on
       FROM accreditations WHERE status = 'published' AND evidence_confirmed AND (verify_url IS NOT NULL OR number IS NOT NULL)
        AND (expires_on IS NULL OR expires_on >= CURRENT_DATE) ORDER BY sort, id`));
  const org_types = await transaction({}, publicTypes);
  // The internal badges that are active now (a passing, still-valid check), named as the trust center names them.
  const trust_badges = (await transaction({}, (q) => q("SELECT kind FROM trust_public_badges()")))
    .filter((b) => KINDS[b.kind]).map((b) => ({ kind: b.kind, title: KINDS[b.kind].title }));
  return { ...s, company, official, plans: await publicPlans(), features, testimonials, accreditations, org_types, trust_badges, demo: Boolean(await demoSchool()) };
}

// The official identity and contact details, only as the owner entered them: an address is shown once the owner has
// filled it in (after its mailbox or forwarding works), and nothing is assumed.
function officialOf(s) {
  const emails = Object.fromEntries(["info", "support", "sales", "admin"].map((k) => [k, s[`email_${k}`]]).filter(([, v]) => v));
  const social = { ...(s.social_links || {}) };
  if (s.brand_instagram) social.instagram = `https://instagram.com/${s.brand_instagram}`;
  const upcoming = String(s.services_upcoming || "").split("\n").map((x) => x.trim()).filter(Boolean);
  return { site_url: s.site_url || null, emails, social, founded_year: s.founded_year || null, summary: s.about_summary || null,
    audience: s.about_audience || null, upcoming };
}

// The company behind Midar, with only the fields the owner filled in (null when none is): nothing is shown or claimed
// about a legal entity or registration until it is entered.
function companyOf(s) {
  const c = { name: s.company_name, name_en: s.company_name_en, legal_name: s.company_legal_name, reg_no: s.company_reg_no,
    country: s.company_country, address: s.company_address };
  for (const k of Object.keys(c)) if (!c[k]) delete c[k];
  return Object.keys(c).length ? c : null;
}
