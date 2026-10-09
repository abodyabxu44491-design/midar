// طلب تجربة المنصة من الصفحة التسويقية (يصل إلى لوحة المالك)
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { conflict } from "../../core/http/errors.js";
import { newDirectoryCode } from "../../core/auth/codes.js";
import { isSchoolCode } from "../../core/reserved.js";
import { schoolLinks } from "../../core/links.js";
import { publicPlans } from "../shared/plans-public.service.js";
import { createTenant } from "../owner/tenants.js";

const r = Router();
const leadSchema = z.object({
  school_name: t.shortText("اسم المدرسة", 150),
  contact_name: t.name("اسم المسؤول"),
  phone: z.string().trim().regex(/^[0-9+ ]{6,20}$/, "رقم الجوال غير صحيح"),
  email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  city: t.optText(60),
  students_count: z.union([z.coerce.number().int().min(1).max(100000), z.literal(""), z.null()]).optional().transform((v) => v || null),
  note: t.optText(1000),
  kind: z.enum(["trial", "subscription", "contact"]).default("trial"),
  plan_id: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  // مدة الاشتراك: تقبل غيابها أو قيمة فارغة أو null (التجربة والتواصل ليس فيهما مدة)،
  // وتُحسم بعد التحقق حسب نوع الطلب (انظر normalize أدناه) — لا تُرفض ولا تُخمَّن
  billing_cycle: z.union([z.enum(["monthly", "yearly"]), z.literal(""), z.null()]).optional(),
  months: z.union([z.coerce.number().int().min(1).max(36), z.literal(""), z.null()]).optional().transform((v) => v || null),
  try_plan: z.boolean().nullable().optional().transform((v) => v ?? true),
  addon_keys: z.array(z.string().max(40)).max(30).nullable().optional().transform((v) => v ?? []),
});

// توحيد القيم حسب نوع الطلب (نفس القيم المسموحة في قاعدة البيانات):
//   اشتراك: المدة شهري أو سنوي، والافتراضي سنوي إن لم يُختر شيء
//   تجربة/تواصل: لا مدة ولا عدد أشهر ولا إضافات (مجانية أو استفسار)
function normalize(b) {
  if (b.kind === "subscription") return { ...b, billing_cycle: b.billing_cycle || "yearly" };
  return { ...b, billing_cycle: null, months: null, addon_keys: b.kind === "contact" ? [] : b.addon_keys,
    plan_id: b.kind === "contact" ? null : b.plan_id };
}

r.post("/", limits.login, handle(async (req, res) => {
  const b = normalize(parse(leadSchema, req.body));
  await transaction({ actor: "زائر", ip: req.ip }, (q) => q("SELECT submit_lead($1::jsonb)", [JSON.stringify(b)]));
  res.status(201).json({ ok: true });
}));

/* ---------- التسجيل الذاتي الفوري ----------
   إن فعّله المالك: تُنشأ المدرسة وحساب مديرها وتجربتها فورًا، وتظهر بيانات الدخول للزائر مباشرة.
   الحماية: حد الطلبات العامة لكل عنوان، ومدرستان كحد أقصى لكل عنوان في اليوم، ورقم الجوال لا يسجّل مدرسة ثانية،
   وحد يومي للمنصة كلها؛ عند تجاوزه يتحول الطلب تلقائيًا إلى طلب تجربة عادي يراجعه المالك. */
