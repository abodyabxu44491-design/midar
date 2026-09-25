// إعدادات المنصة: شكل الصفحة الرئيسية وبيانات التواصل
import { Router } from "express";
import { env } from "../../config/env.js";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const schema = z.object({
  landing_mode: z.enum(["blank", "marketing"]).optional(),
  brand_phone: z.string().trim().regex(/^[0-9+ ]{0,20}$/).optional().or(z.literal("")).transform((v) => v || null),
  brand_email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  support_whatsapp: z.string().trim().regex(/^[0-9+]{0,20}$/, "رقم غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  support_note: z.string().trim().max(300).optional().or(z.literal("")).transform((v) => v || null),
  // التجربة المجانية والاشتراكات
  trial_enabled: z.boolean().optional(),
  trial_days: z.coerce.number().int().min(1).max(365).optional(),
  trial_all_plans: z.boolean().optional(),
  trial_without_plan: z.boolean().optional(),
  trials_per_school: z.coerce.number().int().min(1).max(10).optional(),
  trial_reminder_days: z.array(z.coerce.number().int().min(0).max(60)).max(6).optional(),
  trial_grace_days: z.coerce.number().int().min(0).max(30).optional(),
  trial_owner_extend: z.boolean().optional(),
  show_plans_after_expiry: z.boolean().optional(),
  default_grace_days: z.coerce.number().int().min(0).max(60).optional(),
  feature_request_mode: z.enum(["request", "upgrade", "hidden"]).optional(),
  site_headline: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => v || null),
  site_subheadline: z.string().trim().max(300).optional().or(z.literal("")).transform((v) => v || null),
});
const COLS = ["landing_mode", "brand_phone", "brand_email", "support_whatsapp", "support_note", "trial_enabled", "trial_days",
  "trial_all_plans", "trial_without_plan", "trials_per_school", "trial_reminder_days", "trial_grace_days", "trial_owner_extend",
  "show_plans_after_expiry", "default_grace_days", "feature_request_mode", "site_headline", "site_subheadline"];

r.get("/", handle(async (req, res) => {
  const [row] = await transaction({ platform: true, actor: req.actor }, (q) =>
    q(`SELECT ${COLS.join(", ")} FROM platform_settings WHERE id`));
  res.json(row);
}));

r.put("/", handle(async (req, res) => {
  const b = parse(schema, req.body);
  const [row] = await transaction({ platform: true, actor: req.actor, ip: req.ip }, async (q) => {
    const keys = COLS.filter((k) => b[k] !== undefined);
    if (keys.length) {
      if (b.trial_reminder_days) b.trial_reminder_days = [...new Set(b.trial_reminder_days)].sort((x, y) => y - x);
      await q(`UPDATE platform_settings SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id`, keys.map((k) => b[k]));
    }
    return q(`SELECT ${COLS.join(", ")} FROM platform_settings WHERE id`);
  });
  res.json(row);
}));

/* ---------- فحص بيئة التشغيل ----------
   ما يراه الخادم فعليًا: عنوان الزائر المكتشف وسلسلة الوكلاء، وإعدادات الوكيل والكوكي والرابط، وسرعة قاعدة البيانات.
   يُستخدم للتحقق بعد النشر (مثلًا على Render): إن ظهر عنوان الزائر عنوانَ الوكيل، فالثقة بالوكيل غير مضبوطة. */
r.get("/diagnostics", handle(async (req, res) => {
  const t0 = Date.now();
  const [db] = await transaction({ platform: true }, (q) => q("SELECT now() AS now, version() AS version, current_setting('server_version') AS server_version"));
  const dbMs = Date.now() - t0;
  const xff = String(req.get("x-forwarded-for") || "");
  const chain = xff.split(",").map((x) => x.trim()).filter(Boolean);
  const checks = [];
  const add = (ok, text, fix) => checks.push({ ok, text, fix: ok ? null : fix });
  add(env.TRUST_PROXY > 0 || !chain.length, "الثقة بالوكيل مضبوطة (عنوان كل زائر يُكتشف منفصلًا)",
    "ضع TRUST_PROXY=1 في متغيرات البيئة على Render ثم أعد النشر");
  add(!chain.length || req.ip === chain[0] || chain.length > env.TRUST_PROXY, "العنوان المكتشف هو عنوان الزائر الحقيقي",
    `عدد الوكلاء في السلسلة ${chain.length}. جرّب TRUST_PROXY=${chain.length}`);
  add(Boolean(env.PUBLIC_URL), "رابط المنصة PUBLIC_URL محدد", "ضع PUBLIC_URL (مثل https://midar.onrender.com أو نطاقك)");
  add(!env.PUBLIC_URL || env.PUBLIC_URL.replace(/\/$/, "") === `${req.protocol}://${req.get("host")}`,
    "الرابط المحدد يطابق النطاق الذي فُتحت منه اللوحة", "إن كان للمنصة أكثر من نطاق أضف الباقي في ALLOWED_ORIGINS مفصولة بفواصل");
  add(env.COOKIE_SECURE === (req.protocol === "https"), "أمان الكوكي يطابق الاتصال (HTTPS)", "على Render: COOKIE_SECURE=true");
  add(dbMs < 1500, `قاعدة البيانات تستجيب (${dbMs} مللي ثانية)`, "قاعدة البيانات بطيئة: تأكد أن منطقة Neon قريبة من منطقة Render (فرانكفورت)");
  res.json({
    ip: req.ip, forwarded_for: chain, protocol: req.protocol, host: req.get("host"), trust_proxy: env.TRUST_PROXY,
    public_url: env.PUBLIC_URL || null, cookie_secure: env.COOKIE_SECURE, session_cookie_mode: env.SESSION_COOKIE_MODE || "separate",
    node_env: env.NODE_ENV, db: { ms: dbMs, server_version: db.server_version }, checks,
  });
}));

export default r;
