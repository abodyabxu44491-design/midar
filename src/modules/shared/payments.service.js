// الحسابات البنكية وإشعارات التحويل
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { recordPayment } from "./finance.service.js";

const iban = z.string().transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/, "رقم الآيبان غير صحيح"));

export const accountSchema = z.object({
  bank_name: t.shortText("اسم البنك", 80),
  account_holder: t.shortText("اسم صاحب الحساب", 120),
  iban,
  account_number: z.string().trim().regex(/^[0-9-]{4,34}$/, "رقم الحساب غير صحيح").optional().nullable().or(z.literal("")).transform((v) => v || null),
});
export const noteSchema = z.object({ payment_note: t.optText(500) });

export const claimSchema = z.object({
  invoice_id: t.id,
  account_id: t.optId,
  amount: t.money,
  transfer_date: t.date,
  sender_name: t.name("اسم المحوِّل"),
  bank_reference: t.optText(60),
  idempotency_key: t.idemKey,
});
export const reviewSchema = z.object({
  decision: z.enum(["confirm", "reject"]),
  amount: t.money.optional(),          // المبلغ الذي وصل فعليًا (عند التأكيد)
  note: t.optText(300),
});

/* ---------- الحسابات ---------- */
export const listAccounts = (q, { activeOnly = false } = {}) => q(
  `SELECT id, bank_name, account_holder, iban, account_number, is_active FROM payment_accounts
    ${activeOnly ? "WHERE is_active" : ""} ORDER BY id`);

export async function addAccount(q, b) {
  const [r] = await q(
    `INSERT INTO payment_accounts (tenant_id, bank_name, account_holder, iban, account_number)
     VALUES (app_tenant(), $1, $2, $3, $4) RETURNING id`, [b.bank_name, b.account_holder, b.iban, b.account_number]);
  return r;
}

export async function setAccountActive(q, id, active) {
  const rows = await q("UPDATE payment_accounts SET is_active = $2 WHERE id = $1 RETURNING id", [id, active]);
  if (!rows.length) throw notFound("الحساب غير موجود");
}

/* ---------- الإشعارات ---------- */
const CLAIM_SELECT = `SELECT c.id, c.invoice_id, c.student_id, c.amount, c.transfer_date, c.sender_name, c.bank_reference,
    c.status, c.review_note, c.reviewed_by, c.reviewed_at, c.created_at,
    i.title AS invoice_title, i.amount AS invoice_amount, invoice_net_paid(i.id) AS invoice_paid,
    s.full_name AS student_name, cl.name AS class_name,
    a.bank_name, a.iban, p.receipt_no
  FROM payment_claims c
  JOIN invoices i ON i.id = c.invoice_id
  JOIN students s ON s.id = c.student_id
  LEFT JOIN classes cl ON cl.id = s.class_id
  LEFT JOIN payment_accounts a ON a.id = c.account_id
  LEFT JOIN payments p ON p.id = c.payment_id`;

export const listClaims = (q, status) => q(
  `${CLAIM_SELECT} WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.status = 'pending' DESC, c.id DESC LIMIT 300`, [status || null]);

export const claimsForStudent = (q, studentId) => q(
  `SELECT c.id, c.invoice_id, c.amount, c.transfer_date, c.status, c.review_note, c.created_at, p.receipt_no
     FROM payment_claims c LEFT JOIN payments p ON p.id = c.payment_id
    WHERE c.student_id = $1 ORDER BY c.id DESC LIMIT 50`, [studentId]);

export async function createClaim(q, student, b) {
  const [dup] = await q("SELECT id, status FROM payment_claims WHERE idempotency_key = $1", [b.idempotency_key]);
  if (dup) return { id: dup.id, status: dup.status, duplicate: true };

  const [inv] = await q(
    "SELECT id, amount, invoice_net_paid(id) AS paid FROM invoices WHERE id = $1 AND student_id = $2 AND status = 'open' FOR UPDATE",
    [b.invoice_id, student.id]);
  if (!inv) throw badRequest("الفاتورة غير موجودة");
  const [pending] = await q("SELECT count(*)::int AS n, COALESCE(sum(amount), 0) AS total FROM payment_claims WHERE invoice_id = $1 AND status = 'pending'", [inv.id]);
  const remaining = Math.round((inv.amount - inv.paid - pending.total) * 100) / 100;
  if (pending.n >= 3) throw badRequest("يوجد إشعارات بانتظار مراجعة المدرسة لهذه الفاتورة. انتظر حتى تتم مراجعتها.");
  if (remaining <= 0) throw badRequest("لا يوجد مبلغ متبقٍ على هذه الفاتورة (أو يوجد إشعار بانتظار المراجعة يغطيه)");
  if (b.amount > remaining) throw badRequest(`المبلغ أكبر من المتبقي (${remaining} ر.س)`);
  const today = new Date().toISOString().slice(0, 10);
  if (b.transfer_date > today) throw badRequest("تاريخ التحويل لا يكون في المستقبل");
  if (b.account_id) {
    const [acc] = await q("SELECT id FROM payment_accounts WHERE id = $1 AND is_active", [b.account_id]);
    if (!acc) throw badRequest("الحساب البنكي غير متاح");
  }
  const [row] = await q(
    `INSERT INTO payment_claims (tenant_id, invoice_id, student_id, account_id, amount, transfer_date, sender_name, bank_reference, idempotency_key)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status`,
    [inv.id, student.id, b.account_id, b.amount, b.transfer_date, b.sender_name, b.bank_reference, b.idempotency_key]);
  return row;
}

// مراجعة الإشعار: التأكيد يسجل دفعة "تحويل" بإيصال، والإشعار والدفعة في معاملة واحدة
export async function reviewClaim(q, id, b, actor) {
  const [c] = await q("SELECT * FROM payment_claims WHERE id = $1 FOR UPDATE", [id]);
  if (!c) throw notFound("الإشعار غير موجود");
  if (c.status !== "pending") throw badRequest("تمت مراجعة هذا الإشعار مسبقًا");
  if (b.decision === "reject") {
    if (!b.note || b.note.length < 3) throw badRequest("اكتب سبب الرفض ليظهر لولي الأمر");
    await q("UPDATE payment_claims SET status = 'rejected', review_note = $2, reviewed_by = $3 WHERE id = $1", [id, b.note, actor]);
    return { status: "rejected" };
  }
  const amount = b.amount ?? c.amount;
  const paid = await recordPayment(q, {
    invoiceId: c.invoice_id, amount, method: "transfer", actor, idempotencyKey: `claim-${c.id}-confirm`,
    note: [`تحويل من ${c.sender_name}`, c.bank_reference && `مرجع ${c.bank_reference}`, `بتاريخ ${c.transfer_date}`, b.note].filter(Boolean).join(" — ").slice(0, 300),
  });
  const [p] = await q("SELECT id FROM payments WHERE receipt_no = $1", [paid.receipt]);
  await q("UPDATE payment_claims SET status = 'confirmed', payment_id = $2, reviewed_by = $3, review_note = $4 WHERE id = $1",
    [id, p.id, actor, amount !== c.amount ? `تم تأكيد ${amount} ر.س${b.note ? ` — ${b.note}` : ""}` : b.note]);
  return { status: "confirmed", receipt: paid.receipt, amount };
}