const signupSchema = leadSchema.pick({ school_name: true, contact_name: true, phone: true, email: true, city: true, students_count: true, plan_id: true, note: true });
const digits = (v) => String(v || "").replace(/\D/g, "");
const phoneKey = (v) => digits(v).slice(-9);   // آخر 9 أرقام: نفس الرقم بمفتاح الدولة أو بدونه أو بالصفر
// عملة المدرسة من رقم الجوال: يمني (967 أو 7XXXXXXXX) ريال يمني، سعودي (966 أو 05) ريال سعودي، وغيرهما دولار
function currencyOf(phone) {
  const d = digits(phone);
  if (d.startsWith("967") || /^7\d{8}$/.test(d)) return "YER";
  if (d.startsWith("966") || /^0?5\d{8}$/.test(d)) return "SAR";
  return "USD";
}
async function freeCode(q) {
  for (let i = 0; i < 8; i++) {
    const code = `m${newDirectoryCode().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
    if (!isSchoolCode(code)) continue;
    const [taken] = await q("SELECT 1 FROM tenants WHERE id = $1", [code]);
    if (!taken) return code;
  }
  throw conflict("تعذر تجهيز رابط المدرسة، حاول مرة أخرى");
}

r.post("/signup", limits.login, handle(async (req, res) => {
  const b = parse(signupSchema, req.body);
  const ctx = { actor: "تسجيل ذاتي", ip: req.ip, platform: true };
  const { leadId, instant, code } = await transaction(ctx, async (q) => {
    const [s] = await q("SELECT trial_enabled, instant_trial, instant_trial_daily_cap FROM platform_settings WHERE id");
    if (!s.trial_enabled) throw conflict("التجربة المجانية غير متاحة حاليًا");
    const key = phoneKey(b.phone);
    if (key.length < 8) throw conflict("رقم الجوال غير صحيح");
    // رقم سجّل مدرسة من قبل: لا مدرسة ثانية تلقائيًا (يتواصل معنا)
    const [dup] = await q(`SELECT 1 FROM leads WHERE tenant_id IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = $1 LIMIT 1`, [key]);
    if (dup) throw conflict("سبق تسجيل مدرسة بهذا الرقم. ادخل بحساب مدرستك، أو تواصل معنا إن احتجت تجربة جديدة.");
    const [{ today, ip_today }] = await q(`SELECT count(*) FILTER (WHERE instant)::int AS today,
        count(*) FILTER (WHERE instant AND ip = NULLIF(current_setting('app.ip', true), '')::inet)::int AS ip_today
       FROM leads WHERE created_at > now() - interval '1 day'`);
    const id = (await q("SELECT submit_lead($1::jsonb) AS id", [JSON.stringify({ ...b, kind: "trial", try_plan: true })]))[0].id;
    const go = s.instant_trial && today < s.instant_trial_daily_cap && ip_today < 2;
    if (go) await q("UPDATE leads SET instant = true WHERE id = $1", [id]);
    return { leadId: id, instant: go, code: go ? await freeCode(q) : null };
  });
  // التفعيل الفوري متوقف أو بلغ حده: يبقى طلبًا عاديًا يراجعه المالك
  if (!instant) return res.status(201).json({ ok: true, queued: true });

  // الباقة: المختارة إن كانت تتيح التجربة، وإلا الأكثر طلبًا، وإلا أول باقة فيها تجربة، وإلا كل المميزات
  const plans = (await publicPlans()).filter((p) => p.trial);
  const plan = plans.find((p) => p.id === b.plan_id) || plans.find((p) => p.highlight) || plans[0] || null;
  const created = await createTenant({ actor: "تسجيل ذاتي", ip: req.ip }, {
    id: code, name: b.school_name, admin_name: b.contact_name, currency: currencyOf(b.phone),
    max_students: plan?.max_students || 200,
    subscription: { kind: "trial", plan_id: plan?.id ?? null, plan_name: plan ? undefined : "تجربة كاملة", lead_id: leadId,
      billing_cycle: "none", discount: 0, addons: [], status: "active", force_trial: false },
  });
  const [sub] = await transaction({ tenantId: code, platform: true }, (q) =>
    q("SELECT s.ends_on, s.plan_name FROM subscriptions s JOIN tenants t ON t.subscription_id = s.id WHERE t.id = $1", [code]));
  res.status(201).json({ ok: true, ...created, trial: { ends_on: sub?.ends_on, plan: sub?.plan_name }, links: schoolLinks(req, code) });
}));

export default r;
