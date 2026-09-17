// منطق الرسوم والمدفوعات
// القواعد الحساسة (منع الدفع الزائد، ثبات المدفوعات) مطبقة داخل قاعدة البيانات نفسها
import { z, t } from "../../core/http/validate.js";
import { notFound, badRequest } from "../../core/http/errors.js";

export const METHODS = { cash: "نقدًا", transfer: "تحويل بنكي", card: "شبكة / بطاقة", online: "دفع إلكتروني" };

export const invoiceSchema = z.object({
  target: z.enum(["student", "class"]),
  target_id: t.id,
  title: t.shortText("بند الفاتورة"),
  amount: t.money,
  due_date: t.optDate,
});
export const paymentSchema = z.object({
  amount: t.money,
  method: z.enum(["cash", "transfer", "card"]),
  note: t.optText(300),
  idempotency_key: t.idemKey,
});
export const refundSchema = z.object({
  amount: t.money,
  note: t.shortText("سبب الاسترداد", 300),
  idempotency_key: t.idemKey,
});
export const voidSchema = z.object({ reason: t.shortText("سبب الإلغاء", 300) });

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export async function studentSummary(q, studentId) {
  const [r] = await q(
    `SELECT COALESCE(SUM(i.amount), 0) AS total, COALESCE(SUM(invoice_net_paid(i.id)), 0) AS paid
       FROM invoices i WHERE i.student_id = $1 AND i.status = 'open'`, [studentId]);
  const total = round2(r.total), paid = round2(r.paid), remaining = round2(total - paid);
  return { total, paid, remaining, status: total === 0 ? "none" : remaining > 0 ? "unpaid" : "paid" };
}

export async function schoolTotals(q) {
  const [r] = await q(
    `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(invoice_net_paid(id)), 0) AS paid
       FROM invoices WHERE status = 'open'`);
  return { fees_total: round2(r.total), fees_paid: round2(r.paid), fees_remaining: round2(r.total - r.paid) };
}

export const listInvoices = (q, where = "TRUE", params = []) => q(
  `SELECT i.id, i.title, i.amount, i.due_date, i.status, i.void_reason, i.created_at, i.student_id,
          s.full_name AS student_name, c.name AS class_name, invoice_net_paid(i.id) AS paid
     FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE ${where} ORDER BY i.id DESC LIMIT 1000`, params);

export const listPayments = (q, studentId) => q(
  `SELECT p.invoice_id, p.receipt_no, p.kind, p.amount, p.method, p.note, p.created_at, i.title
     FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.student_id = $1 ORDER BY p.id DESC`, [studentId]);

export async function createInvoices(q, b, actor) {
  const students = b.target === "student"
    ? await q("SELECT id FROM students WHERE id = $1 AND archived_at IS NULL", [b.target_id])
    : await q("SELECT id FROM students WHERE class_id = $1 AND archived_at IS NULL", [b.target_id]);
  if (!students.length) throw badRequest("لا يوجد طلاب لإصدار الفاتورة لهم");
  for (const s of students) {
    await q(`INSERT INTO invoices (tenant_id, student_id, title, amount, due_date, created_by)
             VALUES (app_tenant(), $1, $2, $3, $4, $5)`, [s.id, b.title, b.amount, b.due_date, actor]);
    await q("UPDATE students SET fees_enabled = true WHERE id = $1 AND NOT fees_enabled", [s.id]);
  }
  return students.length;
}

async function nextReceipt(q) {
  const [r] = await q("SELECT next_counter('receipt') AS n");
  return `R-${String(r.n).padStart(6, "0")}`;
}

/**
 * تسجيل دفعة أو استرداد. إذا أُرسل نفس مفتاح العملية مرتين تُعاد النتيجة الأولى ولا تُسجل دفعة ثانية.
 */
export async function recordPayment(q, { invoiceId, kind = "payment", amount, method, note, idempotencyKey, actor, providerRef = null }) {
  const [dup] = await q("SELECT receipt_no, amount, invoice_id FROM payments WHERE idempotency_key = $1", [idempotencyKey]);
  if (dup) {
    if (Number(dup.invoice_id) !== Number(invoiceId)) throw badRequest("مفتاح العملية مستخدم لفاتورة أخرى");
    return { receipt: dup.receipt_no, amount: dup.amount, duplicate: true };
  }
  const [inv] = await q("SELECT id FROM invoices WHERE id = $1", [invoiceId]);
  if (!inv) throw notFound("الفاتورة غير موجودة");
  const receipt = await nextReceipt(q);
  await q(
    `INSERT INTO payments (tenant_id, invoice_id, kind, amount, method, receipt_no, idempotency_key, provider_ref, note, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [invoiceId, kind, amount, method, receipt, idempotencyKey, providerRef, note, actor]);
  return { receipt, amount };
}

export async function voidInvoice(q, invoiceId, reason) {
  const rows = await q("UPDATE invoices SET status = 'void', void_reason = $2 WHERE id = $1 AND status = 'open' RETURNING id", [invoiceId, reason]);
  if (!rows.length) throw notFound("الفاتورة غير موجودة أو ملغاة مسبقًا");
}
