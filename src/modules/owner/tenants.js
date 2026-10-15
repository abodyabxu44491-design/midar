/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword, newDirectoryCode } from "../../core/auth/codes.js";
import { RESERVED_CODES } from "../../core/reserved.js";
import { ensureDefaults } from "../shared/academic.service.js";
import { clearLoginFailures } from "../../core/audit.js";
import { activate, activateSchema } from "../shared/subscription.service.js";
import { schoolLinks } from "../../core/links.js";
import { buildShowcase } from "../shared/showcase-school.service.js";
import { startJob } from "../../core/jobs.js";
import { forgetDemoCache } from "../shared/demo.service.js";
import { groupQuota } from "../shared/groups.service.js";
import { addEvent as addSchoolEvent, issueLink } from "../shared/school-files.service.js";
import { env } from "../../config/env.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const inSchool = (req, tenantId, fn) => transaction({ tenantId, actor: req.actor, ip: req.ip }, fn);

export const codeSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "رمز المدرسة: حروف إنجليزية صغيرة وأرقام (3 إلى 30)")
  .refine((v) => !RESERVED_CODES.has(v), "هذا الرمز محجوز للنظام، اختر غيره");
const createSchema = z.object({
  id: codeSchema,
  name: t.shortText("اسم المدرسة", 150),
  admin_name: t.name("اسم المدير").optional().default("مدير المدرسة"),
  // The manager's email: their first entry from the school's login link is accepted with this email only.
  manager_email: z.string().trim().toLowerCase().max(160).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "بريد المدير غير صحيح").optional(),
  plan: z.enum(["basic", "pro", "enterprise"]).default("basic"),
  max_students: z.coerce.number().int().min(1).max(100000).default(200),
  subscription_end: t.optDate,
  currency: z.enum(["SAR", "YER", "USD"]).default("YER"),
  subscription_price: z.coerce.number().min(0).max(1_000_000).optional(),
  grace_days: z.coerce.number().int().min(0).max(120).optional(),
  subscription: activateSchema.optional(),
  org_type: z.enum(["school", "institute"]).default("school"),
});
const updateSchema = z.object({
  name: t.shortText("اسم المدرسة", 150).optional(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
  plan: z.enum(["basic", "pro", "enterprise"]).optional(),
  max_students: z.coerce.number().int().min(1).max(100000).optional(),
  subscription_end: t.optDate,
  subscription_price: z.coerce.number().min(0).max(1_000_000).optional(),
  grace_days: z.coerce.number().int().min(0).max(120).optional(),
  is_demo: z.boolean().optional(),
});

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT t.id, t.name, t.status, t.plan, t.max_students, t.subscription_end, t.subscription_price, t.grace_days,
            t.auto_suspended_at, t.created_at, t.is_demo,
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

export async function createTenant(req, b, { link = true } = {}) {
  if (b.org_type === "institute" && (!b.admin_name || b.admin_name === "مدير المدرسة")) b = { ...b, admin_name: "مدير المعهد" };
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const directory = newDirectoryCode();
  await transaction({ tenantId: b.id, actor: req.actor, ip: req.ip, platform: true }, async (q) => {
    const [exists] = await q("SELECT 1 FROM tenants WHERE id = $1", [b.id]);
    if (exists) throw conflict("هذا الرمز مستخدم لمدرسة أخرى");
    if (b.group_id) await groupQuota(q, b.group_id);
    await q(`INSERT INTO tenants (id, name, plan, max_students, subscription_end, directory_code,
               subscription_price, grace_days, currency, group_id, org_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [b.id, b.name, b.plan ?? "basic", b.max_students ?? 200, b.subscription_end ?? null, directory,
       b.subscription_price ?? 0, b.grace_days ?? 14, b.currency ?? "YER", b.group_id ?? null, b.org_type ?? "school"]);
    if (b.org_type === "institute") await q("INSERT INTO institute_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING", [b.id]);
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, must_change_password, can_danger_zone) VALUES ($1, 'admin', $2, 'admin', $3, true, true)`,
      [b.id, b.admin_name, hash]);
    await ensureDefaults(q);
    const sub = b.subscription || {
      kind: "paid", features: (await q("SELECT key FROM features WHERE is_active ORDER BY sort")).map((f) => f.key),
      plan_name: "باقة مخصصة", billing_cycle: "yearly", ends_on: b.subscription_end ?? null,
      price: b.subscription_price ?? 0, max_students: b.max_students, grace_days: b.grace_days ?? 14, status: "active", addons: [], discount: 0,
    };
    if (!b.subscription && !b.subscription_end) sub.billing_cycle = "none";
    await activate(q, b.id, sub, req.actor);
  });
  await transaction({ actor: req.actor, ip: req.ip, platform: true }, async (q) => {
    await q("UPDATE tenants SET approved_at = COALESCE(approved_at, now()), approved_by = COALESCE(approved_by, $2) WHERE id = $1", [b.id, req.actor]);
    if (b.manager_email) {
      await q("UPDATE tenants SET profile = profile || jsonb_build_object('email', $2::text, 'contact_name', $3::text) WHERE id = $1", [b.id, b.manager_email, b.admin_name]);
    }
    await addSchoolEvent(q, b.id, { kind: "account", body: b.org_type === "institute" ? "أُنشئ المعهد وحساب مديره" : "أُنشئت المدرسة وحساب مديرها" }, req.actor);
  });
  // The manager's sign-in comes from the setup link (their own Midar account); no password is handed out.
  const setup = link ? await transaction({ actor: req.actor, ip: req.ip, platform: true }, (q) => issueLink(q, b.id, req.actor, linkBase(req))) : null;
  return { school: { id: b.id, name: b.name }, setup, login_url: `${linkBase(req)}/${b.id}/idara?role=admin`, manager_email: b.manager_email || null, directory_code: directory };
}
const linkBase = (req) => env.PUBLIC_URL || (req.protocol ? `${req.protocol}://${req.get("host")}` : "");

r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  res.status(201).json(await createTenant(req, b));
}));

