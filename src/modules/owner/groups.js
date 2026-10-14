/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, conflict, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { baseUrl } from "../../core/links.js";
import { logEvent } from "../../core/audit.js";
import { RESERVED_CODES } from "../../core/reserved.js";
import { activate } from "../shared/subscription.service.js";
import { groupQuota, groupSubscription, syncGroupSchools, enterprisePlanId } from "../shared/groups.service.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const code = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "الرمز: حروف إنجليزية صغيرة وأرقام (3 إلى 30)");
const money = z.union([z.coerce.number().min(0).max(10_000_000), z.literal(""), z.null()]).optional()
  .transform((v) => (v === "" ? null : v));

const fields = {
  name: t.shortText("اسم المجموعة", 150),
  manager_name: t.name("اسم المدير العام"),
  phone: t.optText(25),
  max_schools: z.coerce.number().int().min(1).max(100).default(3),
  extra_school_price: money,
  plan_id: t.optId,
  ends_on: t.optDate,
};
const createSchema = z.object({ id: code.refine((v) => !RESERVED_CODES.has(v), "هذا الرمز محجوز"), ...fields });
const updateSchema = z.object({
  ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
  status: z.enum(["active", "suspended"]).optional(),
  apply_to_schools: z.boolean().default(false),
});

const link = (req) => `${baseUrl(req)}/group`;

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, (q) => q(
    `SELECT g.id, g.name, g.manager_name, g.phone, g.status, g.max_schools, g.extra_school_price, g.plan_id, g.ends_on,
            g.username, g.must_change_password, g.last_login_at, g.created_at, p.name AS plan_name, p.currency,
            COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'status', t.status) ORDER BY t.created_at)
              FILTER (WHERE t.id IS NOT NULL), '[]') AS schools
       FROM school_groups g LEFT JOIN plans p ON p.id = g.plan_id
       LEFT JOIN tenants t ON t.group_id = g.id AND t.status <> 'archived'
      GROUP BY g.id, p.id ORDER BY g.created_at DESC`)));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  await platform(req, async (q) => {
    const [dup] = await q("SELECT 1 FROM school_groups WHERE id = $1", [b.id]);
    if (dup) throw conflict("هذا الرمز مستخدم لمجموعة أخرى");
    const planId = b.plan_id ?? await enterprisePlanId(q);
    const [plan] = planId ? await q("SELECT extra_school_price FROM plans WHERE id = $1", [planId]) : [];
    await q(`INSERT INTO school_groups (id, name, manager_name, phone, max_schools, extra_school_price, plan_id, ends_on, password_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [b.id, b.name, b.manager_name, b.phone ?? null, b.max_schools, b.extra_school_price ?? plan?.extra_school_price ?? null,
       planId, b.ends_on ?? null, hash]);
    await logEvent(q, { actor: req.actor, action: `إنشاء مجموعة مدارس: ${b.name}` });
  });
  res.status(201).json({ group: { id: b.id, name: b.name }, credentials: { group: b.id, username: "admin", password }, link: link(req) });
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const b = parse(updateSchema, req.body);
  const synced = await platform(req, async (q) => {
    const [cur] = await q("SELECT * FROM school_groups WHERE id = $1 FOR UPDATE", [id]);
    if (!cur) throw notFound("المجموعة غير موجودة");
    const keys = ["name", "manager_name", "phone", "max_schools", "extra_school_price", "plan_id", "ends_on", "status"].filter((k) => b[k] !== undefined);
    if (b.max_schools !== undefined) {
      const [{ n }] = await q("SELECT count(*)::int AS n FROM tenants WHERE group_id = $1 AND status <> 'archived'", [id]);
      if (b.max_schools < n) throw badRequest(`في المجموعة ${n} مدارس، لا يمكن أن يقل الحد عن ذلك`);
    }
    let g = cur;
    if (keys.length) {
      [g] = await q(`UPDATE school_groups SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
        [id, ...keys.map((k) => b[k])]);
    }
    if (b.status === "suspended") await q("DELETE FROM sessions WHERE group_id = $1", [id]);
    await logEvent(q, { actor: req.actor, action: `تعديل مجموعة مدارس: ${g.name}` });
    return b.apply_to_schools ? syncGroupSchools(q, g, req.actor) : 0;
  });
  res.json({ ok: true, synced });
}));

r.post("/:id/reset-password", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  await platform(req, async (q) => {
    const rows = await q(`UPDATE school_groups SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL,
                            password_changed_at = now() WHERE id = $1 RETURNING id`, [id, hash]);
    if (!rows.length) throw notFound("المجموعة غير موجودة");
    await q("DELETE FROM sessions WHERE group_id = $1", [id]);
    await logEvent(q, { actor: req.actor, action: `إعادة تعيين كلمة مرور مجموعة: ${id}` });
  });
  res.json({ credentials: { group: id, username: "admin", password }, link: link(req) });
}));

r.post("/:id/schools", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const b = parse(z.object({ tenant_id: code, apply_subscription: z.boolean().default(true) }), req.body);
  await platform(req, async (q) => {
    const [tn] = await q("SELECT id, group_id FROM tenants WHERE id = $1 FOR UPDATE", [b.tenant_id]);
    if (!tn) throw notFound("المدرسة غير موجودة");
    if (tn.group_id === id) return;
    if (tn.group_id) throw conflict(`المدرسة ضمن مجموعة أخرى (${tn.group_id}). أخرجها منها أولًا.`);
    await groupQuota(q, id);
    await q("UPDATE tenants SET group_id = $2 WHERE id = $1", [b.tenant_id, id]);
    if (b.apply_subscription) {
      const [g] = await q("SELECT * FROM school_groups WHERE id = $1", [id]);
      await activate(q, b.tenant_id, groupSubscription(g), req.actor, { event: "upgraded" });
    }
    await logEvent(q, { actor: req.actor, action: `ضم المدرسة ${b.tenant_id} إلى مجموعة ${id}` });
  });
  res.json({ ok: true });
}));

r.delete("/:id/schools/:tenant", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const tenant = parse(code, req.params.tenant);
  await platform(req, async (q) => {
    const rows = await q("UPDATE tenants SET group_id = NULL WHERE id = $1 AND group_id = $2 RETURNING id", [tenant, id]);
    if (!rows.length) throw notFound("المدرسة ليست ضمن هذه المجموعة");
    await logEvent(q, { actor: req.actor, action: `إخراج المدرسة ${tenant} من مجموعة ${id}` });
  });
  res.json({ ok: true });
}));

export default r;
