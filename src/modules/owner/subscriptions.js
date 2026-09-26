// لوحة المالك: الاشتراكات (قائمة، إحصاءات، تفاصيل وسجل، تفعيل وعمليات) والطلبات الموحدة
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { activate, activateSchema, act, actionSchema, trialHistory, STATUS_LABEL, runExpiry } from "../shared/subscription.service.js";
import { createTenant } from "./tenants.js";

const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const tenantParam = z.string().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/);

/* ======================= الاشتراكات ======================= */
export const subscriptions = Router();

const FILTERS = {
  all: "TRUE",
  trial: "s.status = 'trial'",
  active: "s.status = 'active'",
  expired: "s.status IN ('expired', 'trial_expired')",
  suspended: "(s.status IN ('suspended', 'canceled') OR t.status <> 'active')",
  pending: "s.status = 'pending_payment'",
  expiring: "s.status IN ('trial', 'active') AND s.ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7",
};

subscriptions.get("/", handle(async (req, res) => {
  const f = parse(z.object({ filter: z.enum(Object.keys(FILTERS)).default("all"), plan_id: t.optId }), req.query);
  res.json(await platform(req, (q) => q(
    `SELECT t.id AS tenant_id, t.name, t.status AS tenant_status, s.id, s.kind, s.status, s.plan_id, s.plan_name,
            s.starts_on, s.ends_on, s.price, s.discount, s.currency, s.billing_cycle, s.max_students, s.max_teachers,
            jsonb_array_length(s.addons) AS addons, (s.ends_on - CURRENT_DATE)::int AS days_left,
            u.students, u.teachers,
            (SELECT min(starts_on) FROM subscriptions x WHERE x.tenant_id = t.id AND x.kind = 'trial') AS first_trial,
            (SELECT min(starts_on) FROM subscriptions x WHERE x.tenant_id = t.id AND x.kind = 'paid') AS first_paid
       FROM tenants t JOIN subscriptions s ON s.id = t.subscription_id JOIN platform_tenant_usage() u ON u.tenant_id = t.id
      WHERE ${FILTERS[f.filter]} ${f.plan_id ? "AND s.plan_id = $1" : ""}
      ORDER BY s.ends_on NULLS LAST, t.name LIMIT 1000`, f.plan_id ? [f.plan_id] : [])));
}));

subscriptions.get("/stats", handle(async (req, res) => {
  res.json(await platform(req, async (q) => {
    const [c] = await q(
      `SELECT count(*)::int AS schools,
              count(*) FILTER (WHERE s.status = 'active')::int AS active,
              count(*) FILTER (WHERE s.status = 'trial')::int AS trials,
              count(*) FILTER (WHERE s.status IN ('expired', 'trial_expired'))::int AS expired,
              count(*) FILTER (WHERE s.status = 'trial_expired')::int AS trials_expired,
              count(*) FILTER (WHERE s.status IN ('suspended', 'canceled') OR t.status <> 'active')::int AS suspended,
              count(*) FILTER (WHERE s.status = 'pending_payment')::int AS pending,
              count(*) FILTER (WHERE s.status IN ('trial', 'active') AND s.ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS expiring_7,
              COALESCE(sum(CASE WHEN s.status = 'active' AND s.billing_cycle = 'monthly' THEN s.price * 12
                                WHEN s.status = 'active' AND s.billing_cycle = 'yearly' THEN s.price ELSE 0 END), 0) AS annual_value
         FROM tenants t JOIN subscriptions s ON s.id = t.subscription_id`);
    const byPlan = await q(
      `SELECT COALESCE(p.name, s.plan_name) AS plan, count(*)::int AS schools,
              count(*) FILTER (WHERE s.status = 'trial')::int AS trials
         FROM tenants t JOIN subscriptions s ON s.id = t.subscription_id LEFT JOIN plans p ON p.id = s.plan_id
        WHERE s.status IN ('trial', 'active') GROUP BY 1 ORDER BY 2 DESC`);
    return { ...c, by_plan: byPlan };
  }));
}));

// تشغيل فحص الانتهاء يدويًا (يعمل تلقائيًا كل ساعة)
subscriptions.post("/run-expiry", handle(async (req, res) => {
  res.json({ changed: await platform(req, runExpiry) });
}));

