/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, unauthorized, forbidden, notFound, badRequest, AppError } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword, verifyPassword, canonPassword } from "../../core/auth/password.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { createSession, destroySession, readSession } from "../../core/auth/sessions.js";
import { logEvent, clearLoginFailures } from "../../core/audit.js";
import { limits } from "../../core/rate-limit.js";
import { schoolLinks } from "../../core/links.js";
import { createTenant, codeSchema } from "../owner/tenants.js";
import { groupSchoolRows, groupSubscription, schoolFigures } from "../shared/groups.service.js";
import { issueLink } from "../shared/school-files.service.js";
import { env } from "../../config/env.js";

const r = Router();
const MAX_FAILS = 5;
const platform = (req, fn) => transaction({ actor: req.actor || "إدارة المجموعة", ip: req.ip, platform: true }, fn);
const groupCode = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "رمز المجموعة غير صحيح");

const loginSchema = z.object({
  group: groupCode,
  username: z.string().trim().toLowerCase().max(40),
  password: z.string().max(200),
  remember: z.boolean().optional().default(false),
});

r.post("/login", limits.login, handle(async (req, res) => {
  const b = parse(loginSchema, { ...req.body, group: req.body?.group ?? req.body?.school });
  const outcome = await transaction({ actor: b.username, ip: req.ip, platform: true }, async (q) => {
    const [g] = await q("SELECT * FROM school_groups WHERE id = $1 FOR UPDATE", [b.group]);
    if (g?.locked_until && new Date(g.locked_until) > new Date()) return { locked: true };
    const ok = Boolean(g) && b.username === g.username
      && await verifyPassword(b.password, g.password_hash, { temporary: g.must_change_password });
    if (!ok) {
      if (g) {
        const fails = g.failed_logins + 1;
        await q(`UPDATE school_groups SET failed_logins = $2,
                   locked_until = CASE WHEN $3 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`,
          [g.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS]);
        await logEvent(q, { actor: `مجموعة ${g.id}`, action: "محاولة دخول فاشلة لإدارة المجموعة" });
      }
      return { error: "بيانات الدخول غير صحيحة" };
    }
    if (g.status !== "active") return { error: "حساب المجموعة موقوف. تواصل مع إدارة مدار.", status: 403 };
    await q("UPDATE school_groups SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [g.id]);
    await createSession(res, "group", { groupId: g.id, ip: req.ip, userAgent: req.get("user-agent"), remember: b.remember }, q);
    await logEvent(q, { actor: `إدارة المجموعة: ${g.name}`, action: "تسجيل دخول لمركز تحكم المجموعة" });
    return { ok: true };
  });
  if (outcome.locked) throw new AppError(429, "تم قفل الدخول مؤقتًا بسبب محاولات خاطئة. حاول بعد 15 دقيقة.", "locked");
  if (outcome.error) throw outcome.status === 403 ? forbidden(outcome.error) : unauthorized(outcome.error);
  res.json({ ok: true });
}));

r.post("/logout", handle(async (req, res) => {
  await destroySession(req, res, "group");
  res.json({ ok: true });
}));

r.use(handle(async (req, res, next) => {
  const s = await readSession(req, "group");
  if (!s?.group_id) throw unauthorized();
  const [g] = await transaction({ platform: true, actor: "النظام" }, (q) => q(
    `SELECT g.id, g.name, g.manager_name, g.phone, g.status, g.max_schools, g.extra_school_price, g.plan_id, g.ends_on,
            g.username, g.must_change_password, p.name AS plan_name, p.currency
       FROM school_groups g LEFT JOIN plans p ON p.id = g.plan_id WHERE g.id = $1`, [s.group_id]));
  if (!g) throw unauthorized();
  if (g.status !== "active") throw forbidden("حساب المجموعة موقوف. تواصل مع إدارة مدار.");
  req.group = g;
  req.actor = `إدارة المجموعة: ${g.name}`;
  const open = (req.method === "GET" && req.path === "/me") || (req.method === "POST" && req.path === "/password");
  if (g.must_change_password && !open) throw forbidden("غيّر كلمة المرور المؤقتة أولًا");
  next();
}));

r.get("/me", (req, res) => res.json(req.group));

r.post("/password", handle(async (req, res) => {
  const b = parse(z.object({ current: z.string().min(1).max(200), next: t.password }), req.body);
  if (canonPassword(b.next) === canonPassword(b.current)) throw badRequest("اختر كلمة مرور مختلفة عن الحالية");
  await platform(req, async (q) => {
    const [g] = await q("SELECT password_hash, must_change_password FROM school_groups WHERE id = $1", [req.group.id]);
    if (!(await verifyPassword(b.current, g.password_hash, { temporary: g.must_change_password }))) throw unauthorized("كلمة المرور الحالية غير صحيحة");
    await q("UPDATE school_groups SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1",
      [req.group.id, await hashPassword(b.next)]);
    await logEvent(q, { actor: req.actor, action: "تغيير كلمة مرور إدارة المجموعة" });
  });
  res.json({ ok: true });
}));

r.get("/schools", handle(async (req, res) => {
  const rows = await platform(req, (q) => groupSchoolRows(q, req.group.id));
  const ctx = { actor: req.actor, ip: req.ip };
  const schools = [];
  for (const s of rows) schools.push({ ...s, ...(await schoolFigures(ctx, s.id)), links: schoolLinks(req, s.id) });
  const sum = (k) => schools.reduce((n, s) => n + Number(s[k] || 0), 0);
  res.json({
    group: req.group, schools,
    totals: { schools: schools.length, students: sum("students"), teachers: sum("teachers"), classes: sum("classes"),
      recorded_today: sum("recorded_today"), absent_today: sum("absent_today") },
  });
}));

const managerEmail = z.string().trim().toLowerCase().max(160).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "اكتب بريد مدير المدرسة بشكل صحيح");
const newSchool = z.object({
  id: codeSchema,
  name: t.shortText("اسم المدرسة", 150),
  admin_name: t.name("اسم مدير المدرسة"),
  manager_email: managerEmail,
  currency: z.enum(["SAR", "YER", "USD"]).default("YER"),
});

