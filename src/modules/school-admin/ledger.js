// المالية: الحسابات، التصنيفات، الحركات، التبرعات، الرواتب، التقارير
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as ledger from "../shared/ledger.service.js";
import * as donations from "../shared/donations.service.js";
import * as payroll from "../shared/payroll.service.js";
import { requirePermission } from "../../core/auth/guards.js";

const r = Router();
const period = z.object({
  from: t.date.optional(), to: t.date.optional(),
  direction: z.enum(["income", "expense"]).optional(),
  account_id: t.optId, category_id: t.optId,
  status: z.enum(["pending", "approved", "rejected", "void"]).optional(),
  source_type: z.enum(["manual", "fee", "refund", "donation", "salary", "expense", "withdrawal"]).optional(),
});
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

/* ---------- لوحة التحكم المالية ---------- */
r.get("/summary", handle(async (req, res) => {
  const f = parse(period, req.query);
  res.json(await inTenant(req, async (q) => {
    await ledger.ensureDefaults(q);
    return ledger.summary(q, { from: f.from || monthStart(), to: f.to || today() });
  }));
}));

/* ---------- الحسابات والصناديق ---------- */
r.get("/accounts", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => { await ledger.ensureDefaults(q); return ledger.listAccounts(q); }));
}));
r.post("/accounts", handle(async (req, res) => {
  const b = parse(ledger.accountSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => ledger.addAccount(q, b)));
}));
r.patch("/accounts/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(ledger.accountSchema, req.body);
  await inTenant(req, (q) => ledger.updateAccount(q, id, b));
  res.json({ ok: true });
}));
r.patch("/accounts/:id/active", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  await inTenant(req, (q) => ledger.setAccountActive(q, id, active));
  res.json({ ok: true });
}));

/* ---------- التصنيفات ---------- */
r.get("/categories", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => { await ledger.ensureDefaults(q); return ledger.listCategories(q); }));
}));
r.post("/categories", handle(async (req, res) => {
  const b = parse(ledger.categorySchema, req.body);
  res.status(201).json(await inTenant(req, (q) => ledger.addCategory(q, b)));
}));

/* ---------- الحركات ---------- */
r.get("/entries", handle(async (req, res) => {
  const f = parse(period, req.query);
  res.json(await inTenant(req, (q) => ledger.listEntries(q, f)));
}));

r.post("/entries", handle(async (req, res) => {
  const b = parse(ledger.entrySchema, req.body);
  const source = b.direction === "expense" ? (b.needs_approval ? "withdrawal" : "expense") : "manual";
  res.status(201).json(await inTenant(req, (q) => ledger.addEntry(q, b, {
    actor: req.actor, sourceType: source, status: b.needs_approval ? "pending" : "approved",
  })));
}));

const canApprove = requirePermission("can_approve_finance", "ليس لديك صلاحية اعتماد الحركات المالية");
const canPayroll = requirePermission("can_manage_payroll", "ليس لديك صلاحية إدارة الرواتب");

r.post("/entries/:id/review", canApprove, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(ledger.reviewSchema, req.body);
  res.json(await inTenant(req, (q) => ledger.reviewEntry(q, id, b, req.actor)));
}));

r.post("/entries/:id/void", canApprove, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(ledger.voidSchema, req.body);
  await inTenant(req, (q) => ledger.voidEntry(q, id, b.reason, req.actor));
  res.json({ ok: true });
}));

/* ---------- التبرعات ---------- */
r.get("/donations", handle(async (req, res) => {
  const f = parse(period, req.query);
  res.json(await inTenant(req, (q) => donations.list(q, f)));
}));
r.post("/donations", handle(async (req, res) => {
  const b = parse(donations.donationSchema, req.body);
  res.status(201).json(await inTenant(req, async (q) => { await ledger.ensureDefaults(q); return donations.add(q, b, req.actor); }));
}));

/* ---------- الموظفون ---------- */
r.get("/staff", handle(async (req, res) => res.json(await inTenant(req, payroll.listStaff))));
r.post("/staff", canPayroll, handle(async (req, res) => {
  const b = parse(payroll.staffSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => payroll.addStaff(q, b)));
}));
r.patch("/staff/:id", canPayroll, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(payroll.staffSchema, req.body);
  await inTenant(req, (q) => payroll.updateStaff(q, id, b));
  res.json({ ok: true });
}));
r.patch("/staff/:id/active", canPayroll, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  await inTenant(req, (q) => payroll.setStaffActive(q, id, active));
  res.json({ ok: true });
}));
r.post("/staff/import-teachers", canPayroll, handle(async (req, res) => {
  res.json({ added: await inTenant(req, payroll.importTeachers) });
}));

/* ---------- مسير الرواتب ---------- */
r.get("/payroll", handle(async (req, res) => res.json(await inTenant(req, payroll.listRuns))));
r.post("/payroll", canPayroll, handle(async (req, res) => {
  const b = parse(payroll.runSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => payroll.createRun(q, b, req.actor)));
}));
r.get("/payroll/:id/items", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => payroll.runItems(q, id)));
}));
r.patch("/payroll/:id/items/:itemId", canPayroll, handle(async (req, res) => {
  const id = parse(t.id, req.params.id), itemId = parse(t.id, req.params.itemId);
  const b = parse(payroll.itemSchema, req.body);
  res.json(await inTenant(req, (q) => payroll.updateItem(q, id, itemId, b)));
}));
r.post("/payroll/:id/approve", canPayroll, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => payroll.approveRun(q, id, req.actor));
  res.json({ ok: true });
}));
r.post("/payroll/:id/pay", canPayroll, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(payroll.paySchema, req.body);
  res.json(await inTenant(req, async (q) => { await ledger.ensureDefaults(q); return payroll.payRun(q, id, b.method, req.actor); }));
}));

export default r;