const showcaseSchema = z.object({
  id: codeSchema.default("alrowad-aden"),
  name: t.shortText("اسم المدرسة", 150).default("مدارس الرواد الأهلية للبنين"),
  per_section: z.coerce.number().int().min(5).max(35).default(24),
});
export async function createShowcase(req, b, progress) {
  const created = await createTenant(req, { id: b.id, name: b.name, admin_name: "أ. عبدالله محمد باوزير", plan: "enterprise", max_students: 2000, currency: "YER" });
  const summary = await buildShowcase(b.id, { actor: req.actor, ip: req.ip, perSection: b.per_section, progress });
  return { ...created, summary, links: schoolLinks(req, b.id) };
}
r.post("/showcase", handle(async (req, res) => {
  const b = parse(showcaseSchema, req.body || {});
  const [taken] = await platform(req, (q) => q("SELECT 1 FROM tenants WHERE id = $1", [b.id]));
  if (taken) throw conflict("هذا الرمز مستخدم لمدرسة أخرى");
  const links = schoolLinks(req, b.id);
  res.status(202).json(await startJob({ kind: "showcase_school", total: 100, step: "إنشاء المدرسة", req }, async ({ progress }) => {
    const r = await createShowcase(req, b, progress);
    const { teacher_samples, parent_samples, accountant, ...counts } = r.summary;
    return { summary: { school: r.school, counts }, secret: { ...r, links } };
  }));
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  const b = parse(updateSchema, req.body);
  const cur = await inSchool(req, id, async (q) => {
    const [cur] = await q("SELECT * FROM tenants WHERE id = $1 FOR UPDATE", [id]);
    if (!cur) throw notFound("المدرسة غير موجودة");
    await q(`UPDATE tenants SET name = $2, status = $3, plan = $4, max_students = $5, subscription_end = $6,
               subscription_price = $7, grace_days = $8, auto_suspended_at = CASE WHEN $3 = 'active' THEN NULL ELSE auto_suspended_at END
              WHERE id = $1`,
      [id, b.name ?? cur.name, b.status ?? cur.status, b.plan ?? cur.plan, b.max_students ?? cur.max_students,
       b.subscription_end !== undefined ? b.subscription_end : cur.subscription_end,
       b.subscription_price ?? cur.subscription_price, b.grace_days ?? cur.grace_days]);
    if (b.status && b.status !== "active") await q("DELETE FROM sessions WHERE tenant_id = $1", [id]);
    return cur;
  });
  if (b.is_demo !== undefined) {
    await transaction({ platform: true, actor: req.actor, ip: req.ip }, async (pq) => {
      if (b.is_demo) await pq("UPDATE tenants SET is_demo = false WHERE is_demo AND id <> $1", [id]);
      await pq("UPDATE tenants SET is_demo = $2 WHERE id = $1", [id, b.is_demo]);
    });
    forgetDemoCache();
  }
  if (b.subscription_end !== undefined || b.subscription_price !== undefined || b.grace_days !== undefined || b.max_students !== undefined) {
    await transaction({ platform: true, actor: req.actor, ip: req.ip }, async (pq) => {
      const [sub] = await pq(
        `UPDATE subscriptions s SET ends_on = $2, starts_on = LEAST(s.starts_on, COALESCE($2::date, s.starts_on)), price = COALESCE($3, s.price), grace_days = COALESCE($4, s.grace_days),
                max_students = COALESCE($5, s.max_students),
                status = CASE WHEN s.status IN ('expired', 'trial_expired') AND ($2::date IS NULL OR $2::date + COALESCE($4, s.grace_days) >= CURRENT_DATE)
                              THEN (CASE WHEN s.kind = 'trial' THEN 'trial' ELSE 'active' END) ELSE s.status END
           FROM tenants t WHERE t.id = $1 AND s.id = t.subscription_id AND (s.kind <> 'trial' OR $2::date IS NOT NULL)
         RETURNING s.id`,
        [id, b.subscription_end !== undefined ? b.subscription_end : cur.subscription_end, b.subscription_price ?? null, b.grace_days ?? null, b.max_students ?? null]);
      if (sub) await pq("INSERT INTO subscription_events (tenant_id, subscription_id, event, details, actor) VALUES ($1, $2, 'extended', $3, $4)",
        [id, sub.id, { to: b.subscription_end ?? cur.subscription_end, source: "school_form" }, req.actor]);
    });
  }
  res.json({ ok: true });
}));

