// الرسوم: الفواتير، الدفعات النقدية، الاسترداد، الإلغاء
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as finance from "../shared/finance.service.js";
import * as payments from "../shared/payments.service.js";
import * as plans from "../shared/fee-plans.service.js";
import { z } from "../../core/http/validate.js";
import { requirePermission } from "../../core/auth/guards.js";

const r = Router();

r.get("/invoices", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({ invoices: await finance.listInvoices(q), totals: await finance.schoolTotals(q) })));
}));

r.post("/invoices", handle(async (req, res) => {
  const b = parse(finance.invoiceSchema, req.body);
  res.status(201).json({ created: await inTenant(req, (q) => finance.createInvoices(q, b, req.actor)) });
}));

r.post("/invoices/:id/payments", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(finance.paymentSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => finance.recordPayment(q, {
    invoiceId: id, amount: b.amount, method: b.method, note: b.note, idempotencyKey: b.idempotency_key, actor: req.actor,
  })));
}));

// الاسترداد يُخرج مبلغًا من الصندوق، فيحتاج صلاحية الاعتماد المالي
const canRefund = requirePermission("can_approve_finance", "الاسترداد يحتاج صلاحية اعتماد الحركات المالية");
r.post("/invoices/:id/refunds", canRefund, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(finance.refundSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => finance.recordPayment(q, {
    invoiceId: id, kind: "refund", amount: b.amount, method: "cash", note: b.note, idempotencyKey: b.idempotency_key, actor: req.actor,
  })));
}));

r.post("/invoices/:id/void", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(finance.voidSchema, req.body);
  await inTenant(req, (q) => finance.voidInvoice(q, id, b.reason));
  res.json({ ok: true });
}));

r.get("/students/:id/payments", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => finance.listPayments(q, id)));
}));

// إشعارات التحويل البنكي من أولياء الأمور
r.get("/claims", handle(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["pending", "confirmed", "rejected"]).optional() }), req.query);
  res.json(await inTenant(req, (q) => payments.listClaims(q, status)));
}));

r.post("/claims/:id/review", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(payments.reviewSchema, req.body);
  res.json(await inTenant(req, (q) => payments.reviewClaim(q, id, b, req.actor)));
}));

/* ---------- قوالب الرسوم والتقسيط ---------- */
r.get("/plans", handle(async (req, res) => res.json(await inTenant(req, plans.listPlans))));

r.post("/plans", handle(async (req, res) => {
  const b = parse(plans.planSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => plans.addPlan(q, b)));
}));

r.patch("/plans/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(plans.planSchema.partial().extend({ is_active: z.boolean().optional() }), req.body);
  await inTenant(req, (q) => plans.updatePlan(q, id, b));
  res.json({ ok: true });
}));

r.post("/plans/:id/copy", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(z.object({ name: t.shortText("اسم القالب الجديد", 80), grade_id: t.optId }), req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    const [src] = await q("SELECT * FROM fee_plans WHERE id = $1", [id]);
    if (!src) throw notFound("القالب غير موجود");
    return plans.addPlan(q, {
      name: b.name, grade_id: b.grade_id ?? src.grade_id, amount: src.amount,
      installments: src.installments, first_due: src.first_due, interval_months: src.interval_months, note: src.note,
    });
  }));
}));

r.post("/plans/:id/apply", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(plans.applySchema, req.body);
  res.json(await inTenant(req, (q) => plans.applyPlan(q, id, b, req.actor)));
}));

/* ---------- الخصومات والمنح ---------- */
r.get("/adjustments", handle(async (req, res) => {
  const studentId = req.query.student_id ? parse(t.id, req.query.student_id) : null;
  res.json(await inTenant(req, (q) => plans.listAdjustments(q, studentId)));
}));

r.post("/adjustments", handle(async (req, res) => {
  const b = parse(plans.adjustmentSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => plans.addAdjustment(q, b, req.actor)));
}));

r.delete("/adjustments/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => plans.removeAdjustment(q, id));
  res.json({ ok: true });
}));

export default r;