r.post("/schools", handle(async (req, res) => {
  const b = parse(newSchool, req.body);
  const g = req.group;
  // Same handover as the owner's: the manager opens the school's own link and creates their account with this email.
  const created = await createTenant(req, { ...b, plan: "enterprise", max_students: 100000, subscription_end: g.ends_on,
    group_id: g.id, subscription: groupSubscription(g) }, { link: false });
  await transaction({ tenantId: b.id, actor: req.actor, ip: req.ip }, (q) =>
    logEvent(q, { tenantId: b.id, actor: req.actor, action: `إنشاء المدرسة من إدارة المجموعة: ${g.name}` }));
  res.status(201).json({ ...created, links: schoolLinks(req, b.id) });
}));

async function member(req, id) {
  const [t] = await platform(req, (q) => q("SELECT id FROM tenants WHERE id = $1 AND group_id = $2 AND status <> 'archived'", [id, req.group.id]));
  if (!t) throw notFound("المدرسة ليست ضمن مجموعتك");
}

const managerState = async (req, id) => (await platform(req, (q) => q(
  `SELECT t.name, t.profile->>'email' AS manager_email,
          EXISTS (SELECT 1 FROM account_schools s WHERE s.tenant_id = t.id AND s.revoked_at IS NULL) AS linked
     FROM tenants t WHERE t.id = $1`, [id])))[0];

// Before the manager's first entry the group can correct the email that first entry accepts.
r.put("/schools/:id/manager-email", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  const { email } = parse(z.object({ email: managerEmail }), req.body);
  await member(req, id);
  const m = await managerState(req, id);
  if (m.linked) throw badRequest("المدير دخل المدرسة وربط حسابه بالفعل. لنقلها لبريد آخر استخدم «استعادة دخول المدير».");
  await transaction({ platform: true, actor: req.actor, ip: req.ip }, (q) =>
    q("UPDATE tenants SET profile = profile || jsonb_build_object('email', $2::text) WHERE id = $1", [id, email]));
  await transaction({ tenantId: id, actor: req.actor, ip: req.ip }, (q) =>
    logEvent(q, { tenantId: id, actor: req.actor, action: "تعديل بريد مدير المدرسة من إدارة المجموعة" }));
  res.json({ school: { id, name: m.name }, manager_email: email, links: schoolLinks(req, id) });
}));

// Restoring a school manager's access. Before first entry nothing is needed but the school link; after it, a
// recovery link moves the school to the manager's new account.
r.post("/schools/:id/reset-admin", handle(async (req, res) => {
  const id = parse(codeSchema, req.params.id);
  await member(req, id);
  const m = await managerState(req, id);
  if (!m.linked) return res.json({ school: { id, name: m.name }, manager_email: m.manager_email, setup: null, links: schoolLinks(req, id) });
  const setup = await transaction({ platform: true, actor: req.actor, ip: req.ip }, (q) => issueLink(q, id, req.actor, env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`));
  await transaction({ tenantId: id, actor: req.actor, ip: req.ip }, (q) =>
    logEvent(q, { tenantId: id, actor: req.actor, action: "إصدار رابط إعداد/استعادة لمدير المدرسة من إدارة المجموعة" }));
  const [t] = await platform(req, (q) => q("SELECT name FROM tenants WHERE id = $1", [id]));
  res.json({ school: { id, name: t?.name }, setup, links: schoolLinks(req, id) });
}));

export default r;
