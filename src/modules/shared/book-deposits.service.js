/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest, conflict, notFound } from "../../core/http/errors.js";
import { t, z } from "../../core/http/validate.js";
import { addEntry, baseCurrency } from "./ledger.service.js";

export const CONDITIONS = { good: "سليم", damaged: "تالف", lost: "مفقود" };
export const STATUSES = { held: "محتجز", refunded: "مسترد كاملًا", partial: "مسترد جزئيًا", forfeited: "مصادر" };
const FUND = "صندوق تأمين الكتب";

export const issueSchema = z.object({
  student_id: t.id,
  book_id: t.optId,
  book_title: t.optText(200),
  amount: z.coerce.number().positive("اكتب مبلغ التأمين").max(10_000_000),
  method: z.enum(["cash", "transfer", "card", "online"]).prefault("cash"),
  due_on: t.optDate,
  note: t.optText(300),
}).refine((b) => b.book_id || (b.book_title || "").trim(), "اختر الكتاب أو اكتب اسمه");
export const returnSchema = z.object({
  condition: z.enum(Object.keys(CONDITIONS)),
  refund_amount: z.coerce.number().min(0).max(10_000_000),
  deduction_reason: t.optText(300),
  method: z.enum(["cash", "transfer", "card", "online"]).prefault("cash"),
});

// The fund is an ordinary finance account reserved for deposits, so every movement shows in the ledger too.
export async function fund(q) {
  const [a] = await q("SELECT id, name, currency, is_active FROM finance_accounts WHERE purpose = 'book_deposits'");
  if (a) {
    if (!a.is_active) await q("UPDATE finance_accounts SET is_active = true WHERE id = $1", [a.id]);
    return a;
  }
  const currency = await baseCurrency(q);
  const [same] = await q("SELECT id FROM finance_accounts WHERE name = $1", [FUND]);
  if (same) {
    const [x] = await q("UPDATE finance_accounts SET purpose = 'book_deposits', is_active = true WHERE id = $1 RETURNING id, name, currency", [same.id]);
    return x;
  }
  const [x] = await q(`INSERT INTO finance_accounts (tenant_id, name, kind, currency, note, purpose)
                       VALUES (app_tenant(), $1, 'cash', $2, 'يُودع فيه تأمين الكتب ويُصرف منه عند الإرجاع', 'book_deposits') RETURNING id, name, currency`,
    [FUND, currency]);
  return x;
}

async function category(q, direction, code, name) {
  const [c] = await q("SELECT id FROM finance_categories WHERE code = $1", [code]);
  if (c) return c.id;
  const [same] = await q("SELECT id FROM finance_categories WHERE direction = $1 AND name = $2", [direction, name]);
  if (same) { await q("UPDATE finance_categories SET code = $2 WHERE id = $1", [same.id, code]); return same.id; }
  const [x] = await q("INSERT INTO finance_categories (tenant_id, direction, name, code) VALUES (app_tenant(), $1, $2, $3) RETURNING id", [direction, name, code]);
  return x.id;
}

export async function overview(q) {
  const f = await fund(q);
  const [b] = await q(
    `SELECT COALESCE(sum(CASE WHEN direction = 'income' THEN amount ELSE -amount END), 0) AS balance
       FROM finance_entries WHERE account_id = $1 AND status = 'approved'`, [f.id]);
  const [s] = await q(`SELECT count(*) FILTER (WHERE status = 'held')::int AS held_count,
                              COALESCE(sum(amount) FILTER (WHERE status = 'held'), 0) AS held_amount,
                              COALESCE(sum(amount - refund_amount) FILTER (WHERE status <> 'held'), 0) AS deducted
                         FROM book_deposits`);
  return { fund: { ...f, balance: Number(b.balance) }, ...s };
}

export const list = (q, { status, studentId } = {}) => q(
  `SELECT d.*, s.full_name AS student_name, s.student_no, c.name AS class_name, er.entry_no AS receipt_no
     FROM book_deposits d JOIN students s ON s.id = d.student_id LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN finance_entries er ON er.id = d.receipt_entry_id
    WHERE ($1::text IS NULL OR d.status = $1) AND ($2::bigint IS NULL OR d.student_id = $2)
    ORDER BY (d.status = 'held') DESC, d.received_on DESC, d.id DESC LIMIT 500`, [status || null, studentId || null]);

