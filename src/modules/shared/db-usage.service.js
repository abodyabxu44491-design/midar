/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Database usage watch. On Neon's free plan the database stops once a monthly limit is used up (compute time,
// storage or data transfer), and the whole platform goes into maintenance. With a read-only API key the owner sees
// this month's usage against each limit and is warned on the phone at 70%, 85% and 95% (and when the month's pace
// would pass a limit before it ends), in time to act. Reading the usage asks Neon's API, not the database itself,
// so watching never keeps the database awake.
import { env } from "../../config/env.js";
import { transaction } from "../../core/db/pool.js";
import { raiseAlert } from "../../core/audit.js";

const API = "https://console.neon.tech/api/v2";
const GB = 1024 ** 3;
const STEPS = [95, 85, 70];
let fetcher = (url, opts) => fetch(url, opts);
export const setUsageFetch = (fn) => { fetcher = fn || ((url, opts) => fetch(url, opts)); cache = null; };

// The settings come from the environment; tests may replace them.
let override = null;
export const setUsageConfig = (o) => { override = o; cache = null; };
const conf = () => override || { key: env.NEON_API_KEY, project: env.NEON_PROJECT_ID,
  cuHours: env.NEON_CU_HOURS_LIMIT, storageGb: env.NEON_STORAGE_GB_LIMIT, transferGb: env.NEON_TRANSFER_GB_LIMIT };
export const usageConfigured = () => Boolean(conf().key && conf().project);

let cache = null;
// One request to Neon at most every 10 minutes (the numbers there update about as often).
export async function dbUsage({ fresh = false } = {}) {
  if (!usageConfigured()) return { configured: false };
  if (!fresh && cache && cache.until > Date.now()) return cache.data;
  let data;
  try {
    const res = await fetcher(`${API}/projects/${encodeURIComponent(conf().project)}`, {
      headers: { Authorization: `Bearer ${conf().key}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw Object.assign(new Error(res.status === 401 || res.status === 403 ? "مفتاح Neon غير صحيح أو لا يملك صلاحية القراءة" : res.status === 404 ? "رقم مشروع Neon غير صحيح" : `تعذّر الوصول إلى Neon (${res.status})`), { status: res.status });
    data = summarize((await res.json()).project || {});
  } catch (e) {
    data = { configured: true, ok: false, error: e.status ? e.message : "تعذّر الوصول إلى Neon الآن" };
  }
  cache = { data, until: Date.now() + 10 * 60_000 };
  return data;
}

function summarize(p) {
  const start = p.consumption_period_start ? new Date(p.consumption_period_start) : null;
  const end = p.consumption_period_end ? new Date(p.consumption_period_end) : null;
  const now = Date.now();
  // How far into the billing month we are, to project where the usage will be at its end.
  const elapsed = start && end && end > start ? Math.min(1, Math.max(0.02, (now - start) / (end - start))) : null;
  const item = (key, label, used, limit, unit) => {
    if (!Number.isFinite(used)) return null;
    const pct = Math.round((used / limit) * 1000) / 10;
    const projected = elapsed && key !== "storage" ? Math.round((pct / elapsed) * 10) / 10 : pct;
    return { key, label, used: Math.round(used * 100) / 100, limit, unit, pct, projected };
  };
  const items = [
    item("compute", "وقت تشغيل قاعدة البيانات", Number(p.compute_time_seconds) / 3600, conf().cuHours, "ساعة حوسبة"),
    item("storage", "حجم البيانات", Number(p.synthetic_storage_size) / GB, conf().storageGb, "جيجابايت"),
    item("transfer", "البيانات المنقولة", Number(p.data_transfer_bytes) / GB, conf().transferGb, "جيجابايت"),
  ].filter(Boolean);
  return { configured: true, ok: true, items, period_start: start?.toISOString() || null, period_end: end?.toISOString() || null,
    checked_at: new Date(now).toISOString() };
}

// Runs with the background jobs: one warning per limit and step per month, raised as a high alert, which reaches
// the owner's phone at once (and their email when OWNER_ALERT_EMAIL is set).
export async function checkDbUsage() {
  const u = await dbUsage();
  if (!u.ok) return [];
  const month = (u.period_start || new Date().toISOString()).slice(0, 7);
  const raised = [];
  for (const it of u.items) {
    const step = STEPS.find((s) => it.pct >= s);
    const pace = !step && it.projected >= 100 && it.pct >= 40;
    if (!step && !pace) continue;
    const kind = `db_usage:${it.key}:${month}:${step || "pace"}`;
    const fresh = await transaction({ platform: true, actor: "النظام" }, async (q) => {
      if ((await q("SELECT 1 FROM security_alerts WHERE kind = $1", [kind])).length) return false;
      const title = step ? `${it.label}: استُهلك ${it.pct}% من حد الخطة` : `${it.label}: الاستهلاك بهذه الوتيرة يتجاوز الحد قبل نهاية الشهر`;
      const detail = `${it.used} من ${it.limit} ${it.unit} (المتوقع آخر الشهر ${it.projected}%). عند بلوغ الحد تتوقف قاعدة البيانات وتدخل المنصة في الصيانة. راجع «الأمان ← استهلاك قاعدة البيانات» في لوحة المالك.`;
      await raiseAlert(q, { kind, severity: "high", title, detail });
      return true;
    });
    if (fresh) raised.push(kind);
  }
  return raised;
}
