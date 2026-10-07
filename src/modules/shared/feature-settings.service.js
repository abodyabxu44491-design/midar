// إعدادات الأقسام الجديدة: كل قسم له إعدادات قليلة بقيم افتراضية مناسبة، تعدّلها المدرسة من «الإعدادات»
import { z, parse } from "../../core/http/validate.js";
import { badRequest } from "../../core/http/errors.js";

const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "الوقت بصيغة 07:30");
const pct = z.coerce.number().min(0).max(100);

export const SECTIONS = {
  behavior: {
    defaults: { base_score: 100, show_parent: true, teacher_can_record: true, warn_below: 80 },
    schema: z.object({ base_score: z.coerce.number().int().min(0).max(1000), show_parent: z.boolean(),
      teacher_can_record: z.boolean(), warn_below: z.coerce.number().int().min(0).max(1000) }),
  },
  staff: {
    defaults: { work_start: "07:00", work_end: "13:00", late_after_min: 15, self_checkin: true, deduct_absence: true, working_days: 26 },
    schema: z.object({ work_start: time, work_end: time, late_after_min: z.coerce.number().int().min(0).max(180),
      self_checkin: z.boolean(), deduct_absence: z.boolean(), working_days: z.coerce.number().int().min(20).max(31) }),
  },
  fees: {
    defaults: { sibling_discount: false, sibling_second_pct: 10, sibling_third_pct: 15, reminder_days: 3 },
    schema: z.object({ sibling_discount: z.boolean(), sibling_second_pct: pct, sibling_third_pct: pct,
      reminder_days: z.coerce.number().int().min(0).max(30) }),
  },
  certificates: {
    defaults: { pass_mark: 50, signer_title: "مدير المدرسة", signer_name: "", show_rank: false, footer_note: "" },
    schema: z.object({ pass_mark: pct, signer_title: z.string().trim().max(60), signer_name: z.string().trim().max(80),
      show_rank: z.boolean(), footer_note: z.string().trim().max(200) }),
  },
  library: {
    defaults: { loan_days: 14, max_loans: 2 },
    schema: z.object({ loan_days: z.coerce.number().int().min(1).max(120), max_loans: z.coerce.number().int().min(1).max(20) }),
  },
  meetings: {
    defaults: { slot_minutes: 15, allow_parent_cancel: true },
    schema: z.object({ slot_minutes: z.coerce.number().int().min(5).max(120), allow_parent_cancel: z.boolean() }),
  },
  clinic: {
    defaults: { notify_parent: true, show_parent_profile: true },
    schema: z.object({ notify_parent: z.boolean(), show_parent_profile: z.boolean() }),
  },
  // بوابة الحضور الذكية (docs/SMART_GATE.md): نافذة الحضور، ووقت إشعار الغياب بعد اعتماده، والإشعارات
  gate: {
    defaults: { open_at: "06:30", late_after: "07:15", close_at: "08:00", absence_notify_at: "09:00", auto_finalize: false,
      notify_present: true, notify_late: true, notify_absent: true, legacy_cards: false, suspicious_seconds: 120 },
    schema: z.object({ open_at: time, late_after: time, close_at: time, absence_notify_at: time, auto_finalize: z.boolean(),
      notify_present: z.boolean(), notify_late: z.boolean(), notify_absent: z.boolean(), legacy_cards: z.boolean(),
      suspicious_seconds: z.coerce.number().int().min(10).max(3600) }),
    check: (v) => (v.open_at <= v.late_after && v.late_after < v.close_at ? null : "الأوقات: بداية الحضور ≤ وقت التأخر < الإغلاق"),
  },
  transport: {
    defaults: { notify_parent: true },
    schema: z.object({ notify_parent: z.boolean() }),
  },
};

const cache = new WeakMap();
export async function getFeatureSettings(q) {
  if (cache.has(q)) return cache.get(q);
  const [row] = await q("SELECT settings FROM school_feature_settings WHERE tenant_id = app_tenant()");
  const saved = row?.settings || {};
  const out = Object.fromEntries(Object.entries(SECTIONS).map(([k, s]) => [k, { ...s.defaults, ...(saved[k] || {}) }]));
  cache.set(q, out);
  return out;
}
export const featureSettings = async (q, section) => (await getFeatureSettings(q))[section];

export async function updateFeatureSettings(q, section, patch) {
  const def = SECTIONS[section];
  if (!def) throw badRequest("قسم إعدادات غير معروف");
  const clean = parse(def.schema.partial(), patch);
  const all = await getFeatureSettings(q);
  const next = { ...all[section], ...clean };
  const err = def.check?.(next);
  if (err) throw badRequest(err);
  all[section] = next;
  await q(`INSERT INTO school_feature_settings (tenant_id, settings) VALUES (app_tenant(), $1)
           ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings`, [JSON.stringify(all)]);
  cache.set(q, all);
  return all[section];
}
