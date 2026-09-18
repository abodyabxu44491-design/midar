// إعدادات المدرسة
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { newDirectoryCode } from "../../core/auth/codes.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as payments from "../shared/payments.service.js";
import { getSettings, updateSettings, settingsSchema } from "../shared/public-settings.service.js";

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