export async function issue(q, b, actor) {
  const [s] = await q("SELECT id, full_name FROM students WHERE id = $1 AND archived_at IS NULL", [b.student_id]);
  if (!s) throw notFound("الطالب غير موجود");
  let title = (b.book_title || "").trim(), loanId = null;
  if (b.book_id) {
    const [book] = await q("SELECT id, title, copies FROM library_books WHERE id = $1 FOR UPDATE", [b.book_id]);
    if (!book) throw notFound("الكتاب غير موجود");
    const [{ out }] = await q("SELECT count(*)::int AS out FROM library_loans WHERE book_id = $1 AND returned_on IS NULL", [book.id]);
    if (out >= book.copies) throw conflict(`لا توجد نسخة متاحة من «${book.title}»`);
    title = book.title;
    const due = b.due_on || `${new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0)}-06-30`;
    const [loan] = await q(`INSERT INTO library_loans (tenant_id, book_id, student_id, due_on, note, created_by)
                            VALUES (app_tenant(), $1, $2, $3, 'إعارة بتأمين', $4) RETURNING id`, [book.id, s.id, due, actor]);
    loanId = loan.id;
  }
  const f = await fund(q);
  const entry = await addEntry(q, {
    direction: "income", amount: b.amount, account_id: f.id, category_id: await category(q, "income", "book_deposit", "تأمين الكتب المدرسية"),
    occurred_on: new Date().toISOString().slice(0, 10), reason: `تأمين كتاب «${title}» للطالب ${s.full_name}`.slice(0, 300),
    beneficiary: s.full_name, method: b.method, reference: null, attachment: null, note: b.note ?? null,
  }, { actor, sourceType: "book_deposit", status: "approved" });
  const [row] = await q(
    `INSERT INTO book_deposits (tenant_id, student_id, book_id, book_title, loan_id, amount, method, received_by, receipt_entry_id, note)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [s.id, b.book_id ?? null, title, loanId, b.amount, b.method, actor, entry.id, b.note ?? null]);
  await q("UPDATE finance_entries SET source_id = $2 WHERE id = $1", [entry.id, row.id]);
  return { id: row.id, receipt_no: entry.entry_no };
}

export async function settle(q, id, b, actor) {
  const [d] = await q("SELECT d.*, s.full_name AS student_name FROM book_deposits d JOIN students s ON s.id = d.student_id WHERE d.id = $1 FOR UPDATE OF d", [id]);
  if (!d) throw notFound("سجل التأمين غير موجود");
  if (d.status !== "held") throw conflict("أُغلق هذا التأمين مسبقًا");
  const refund = Math.round(Number(b.refund_amount) * 100) / 100;
  if (refund > Number(d.amount)) throw badRequest("المبلغ المسترد أكبر من التأمين");
  if (refund < Number(d.amount) && (b.deduction_reason || "").trim().length < 3) throw badRequest("اكتب سبب الخصم من التأمين");
  let entry = null;
  if (refund > 0) {
    const f = await fund(q);
    entry = await addEntry(q, {
      direction: "expense", amount: refund, account_id: f.id, category_id: await category(q, "expense", "book_deposit_refund", "رد تأمين الكتب"),
      occurred_on: new Date().toISOString().slice(0, 10), reason: `رد تأمين كتاب «${d.book_title}» للطالب ${d.student_name}`.slice(0, 300),
      beneficiary: d.student_name, method: b.method, reference: null, attachment: null,
      note: refund < Number(d.amount) ? `خصم ${Number(d.amount) - refund}: ${b.deduction_reason}`.slice(0, 300) : null,
    }, { actor, sourceType: "book_deposit", sourceId: id, status: "approved" });
  }
  const status = refund === Number(d.amount) ? "refunded" : refund === 0 ? "forfeited" : "partial";
  await q(`UPDATE book_deposits SET status = $2, returned_on = CURRENT_DATE, condition = $3, refund_amount = $4, deduction_reason = $5,
                  refunded_by = $6, refund_entry_id = $7, voucher_no = $8 WHERE id = $1`,
    [id, status, b.condition, refund, refund < Number(d.amount) ? b.deduction_reason : null, actor, entry?.id ?? null, entry?.entry_no ?? null]);
  if (d.loan_id) await q("UPDATE library_loans SET returned_on = CURRENT_DATE WHERE id = $1 AND returned_on IS NULL", [d.loan_id]);
  return { status, refund_amount: refund, voucher_no: entry?.entry_no ?? null };
}

export async function voucher(q, id) {
  const [d] = await q(
    `SELECT d.*, s.full_name AS student_name, s.student_no, c.name AS class_name, er.entry_no AS receipt_no,
            (SELECT name FROM tenants WHERE id = app_tenant()) AS school, (SELECT currency FROM tenants WHERE id = app_tenant()) AS currency
       FROM book_deposits d JOIN students s ON s.id = d.student_id LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN finance_entries er ON er.id = d.receipt_entry_id WHERE d.id = $1`, [id]);
  if (!d) throw notFound("سجل التأمين غير موجود");
  return d;
}