r.get("/:id/overview", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  const data = await inSchool(req, id, async (q) => {
    const [t] = await q(
      `SELECT t.id, t.name, t.status, t.directory_code, t.created_at, t.currency, t.is_demo,
              (SELECT count(*) FROM students WHERE status = 'active')::int AS students,
              (SELECT count(*) FROM teachers)::int AS teachers,
              (SELECT count(*) FROM classes)::int AS sections
         FROM tenants t WHERE t.id = $1`, [id]);
    if (!t) throw notFound("المدرسة غير موجودة");
    const staff = await q(
      `SELECT username, full_name, role, is_active, must_change_password, last_login_at FROM users
        WHERE role IN ('admin', 'accountant') ORDER BY role, id`);
    return { t, staff };
  });
  const sub = await platform(req, async (q) => (await q(
    `SELECT s.kind, s.status, s.plan_name, s.starts_on, s.ends_on, s.max_students, s.max_teachers, (s.ends_on - CURRENT_DATE)::int AS days_left,
            (SELECT count(*)::int FROM subscriptions x WHERE x.tenant_id = $1 AND x.kind = 'trial') AS trials
       FROM tenants t JOIN subscriptions s ON s.id = t.subscription_id WHERE t.id = $1`, [id]))[0] || null);
  res.json({ school: data.t, staff: data.staff, subscription: sub, links: schoolLinks(req, id) });
}));

// Restoring the manager's access: a new setup link (the manager links their own account again).
r.post("/:id/reset-admin", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  await inSchool(req, id, async (q) => {
    const [u] = await q(`UPDATE users SET failed_logins = 0, locked_until = NULL, is_active = true
      WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) RETURNING id, username`);
    if (!u) throw notFound("لا يوجد مدير لهذه المدرسة");
    await clearLoginFailures(q, id, u.username);
  });
  const setup = await transaction({ actor: req.actor, ip: req.ip, platform: true }, (q) => issueLink(q, id, req.actor, linkBase(req)));
  res.json({ setup });
}));

export default r;
