// فواتير اشتراكات المدارس والتجديد
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);

const invoiceSchema = z.object({
  tenant_id: z.string().regex(/^[a-z0-9-]{3,30}$/),
  period_start: t.date,
  period_end: t.date,
  amount: z.coerce.number().min(0).max(1_000_000),
  note: t.optText(300),
});
const paySchema = z.object({ method: z.enum(["cash", "transfer", "card", "online"]), note: t.optText(300) });

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, async (q) => ({
    invoices: await q(
      `SELECT i.*, t.name AS school_name FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id
        ORDER BY i.status = 'open' DESC, i.id DESC LIMIT 300`),
    summary: (await q(
      `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0) AS collected,
              COALESCE(sum(amount) FILTER (WHERE status = 'open'), 0) AS due,
              COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND paid_at > now() - interval '365 days'), 0) AS year_revenue
         FROM subscription_invoices`))[0],
    // اشتراكات تنتهي قريبًا أو انتهت وهي في مدة السماح
    renewals: await q(
      `SELECT t.id, t.name, t.subscription_end, t.subscription_price, t.grace_days, t.status,
              (t.subscription_end - CURRENT_DATE)::int AS days_left,
              EXISTS (SELECT 1 FROM subscription_invoices i
                       WHERE i.tenant_id = t.id AND i.period_start > t.subscription_end - 1 AND i.status <> 'void') AS invoiced
         FROM tenants t
        WHERE t.status <> 'archived' AND t.subscription_end IS NOT NULL
          AND t.subscription_end <= CURRENT_DATE + 45
        ORDER BY t.subscription_end`),
  })));
}));

r.post("/invoices", handle(async (req, res) => {
  const b = parse(invoiceSchema, req.body);
  if (b.period_end <= b.period_start) throw badRequest("نهاية المدة يجب أن تكون بعد بدايتها");
  const row = await platform(req, async (q) => {
    const [tn] = await q("SELECT id FROM tenants WHERE id = $1", [b.tenant_id]);
    if (!tn) throw notFound("المدرسة غير موجودة");
    const [inv] = await q(
      `INSERT INTO subscription_invoices (tenant_id, period_start, period_end, amount, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.tenant_id, b.period_start, b.period_end, b.amount, b.note]);
    return inv;
  });
  res.status(201).json(row);
}));

// تسجيل السداد: يمدد الاشتراك تلقائيًا إلى نهاية المدة ويعيد تفعيل المدرسة
r.post("/invoices/:id/pay", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(paySchema, req.body);
  await platform(req, async (q) => {
    const [inv] = await q("SELECT * FROM subscription_invoices WHERE id = $1 FOR UPDATE", [id]);
    if (!inv) throw notFound("الفاتورة غير موجودة");
    if (inv.status !== "open") throw badRequest("الفاتورة ليست مفتوحة");
    await q("UPDATE subscription_invoices SET status = 'paid', paid_at = now(), method = $2, note = COALESCE($3, note) WHERE id = $1",
      [id, b.method, b.note]);
    await q(
      `UPDATE tenants SET subscription_end = GREATEST(COALESCE(subscription_end, CURRENT_DATE), $2::date),
              status = CASE WHEN status = 'suspended' AND auto_suspended_at IS NOT NULL THEN 'active' ELSE status END,
              auto_suspended_at = NULL
        WHERE id = $1`, [inv.tenant_id, inv.period_end]);
    // السداد يمدد الاشتراك الحالي ويعيده فعّالًا (بنفس بيانات المدرسة)
    const [sub] = await q(
      `UPDATE subscriptions s SET ends_on = GREATEST(COALESCE(s.ends_on, CURRENT_DATE), $2::date),
              status = CASE WHEN s.status IN ('expired', 'trial_expired', 'pending_payment', 'trial') THEN 'active' ELSE s.status END,
              kind = CASE WHEN s.kind = 'trial' THEN 'paid' ELSE s.kind END
         FROM tenants t WHERE t.id = $1 AND s.id = t.subscription_id RETURNING s.id`, [inv.tenant_id, inv.period_end]);
    if (sub) await q(`INSERT INTO subscription_events (tenant_id, subscription_id, event, details, actor)
                      VALUES ($1, $2, 'paid', jsonb_build_object('invoice', $3::bigint, 'until', $4::date), $5)`,
      [inv.tenant_id, sub.id, id, inv.period_end, req.actor]);
  });
  res.json({ ok: true });
}));

r.post("/invoices/:id/void", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await platform(req, async (q) => {
    const rows = await q("UPDATE subscription_invoices SET status = 'void' WHERE id = $1 AND status = 'open' RETURNING id", [id]);
    if (!rows.length) throw notFound("الفاتورة غير موجودة أو مسددة");
  });
  res.json({ ok: true });
}));

// إصدار فواتير التجديد دفعة واحدة لكل الاشتراكات المنتهية خلال 30 يومًا
r.post("/run-renewals", handle(async (req, res) => {
  const created = await platform(req, async (q) => {
    const due = await q(
      `SELECT t.id, t.subscription_end, t.subscription_price FROM tenants t
        WHERE t.status = 'active' AND t.subscription_end IS NOT NULL AND t.subscription_end <= CURRENT_DATE + 30
          AND NOT EXISTS (SELECT 1 FROM subscription_invoices i
                           WHERE i.tenant_id = t.id AND i.period_start = t.subscription_end AND i.status <> 'void')`);
    const out = [];
    for (const t2 of due) {
      const [inv] = await q(
        `INSERT INTO subscription_invoices (tenant_id, period_start, period_end, amount, note)
         VALUES ($1, $2, ($2::date + interval '1 year')::date, $3, 'تجديد سنوي')
         ON CONFLICT (tenant_id, period_start) DO NOTHING RETURNING id`,
        [t2.id, t2.subscription_end, t2.subscription_price]);
      if (inv) out.push({ tenant_id: t2.id, invoice: inv.id });
    }
    return out;
  });
  res.json({ created: created.length, invoices: created });
}));

// إيقاف المدارس التي انتهت مدة سماحها (يُنفَّذ تلقائيًا كل ساعة أيضًا)
r.post("/suspend-expired", handle(async (req, res) => {
  const rows = await platform(req, (q) => q("SELECT * FROM suspend_expired_tenants()"));
  res.json({ suspended: rows });
}));

export default r;