subscriptions.get("/:tenant", handle(async (req, res) => {
  const tenant = parse(tenantParam, req.params.tenant);
  res.json(await platform(req, async (q) => {
    const [tn] = await q(
      `SELECT t.id, t.name, t.status, t.subscription_id, t.created_at, u.students, u.teachers
         FROM tenants t JOIN platform_tenant_usage() u ON u.tenant_id = t.id WHERE t.id = $1`, [tenant]);
    if (!tn) throw notFound("المدرسة غير موجودة");
    const history = await q("SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY id DESC", [tenant]);
    const events = await q("SELECT id, subscription_id, event, details, actor, created_at FROM subscription_events WHERE tenant_id = $1 ORDER BY id DESC LIMIT 200", [tenant]);
    const prices = await q("SELECT tp.*, p.name AS plan_name FROM tenant_prices tp JOIN plans p ON p.id = tp.plan_id WHERE tp.tenant_id = $1", [tenant]);
    const requests = await q("SELECT id, kind, status, feature_key, plan_id, note, created_at FROM leads WHERE tenant_id = $1 ORDER BY id DESC LIMIT 50", [tenant]);
    const [s] = await q("SELECT trials_per_school FROM platform_settings WHERE id");
    return {
      tenant: tn, current: history.find((h) => h.id === tn.subscription_id) || null, history, events, prices, requests,
      trials: await trialHistory(q, tenant), trials_allowed: s.trials_per_school,
    };
  }));
}));

subscriptions.post("/:tenant/activate", handle(async (req, res) => {
  const tenant = parse(tenantParam, req.params.tenant);
  const b = parse(activateSchema, req.body);
  res.status(201).json(await platform(req, (q) => activate(q, tenant, b, req.actor)));
}));

subscriptions.post("/:tenant/action", handle(async (req, res) => {
  const tenant = parse(tenantParam, req.params.tenant);
  const b = parse(actionSchema, req.body);
  res.json(await platform(req, (q) => act(q, tenant, b, req.actor)));
}));

/* ======================= الطلبات (Leads) ======================= */
export const requests = Router();

const KINDS = ["trial", "subscription", "feature", "contact", "upgrade", "renewal"];
const REQ_STATUS = ["new", "reviewing", "approved", "awaiting_payment", "active", "rejected", "canceled", "expired"];

requests.get("/", handle(async (req, res) => {
  const f = parse(z.object({ kind: z.enum(KINDS).optional().or(z.literal("")), status: z.enum([...REQ_STATUS, "open"]).optional().or(z.literal("")) }), req.query);
  res.json(await platform(req, async (q) => {
    const params = [];
    const where = ["TRUE"];
    if (f.kind) { params.push(f.kind); where.push(`l.kind = $${params.length}`); }
    if (f.status === "open") where.push("l.status IN ('new', 'reviewing', 'approved', 'awaiting_payment')");
    else if (f.status) { params.push(f.status); where.push(`l.status = $${params.length}`); }
    const rows = await q(
      `SELECT l.id, l.kind, l.source, l.status, l.school_name, l.contact_name, l.phone, l.email, l.city, l.students_count,
              l.note, l.owner_note, l.tenant_id, l.plan_id, p.name AS plan_name, l.billing_cycle, l.months, l.try_plan,
              l.addon_keys, (SELECT array_agg(x.name ORDER BY x.sort) FROM features x WHERE x.key = ANY(l.addon_keys)) AS addon_names,
              l.feature_key, fe.name AS feature_name, l.requested_by, l.handled_by, l.seen_at, l.created_at,
              t.name AS tenant_name,
              -- حماية من تكرار التجربة: طلبات أو مدارس سابقة بنفس الجوال أو البريد
              (SELECT count(*)::int FROM leads x WHERE x.id <> l.id AND x.kind = 'trial' AND l.source = 'public'
                 AND ((l.phone IS NOT NULL AND x.phone = l.phone) OR (l.email IS NOT NULL AND x.email = l.email))) AS similar_trials,
              -- تجارب سابقة للمدرسة (بدون التجربة التي أُنشئت من هذا الطلب نفسه)
              (SELECT count(*)::int FROM subscriptions s WHERE s.tenant_id = l.tenant_id AND s.kind = 'trial'
                  AND s.source_lead_id IS DISTINCT FROM l.id) AS tenant_trials
         FROM leads l LEFT JOIN plans p ON p.id = l.plan_id LEFT JOIN features fe ON fe.key = l.feature_key
         LEFT JOIN tenants t ON t.id = l.tenant_id
        WHERE ${where.join(" AND ")}
        ORDER BY (l.status = 'new') DESC, l.id DESC LIMIT 500`, params);
    return rows;
  }));
}));

