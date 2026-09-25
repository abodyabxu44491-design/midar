// إعدادات المدرسة
import { Router } from "express";
import { inTenant, transaction } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { newDirectoryCode } from "../../core/auth/codes.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as payments from "../shared/payments.service.js";
import { getSettings, updateSettings, settingsSchema } from "../shared/public-settings.service.js";
import { getModules, updateModules, modulesSchema } from "../shared/modules.service.js";

const r = Router();

// رمز جديد لصفحة الطلاب (القديم يتوقف فورًا)
r.post("/directory-code", handle(async (req, res) => {
  const code = newDirectoryCode();
  await inTenant(req, (q) => q("UPDATE tenants SET directory_code = $1 WHERE id = app_tenant()", [code]));
  res.json({ directory_code: code });
}));

// إنهاء كل جلسات المدرسة (عند الاشتباه بتسريب)
r.post("/sign-out-all", handle(async (req, res) => {
  await inTenant(req, (q) => q("DELETE FROM sessions WHERE tenant_id = app_tenant() AND user_id <> $1", [req.user.id]));
  res.json({ ok: true });
}));

/* ---------- الاشتراك والدعم ---------- */
const renewalSchema = z.object({
  kind: z.enum(["renew", "upgrade", "support"]).default("renew"),
  months: z.coerce.number().int().min(1).max(36).optional(),
  students_wanted: z.coerce.number().int().min(1).max(100000).optional(),
  contact_name: t.optText(120),
  contact_phone: t.optText(25),
  note: t.optText(1000),
});

r.get("/subscription", handle(async (req, res) => {
  const data = await inTenant(req, async (q) => {
    const [tn] = await q(
      `SELECT t.name, t.plan, t.max_students, t.subscription_end, t.subscription_price, t.grace_days, t.status, t.currency,
              (SELECT count(*) FROM students WHERE status = 'active')::int AS students,
              (t.subscription_end - CURRENT_DATE)::int AS days_left
         FROM tenants t WHERE t.id = app_tenant()`);
    const requests = await q(
      `SELECT id, kind, months, students_wanted, note, status, owner_note, created_at
         FROM renewal_requests ORDER BY id DESC LIMIT 20`);
    return { subscription: tn, requests };
  });
  const [platform] = await transaction({}, (q) =>
    q("SELECT support_whatsapp, support_note, brand_email FROM platform_settings WHERE id"));
  res.json({ ...data, support: platform });
}));

r.post("/subscription/renew", handle(async (req, res) => {
  const b = parse(renewalSchema, req.body);
  const row = await inTenant(req, async (q) => {
    const [open] = await q("SELECT id FROM renewal_requests WHERE status = 'new' AND kind = $1", [b.kind]);
    if (open) throw badRequest("لديك طلب سابق بانتظار الرد. سنتواصل معك قريبًا.");
    const [created] = await q(
      `INSERT INTO renewal_requests (tenant_id, kind, months, students_wanted, note, contact_name, contact_phone, requested_by)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id, kind, status, created_at`,
      [b.kind, b.months ?? null, b.students_wanted ?? null, b.note ?? null,
       b.contact_name ?? null, b.contact_phone ?? null, req.actor]);
    return created;
  });
  res.status(201).json(row);
}));

/* ---------- أقسام المنصة ---------- */
r.get("/modules", handle(async (req, res) => {
  res.json(await inTenant(req, getModules));
}));

r.put("/modules", handle(async (req, res) => {
  const b = parse(modulesSchema, req.body);
  res.json(await inTenant(req, (q) => updateModules(q, b)));
}));

/* ---------- عملة المدرسة ---------- */
r.get("/currency", handle(async (req, res) => {
  const [row] = await inTenant(req, (q) => q("SELECT currency FROM tenants WHERE id = app_tenant()"));
  res.json(row);
}));

r.put("/currency", handle(async (req, res) => {
  const { currency } = parse(z.object({ currency: z.enum(["SAR", "YER", "USD"]) }), req.body);
  await inTenant(req, async (q) => {
    const [used] = await q("SELECT 1 FROM finance_entries LIMIT 1");
    if (used) throw badRequest("لا يمكن تغيير عملة المدرسة بعد تسجيل حركات مالية. أنشئ حسابًا بعملة أخرى بدلًا من ذلك.");
    await q("UPDATE tenants SET currency = $1 WHERE id = app_tenant()", [currency]);
    await q("UPDATE finance_accounts SET currency = $1", [currency]);
  });
  res.json({ ok: true });
}));

/* ---------- إعدادات الصفحة العامة ---------- */
r.get("/public-page", handle(async (req, res) => {
  res.json(await inTenant(req, getSettings));
}));

r.put("/public-page", handle(async (req, res) => {
  const b = parse(settingsSchema, req.body);
  res.json(await inTenant(req, (q) => updateSettings(q, b)));
}));

/* ---------- طرق السداد ---------- */
r.get("/payment", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const [tn] = await q("SELECT payment_note FROM tenants WHERE id = app_tenant()");
    return { payment_note: tn.payment_note, accounts: await payments.listAccounts(q) };
  }));
}));

r.put("/payment/note", handle(async (req, res) => {
  const b = parse(payments.noteSchema, req.body);
  await inTenant(req, (q) => q("UPDATE tenants SET payment_note = $1 WHERE id = app_tenant()", [b.payment_note ?? null]));
  res.json({ ok: true });
}));

r.post("/payment/accounts", handle(async (req, res) => {
  const b = parse(payments.accountSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => payments.addAccount(q, b)));
}));

r.patch("/payment/accounts/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  await inTenant(req, (q) => payments.setAccountActive(q, id, active));
  res.json({ ok: true });
}));

export default r;
