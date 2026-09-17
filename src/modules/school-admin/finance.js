// الرسوم: الفواتير، الدفعات النقدية، الاسترداد، الإلغاء
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as finance from "../shared/finance.service.js";
import * as payments from "../shared/payments.service.js";
import { z } from "../../core/http/validate.js";

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

r.post("/invoices/:id/refunds", handle(async (req, res) => {
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

export default r;