// عدّاد «طلب جديد» على قائمة لوحة المالك
requests.get("/badge", handle(async (req, res) => {
  const [r] = await platform(req, (q) => q(
    `SELECT count(*) FILTER (WHERE seen_at IS NULL)::int AS unseen, count(*) FILTER (WHERE status = 'new')::int AS new,
            (SELECT json_build_object('kind', kind, 'school', school_name, 'at', created_at) FROM leads
              WHERE seen_at IS NULL ORDER BY id DESC LIMIT 1) AS latest
       FROM leads WHERE status IN ('new', 'reviewing')`));
  res.json(r);
}));
requests.post("/seen", handle(async (req, res) => {
  await platform(req, (q) => q("UPDATE leads SET seen_at = now() WHERE seen_at IS NULL"));
  res.json({ ok: true });
}));

requests.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(z.object({ status: z.enum(REQ_STATUS).optional(), owner_note: t.optText(500) }), req.body);
  await platform(req, async (q) => {
    const [cur] = await q("SELECT * FROM leads WHERE id = $1", [id]);
    if (!cur) throw notFound("الطلب غير موجود");
    await q("UPDATE leads SET status = $2, owner_note = $3, handled_by = $4, seen_at = COALESCE(seen_at, now()) WHERE id = $1",
      [id, b.status ?? cur.status, b.owner_note !== undefined ? b.owner_note : cur.owner_note, req.actor]);
  });
  res.json({ ok: true });
}));

/**
 * تحويل طلب (تجربة أو اشتراك) إلى مدرسة فعلية:
 * إنشاء المدرسة وحساب مديرها واشتراكها في خطوة واحدة، ثم ربط الطلب بها.
 * التجربة: تاريخ نهايتها يُحسب تلقائيًا (لا يُدخل يدويًا).
 */
const convertSchema = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "رمز المدرسة: حروف إنجليزية صغيرة وأرقام (3 إلى 30)"),
  name: t.shortText("اسم المدرسة", 150),
  admin_name: t.name("اسم المدير").optional().default("مدير المدرسة"),
  currency: z.enum(["SAR", "YER", "USD"]).default("SAR"),
  subscription: activateSchema,
});
requests.post("/:id/convert", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(convertSchema, req.body);
  const [lead] = await platform(req, (q) => q("SELECT * FROM leads WHERE id = $1", [id]));
  if (!lead) throw notFound("الطلب غير موجود");
  if (lead.tenant_id) throw badRequest("هذا الطلب مرتبط بمدرسة قائمة. فعّل اشتراكها من صفحة الاشتراكات.");
  const created = await createTenant(req, {
    id: b.id, name: b.name, admin_name: b.admin_name, currency: b.currency, max_students: b.subscription.max_students || 200,
    subscription: { ...b.subscription, lead_id: id },
  });
  res.status(201).json({ ...created, lead: { phone: lead.phone, contact_name: lead.contact_name } });
}));

/**
 * الموافقة على طلب ميزة أو ترقية من مدرسة قائمة:
 * mode = free (مجانًا)، priced (بسعر)، أو مدة محددة (until). تُضاف الميزة كإضافة لاشتراكها الحالي.
 */
requests.post("/:id/grant-feature", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(z.object({ price: z.coerce.number().min(0).default(0), until: t.optDate, note: z.string().max(100).optional() }), req.body);
  res.json(await platform(req, async (q) => {
    const [lead] = await q("SELECT * FROM leads WHERE id = $1 FOR UPDATE", [id]);
    if (!lead || !lead.tenant_id || !lead.feature_key) throw badRequest("هذا ليس طلب ميزة من مدرسة");
    const [sub] = await q("SELECT s.addons FROM subscriptions s JOIN tenants t ON t.subscription_id = s.id WHERE t.id = $1", [lead.tenant_id]);
    const addons = (sub?.addons || []).filter((a) => a.key !== lead.feature_key);
    addons.push({ key: lead.feature_key, until: b.until || null, price: b.price, note: b.note || null });
    const fresh = await act(q, lead.tenant_id, { action: "set_addons", addons }, req.actor);
    await q("UPDATE leads SET status = 'active', handled_by = $2, seen_at = COALESCE(seen_at, now()) WHERE id = $1", [id, req.actor]);
    return fresh;
  }));
}));

requests.delete("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const rows = await platform(req, (q) => q("DELETE FROM leads WHERE id = $1 RETURNING id", [id]));
  if (!rows.length) throw notFound("الطلب غير موجود");
  res.json({ ok: true });
}));

export { STATUS_LABEL };
