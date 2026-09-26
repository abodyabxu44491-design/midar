// إدارة المدارس والاشتراكات — بدون أي وصول لبيانات الطلاب
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword, newDirectoryCode } from "../../core/auth/codes.js";
import { RESERVED_CODES } from "../../core/reserved.js";
import { ensureDefaults } from "../shared/academic.service.js";
import { clearLoginFailures } from "../../core/audit.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const inSchool = (req, tenantId, fn) => transaction({ tenantId, actor: req.actor, ip: req.ip }, fn);

const codeSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "رمز المدرسة: حروف إنجليزية صغيرة وأرقام (3 إلى 30)")
  .refine((v) => !RESERVED_CODES.has(v), "هذا الرمز محجوز للنظام، اختر غيره");
const createSchema = z.object({
  id: codeSchema,
  name: t.shortText("اسم المدرسة", 150),
  admin_name: t.name("اسم المدير").optional().default("مدير المدرسة"),
  plan: z.enum(["basic", "pro", "enterprise"]).default("basic"),
  max_students: z.coerce.number().int().min(1).max(100000).default(200),
  subscription_end: t.optDate,
  currency: z.enum(["SAR", "YER", "USD"]).default("SAR"),
  subscription_price: z.coerce.number().min(0).max(1_000_000).optional(),
  grace_days: z.coerce.number().int().min(0).max(120).optional(),
});
const updateSchema = z.object({
  name: t.shortText("اسم المدرسة", 150).optional(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
  plan: z.enum(["basic", "pro", "enterprise"]).optional(),
  max_students: z.coerce.number().int().min(1).max(100000).optional(),
  subscription_end: t.optDate,
  subscription_price: z.coerce.number().min(0).max(1_000_000).optional(),
  grace_days: z.coerce.number().int().min(0).max(120).optional(),
});

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT t.id, t.name, t.status, t.plan, t.max_students, t.subscription_end, t.subscription_price, t.grace_days,
            t.auto_suspended_at, t.created_at,
            u.students, u.teachers, u.open_sessions
       FROM tenants t JOIN platform_tenant_usage() u ON u.tenant_id = t.id
      ORDER BY t.created_at DESC`)));
}));

r.get("/stats", handle(async (req, res) => {
  const [s] = await platform(req, (q) => q(
    `SELECT count(*)::int AS tenants,
            count(*) FILTER (WHERE t.status = 'active')::int AS active,
            COALESCE(sum(u.students), 0)::int AS students,
            count(*) FILTER (WHERE t.status = 'active' AND t.subscription_end <= CURRENT_DATE + 45)::int AS expiring
       FROM tenants t JOIN platform_tenant_usage() u ON u.tenant_id = t.id`));
  res.json(s);
}));

// إنشاء مدرسة + حساب مديرها في معاملة واحدة
r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const directory = newDirectoryCode();
  await inSchool(req, b.id, async (q) => {
    const [exists] = await q("SELECT 1 FROM tenants WHERE id = $1", [b.id]);
    if (exists) throw conflict("هذا الرمز مستخدم لمدرسة أخرى");
    await q(`INSERT INTO tenants (id, name, plan, max_students, subscription_end, directory_code,
               subscription_price, grace_days, currency)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [b.id, b.name, b.plan, b.max_students, b.subscription_end, directory,
       b.subscription_price ?? 0, b.grace_days ?? 14, b.currency ?? "SAR"]);
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, must_change_password) VALUES ($1, 'admin', $2, 'admin', $3, true)`,
      [b.id, b.admin_name, hash]);
    await ensureDefaults(q);          // سنة دراسية وفصولها جاهزة من اليوم الأول
  });
  res.status(201).json({
    school: { id: b.id, name: b.name },
    credentials: { school: b.id, username: "admin", password, directory_code: directory },
  });
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  const b = parse(updateSchema, req.body);
  await inSchool(req, id, async (q) => {
    const [cur] = await q("SELECT * FROM tenants WHERE id = $1 FOR UPDATE", [id]);
    if (!cur) throw notFound("المدرسة غير موجودة");
    await q(`UPDATE tenants SET name = $2, status = $3, plan = $4, max_students = $5, subscription_end = $6,
               subscription_price = $7, grace_days = $8, auto_suspended_at = CASE WHEN $3 = 'active' THEN NULL ELSE auto_suspended_at END
              WHERE id = $1`,
      [id, b.name ?? cur.name, b.status ?? cur.status, b.plan ?? cur.plan, b.max_students ?? cur.max_students,
       b.subscription_end !== undefined ? b.subscription_end : cur.subscription_end,
       b.subscription_price ?? cur.subscription_price, b.grace_days ?? cur.grace_days]);
    if (b.status && b.status !== "active") await q("DELETE FROM sessions WHERE tenant_id = $1", [id]); // إخراج الجميع فورًا
  });
  res.json({ ok: true });
}));

r.post("/:id/reset-admin", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const username = await inSchool(req, id, async (q) => {
    const [u] = await q(`UPDATE users SET password_hash = $1, must_change_password = true, failed_logins = 0, locked_until = NULL, is_active = true, password_changed_at = now()
      WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) RETURNING id, username`, [hash]);
    if (!u) throw notFound("لا يوجد مدير لهذه المدرسة");
    await q("DELETE FROM sessions WHERE user_id = $1", [u.id]);
    await clearLoginFailures(q, id, u.username);
    return u.username;
  });
  res.json({ credentials: { school: id, username, password } });
}));

export default r;
