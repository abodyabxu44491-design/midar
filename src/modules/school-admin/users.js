// حسابات المحاسبين وصلاحياتهم (يديرها مدير المدرسة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { clearLoginFailures } from "../../core/audit.js";

const r = Router();
const createSchema = z.object({
  name: t.name("اسم المحاسب"),
  username: t.username,
  can_approve_finance: z.boolean().default(false),
  can_manage_payroll: z.boolean().default(false),
  can_manage_accounts: z.boolean().default(false),
});
const permsSchema = z.object({
  can_approve_finance: z.boolean(),
  can_manage_payroll: z.boolean(),
  can_manage_accounts: z.boolean(),
});

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => q(
    `SELECT id, full_name AS name, username, is_active, can_approve_finance, can_manage_payroll, can_manage_accounts, last_login_at
       FROM users WHERE role = 'accountant' ORDER BY id`)));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  await inTenant(req, async (q) => {
    const [taken] = await q("SELECT 1 FROM users WHERE username = $1", [b.username]);
    if (taken) throw conflict("اسم المستخدم مستخدم داخل المدرسة");
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, must_change_password,
               can_approve_finance, can_manage_payroll, can_manage_accounts)
             VALUES (app_tenant(), 'accountant', $1, $2, $3, true, $4, $5, $6)`,
      [b.name, b.username, hash, b.can_approve_finance, b.can_manage_payroll, b.can_manage_accounts]);
  });
  res.status(201).json({ credentials: { school: req.tenantId, username: b.username, password } });
}));

r.patch("/:id/permissions", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(permsSchema, req.body);
  await inTenant(req, async (q) => {
    const rows = await q(
      `UPDATE users SET can_approve_finance = $2, can_manage_payroll = $3, can_manage_accounts = $4
        WHERE id = $1 AND role = 'accountant' RETURNING id`,
      [id, b.can_approve_finance, b.can_manage_payroll, b.can_manage_accounts]);
    if (!rows.length) throw notFound("الحساب غير موجود");
  });
  res.json({ ok: true });
}));

r.patch("/:id/active", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  await inTenant(req, async (q) => {
    const [u] = await q("UPDATE users SET is_active = $2 WHERE id = $1 AND role = 'accountant' RETURNING id", [id, active]);
    if (!u) throw notFound("الحساب غير موجود");
    if (!active) await q("DELETE FROM sessions WHERE user_id = $1", [id]);
  });
  res.json({ ok: true });
}));

r.post("/:id/reset-password", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const username = await inTenant(req, async (q) => {
    const [u] = await q(
      `UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, password_changed_at = now()
        WHERE id = $1 AND role = 'accountant' RETURNING username`, [id, hash]);
    if (!u) throw notFound("الحساب غير موجود");
    await q("DELETE FROM sessions WHERE user_id = $1", [id]);
    await clearLoginFailures(q, req.tenantId, u.username);
    return u.username;
  });
  res.json({ credentials: { school: req.tenantId, username, password } });
}));

export default r;
