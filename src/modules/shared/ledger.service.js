/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";

export const METHODS = { cash: "نقدًا", transfer: "تحويل بنكي", card: "شبكة / بطاقة", online: "دفع إلكتروني" };
export const CURRENCIES = { SAR: "ريال سعودي", YER: "ريال يمني", USD: "دولار أمريكي" };
export const KINDS = { cash: "صندوق نقدي", bank: "حساب بنكي", online: "محفظة إلكترونية", donations: "صندوق تبرعات", other: "أخرى" };
export const SOURCES = {
  manual: "قيد يدوي", fee: "رسوم دراسية", refund: "استرداد رسوم", donation: "تبرع",
  salary: "رواتب", expense: "مصروف تشغيلي", withdrawal: "سحب",
};
export const STATUSES = { pending: "بانتظار الاعتماد", approved: "معتمدة", rejected: "مرفوضة", void: "ملغاة" };

const money = z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر").max(100_000_000).multipleOf(0.01);

export const accountSchema = z.object({
  name: t.shortText("اسم الحساب", 80),
  kind: z.enum(["bank", "cash", "online", "donations", "other"]),
  currency: z.enum(["SAR", "YER", "USD"]).optional(),
  opening_balance: z.coerce.number().min(-100_000_000).max(100_000_000).default(0),
  low_balance: z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform((v) => (v === "" || v === undefined ? null : Number(v))),
  note: t.optText(300),
  methods: z.array(z.enum(["cash", "transfer", "card", "online"])).max(4).default([]),
});
export const categorySchema = z.object({
  direction: z.enum(["income", "expense"]),
  name: t.shortText("اسم التصنيف", 60),
});
export const entrySchema = z.object({
  direction: z.enum(["income", "expense"]),
  amount: money,
  account_id: t.id,
  category_id: t.id,
  occurred_on: t.date,
  reason: t.shortText("سبب الحركة", 300),
  beneficiary: t.optText(120),
  method: z.enum(["cash", "transfer", "card", "online"]).default("cash"),
  reference: t.optText(80),
  attachment: t.optText(300),
  note: t.optText(300),
  rate: z.coerce.number().positive("سعر التحويل غير صحيح").max(1_000_000).optional(),
  needs_approval: z.boolean().default(false),
});
export const transferSchema = z.object({
  from_account_id: t.id,
  to_account_id: t.id,
  amount: money,
  occurred_on: t.date,
  reason: t.shortText("سبب التحويل", 300),
  rate: z.coerce.number().positive().max(1_000_000).optional(),
  reference: t.optText(80),
}).refine((b) => b.from_account_id !== b.to_account_id, { message: "اختر حسابين مختلفين", path: ["to_account_id"] });

export const voidSchema = z.object({ reason: t.shortText("سبب الإلغاء", 300) });
export const reviewSchema = z.object({ decision: z.enum(["approve", "reject"]), note: t.optText(300) });

export const ensureDefaults = (q) => q("SELECT seed_finance_defaults()");

export async function listAccounts(q) {
  const accounts = await q(
    `SELECT a.id, a.name, a.kind, a.currency, a.opening_balance, a.low_balance, a.note, a.is_active, a.purpose,
            account_balance(a.id) AS balance
       FROM finance_accounts a ORDER BY a.is_active DESC, a.id`);
  const methods = await q("SELECT method, account_id FROM finance_method_accounts");
  return accounts.map((a) => ({ ...a, methods: methods.filter((m) => Number(m.account_id) === Number(a.id)).map((m) => m.method) }));
}

async function setMethods(q, accountId, methods) {
  for (const m of methods) {
    await q(
      `INSERT INTO finance_method_accounts (tenant_id, method, account_id) VALUES (app_tenant(), $1, $2)
       ON CONFLICT (tenant_id, method) DO UPDATE SET account_id = EXCLUDED.account_id`, [m, accountId]);
  }
}

export async function baseCurrency(q) {
  const [row] = await q("SELECT currency FROM tenants WHERE id = app_tenant()");
  return row?.currency || "SAR";
}

export async function addAccount(q, b) {
  const currency = b.currency || (await baseCurrency(q));
  const [row] = await q(
    `INSERT INTO finance_accounts (tenant_id, name, kind, currency, opening_balance, low_balance, note)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id`,
    [b.name, b.kind, currency, b.opening_balance, b.low_balance, b.note]);
  await setMethods(q, row.id, b.methods);
  return row;
}

export async function updateAccount(q, id, b) {
  const rows = await q(
    `UPDATE finance_accounts SET name = $2, kind = $3, low_balance = $4, note = $5 WHERE id = $1 RETURNING id`,
    [id, b.name, b.kind, b.low_balance, b.note]);
  if (!rows.length) throw notFound("الحساب غير موجود");
  await setMethods(q, id, b.methods);
}

export async function setAccountActive(q, id, active) {
  if (!active) {
    const [used] = await q("SELECT 1 FROM finance_method_accounts WHERE account_id = $1", [id]);
    if (used) throw badRequest("هذا الحساب مرتبط بطريقة دفع. اربط الطريقة بحساب آخر أولًا.");
  }
  const rows = await q("UPDATE finance_accounts SET is_active = $2 WHERE id = $1 RETURNING id", [id, active]);
  if (!rows.length) throw notFound("الحساب غير موجود");
}

export const listCategories = (q) => q(
  "SELECT id, direction, name, code, is_active FROM finance_categories ORDER BY direction, name");

export async function addCategory(q, b) {
  const [dup] = await q("SELECT 1 FROM finance_categories WHERE direction = $1 AND name = $2", [b.direction, b.name]);
  if (dup) throw conflict("التصنيف موجود مسبقًا");
  const [row] = await q(
    "INSERT INTO finance_categories (tenant_id, direction, name) VALUES (app_tenant(), $1, $2) RETURNING id",
    [b.direction, b.name]);
  return row;
}

export async function categoryByCode(q, code) {
  const [row] = await q("SELECT id FROM finance_categories WHERE code = $1", [code]);
  return row?.id ?? null;
}

// The fund an amount goes to (or is paid from) when the screen did not choose one: donations go to the donations
// fund; anything else to the fund set for its payment method, never to a donations fund.
async function accountForMethod(q, method, { donation = false } = {}) {
  const base = await baseCurrency(q);
  if (donation) {
    const [d] = await q("SELECT id FROM finance_accounts WHERE kind = 'donations' AND is_active AND currency = $1 ORDER BY id LIMIT 1", [base]);
    if (d) return Number(d.id);
  }
  const [row] = await q(
    `SELECT a.id FROM finance_method_accounts m JOIN finance_accounts a ON a.id = m.account_id
      WHERE m.method = $1 AND a.is_active AND a.currency = $2 AND (a.kind <> 'donations' OR $3)`, [method, base, donation]);
  if (row) return Number(row.id);
  const [any] = await q(
    `SELECT id FROM finance_accounts WHERE is_active AND currency = $1 AND kind <> 'donations'
      ORDER BY (kind = CASE WHEN $2 = 'cash' THEN 'cash' ELSE 'bank' END) DESC, id LIMIT 1`, [base, method]);
  return any ? Number(any.id) : null;
}

// The usual fund for each kind of amount, shown pre-selected (and changeable) on every money screen.
export async function fundChoices(q) {
  await ensureDefaults(q);
  const base = await baseCurrency(q);
  const funds = await q(
    `SELECT id, name, kind, currency, account_balance(id) AS balance FROM finance_accounts
      WHERE is_active AND currency = $1 AND purpose IS NULL ORDER BY id`, [base]);
  const defaults = {};
  for (const m of Object.keys(METHODS)) defaults[m] = await accountForMethod(q, m);
  defaults.donation = await accountForMethod(q, "cash", { donation: true });
  return { funds, defaults, kinds: KINDS };
}

// Sets the usual fund for each payment method in one place.
export const defaultsSchema = z.object({ cash: t.optId, transfer: t.optId, card: t.optId, online: t.optId });
export async function setDefaults(q, b) {
  for (const [method, id] of Object.entries(b)) {
    if (!id) continue;
    await fundFor(q, id);
    await setMethods(q, id, [method]);
  }
}

// A fund chosen on a screen: it must exist, be active, and be in the school's currency.
async function fundFor(q, id) {
  const [a] = await q("SELECT id, name, is_active, currency, purpose FROM finance_accounts WHERE id = $1", [id]);
  if (!a) throw notFound("الصندوق أو الحساب غير موجود");
  if (!a.is_active) throw badRequest(`«${a.name}» موقوف. اختر صندوقًا آخر.`);
  if (a.currency !== (await baseCurrency(q))) throw badRequest(`«${a.name}» بعملة مختلفة. سجّل هذه الحركة يدويًا مع سعر التحويل، أو اختر صندوقًا بعملة المدرسة.`);
  if (a.purpose) throw badRequest(`«${a.name}» مخصص لغرض محدد ولا تُسجَّل فيه هذه الحركة.`);
  return Number(a.id);
}

async function nextEntryNo(q) {
  const [r] = await q("SELECT next_counter('finance') AS n");
  return `F-${String(r.n).padStart(6, "0")}`;
}

export async function addEntry(q, b, { actor, sourceType = "manual", sourceId = null, status = "approved" }) {
  const [account] = await q(
    `SELECT id, is_active, currency FROM finance_accounts WHERE id = $1 ${b.direction === "expense" ? "FOR UPDATE" : ""}`, [b.account_id]);
  if (!account) throw notFound("الحساب غير موجود");
  if (!account.is_active) throw badRequest("هذا الحساب موقوف");
  const [category] = await q("SELECT id, direction FROM finance_categories WHERE id = $1", [b.category_id]);
  if (!category) throw notFound("التصنيف غير موجود");
  if (category.direction !== b.direction) throw badRequest("التصنيف لا يطابق نوع الحركة");

  const base = await baseCurrency(q);
  const rate = account.currency === base ? 1 : Number(b.rate || 0);
  if (!(rate > 0)) throw badRequest(`اكتب سعر تحويل ${account.currency} إلى ${base}`);

  const entryNo = await nextEntryNo(q);
  const [row] = await q(
    `INSERT INTO finance_entries (tenant_id, entry_no, direction, amount, account_id, category_id, occurred_on,
        reason, beneficiary, method, reference, attachment, status, source_type, source_id, term_id, note,
        created_by, approved_by, rate)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, current_term(), $15, $16, $17, $18)
     RETURNING id, entry_no, status`,
    [entryNo, b.direction, b.amount, b.account_id, b.category_id, b.occurred_on, b.reason, b.beneficiary ?? null,
     b.method, b.reference ?? null, b.attachment ?? null, status, sourceType, sourceId, b.note ?? null,
     actor, status === "approved" ? actor : null, rate]);
  return row;
}

export async function addSystemEntry(q, { direction, amount, method, occurredOn, reason, beneficiary, reference,
  categoryCode, sourceType, sourceId, actor, accountId: chosen = null }) {
  const donation = sourceType === "donation";
  let categoryId = await categoryByCode(q, categoryCode);
  let accountId = chosen ? await fundFor(q, chosen) : await accountForMethod(q, method || "cash", { donation });
  if (!categoryId || !accountId) {
    await ensureDefaults(q);
    categoryId = await categoryByCode(q, categoryCode);
    accountId = accountId || await accountForMethod(q, method || "cash", { donation });
  }
  if (!categoryId || !accountId) {
    throw badRequest(`لا يوجد حساب نشط بعملة المدرسة (${await baseCurrency(q)}) أو تصنيف مناسب. فعّل حسابًا أو أنشئ حسابًا من الحسابات المالية ثم أعد المحاولة.`);
  }
  return addEntry(q, {
    direction, amount, account_id: accountId, category_id: categoryId,
    occurred_on: occurredOn || new Date().toISOString().slice(0, 10),
    reason, beneficiary: beneficiary ?? null, method: method || "cash", reference: reference ?? null,
    attachment: null, note: null,
  }, { actor, sourceType, sourceId, status: "approved" });
}

const ENTRY_SELECT = `SELECT e.id, e.entry_no, e.direction, e.amount, e.rate, e.amount_base, a.currency,
    e.occurred_on, e.reason, e.beneficiary,
    e.method, e.reference, e.attachment, e.status, e.source_type, e.source_id, e.note,
    e.created_by, e.approved_by, e.approved_at, e.void_reason, e.created_at,
    a.name AS account_name, c.name AS category_name, tr.name AS term_name
  FROM finance_entries e
  JOIN finance_accounts a ON a.id = e.account_id
  JOIN finance_categories c ON c.id = e.category_id
  LEFT JOIN terms tr ON tr.id = e.term_id`;

export const listEntriesRaw = (q, f = {}) => q(
  `${ENTRY_SELECT}
    WHERE ($1::date IS NULL OR e.occurred_on >= $1)
      AND ($2::date IS NULL OR e.occurred_on <= $2)
      AND ($3::text IS NULL OR e.direction = $3)
      AND ($4::bigint IS NULL OR e.account_id = $4)
      AND ($5::bigint IS NULL OR e.category_id = $5)
      AND ($6::text IS NULL OR e.status = $6)
      AND ($7::text IS NULL OR e.source_type = $7)
    ORDER BY e.occurred_on DESC, e.id DESC LIMIT 1000`,
  [f.from ?? null, f.to ?? null, f.direction ?? null, f.account_id ?? null, f.category_id ?? null,
   f.status ?? null, f.source_type ?? null]);

export async function listEntries(q, f = {}) {
  const rows = await listEntriesRaw(q, f);
  if (!rows.length) return rows;
  const files = await q(
    `SELECT id, entity_id, filename, mime FROM attachments
      WHERE entity_type = 'finance_entry' AND entity_id = ANY($1::bigint[])`,
    [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, attachments: files.filter((f2) => Number(f2.entity_id) === Number(r.id)) }));
}

export async function reviewEntry(q, id, b, actor) {
  const [e] = await q("SELECT id, status FROM finance_entries WHERE id = $1 FOR UPDATE", [id]);
  if (!e) throw notFound("الحركة غير موجودة");
  if (e.status !== "pending") throw badRequest("هذه الحركة ليست بانتظار الاعتماد");
  const status = b.decision === "approve" ? "approved" : "rejected";
  await q("UPDATE finance_entries SET status = $2, approved_by = $3, note = COALESCE($4, note) WHERE id = $1",
    [id, status, actor, b.note ?? null]);
  return { status };
}

export async function voidEntry(q, id, reason, actor) {
  const [e] = await q("SELECT id, status, source_type, transfer_group FROM finance_entries WHERE id = $1 FOR UPDATE", [id]);
  if (!e) throw notFound("الحركة غير موجودة");
  if (["void", "rejected"].includes(e.status)) throw badRequest("الحركة ملغاة مسبقًا");
  if (["fee", "refund"].includes(e.source_type)) {
    throw badRequest("حركة الرسوم تُصحَّح من تبويب الرسوم (استرداد)، وليس من السجل المالي");
  }
  if (e.source_type === "salary") {
    throw badRequest("حركة الراتب مرتبطة بمسير الرواتب ولا تُلغى منفردة. صحّحها بحركة إيراد عكسية مع ذكر السبب.");
  }

  if (e.source_type === "transfer") {
    if (!e.transfer_group) throw badRequest("هذه الحركة جزء من تحويل غير مكتمل الربط. تواصل مع الدعم.");
    const legs = await q(
      `UPDATE finance_entries SET status = 'void', void_reason = $2, approved_by = COALESCE(approved_by, $3)
        WHERE transfer_group = $1 AND status NOT IN ('void', 'rejected') RETURNING id`,
      [e.transfer_group, reason, actor]);
    return { voided: legs.length, transfer: true };
  }

  await q("UPDATE finance_entries SET status = 'void', void_reason = $2, approved_by = COALESCE(approved_by, $3) WHERE id = $1",
    [id, reason, actor]);
  return { voided: 1 };
}

export async function transfer(q, b, actor) {
  const locked = await q(
    "SELECT id, name, currency, is_active FROM finance_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
    [[b.from_account_id, b.to_account_id]]);
  const from = locked.find((a) => Number(a.id) === Number(b.from_account_id));
  const to = locked.find((a) => Number(a.id) === Number(b.to_account_id));
  if (!from || !to) throw notFound("أحد الحسابين غير موجود");
  if (!from.is_active || !to.is_active) throw badRequest("أحد الحسابين موقوف");

  const balance = Number((await q("SELECT account_balance($1) AS b", [from.id]))[0].b);
  if (balance < b.amount) throw badRequest(`رصيد ${from.name} لا يكفي (${balance})`);

  const cross = from.currency !== to.currency;
  const fx = cross ? Number(b.rate || 0) : 1;
  if (cross && !(fx > 0)) throw badRequest(`اكتب سعر تحويل ${from.currency} إلى ${to.currency}`);
  const received = Math.round(b.amount * fx * 100) / 100;

  const [{ out_id, in_id }] = await q("SELECT * FROM transfer_categories()");
  const base = await baseCurrency(q);
  const rateOf = async (account) => {
    if (account.currency === base) return 1;
    const [prev] = await q(
      `SELECT rate FROM finance_entries e JOIN finance_accounts a ON a.id = e.account_id
        WHERE a.currency = $1 ORDER BY e.id DESC LIMIT 1`, [account.currency]);
    return prev ? Number(prev.rate) : 1;
  };

  const [{ n: group }] = await q("SELECT next_counter('transfer_group') AS n");
  const outEntry = await addEntry(q, {
    direction: "expense", amount: b.amount, account_id: from.id, category_id: out_id,
    occurred_on: b.occurred_on, reason: `${b.reason} — إلى ${to.name}`, beneficiary: to.name,
    method: "transfer", reference: b.reference ?? null, attachment: null, note: null, rate: await rateOf(from),
  }, { actor, sourceType: "transfer", status: "approved" });

  const inEntry = await addEntry(q, {
    direction: "income", amount: received, account_id: to.id, category_id: in_id,
    occurred_on: b.occurred_on, reason: `${b.reason} — من ${from.name}`, beneficiary: from.name,
    method: "transfer", reference: b.reference ?? null, attachment: null, note: null, rate: await rateOf(to),
  }, { actor, sourceType: "transfer", status: "approved" });

  await q("UPDATE finance_entries SET transfer_group = $1 WHERE id = ANY($2::bigint[])", [group, [outEntry.id, inEntry.id]]);
  return { sent: { entry_no: outEntry.entry_no, amount: b.amount, currency: from.currency },
           received: { entry_no: inEntry.entry_no, amount: received, currency: to.currency } };
}

export async function summary(q, { from, to }) {
  const [totals] = await q(
    `SELECT
       COALESCE(SUM(amount_base) FILTER (WHERE direction = 'income'  AND status = 'approved' AND source_type <> 'transfer'), 0) AS income,
       COALESCE(SUM(amount_base) FILTER (WHERE direction = 'expense' AND status = 'approved' AND source_type <> 'transfer'), 0) AS expense,
       COALESCE(SUM(amount_base) FILTER (WHERE status = 'approved' AND source_type = 'fee'), 0) AS fees,
       COALESCE(SUM(amount_base) FILTER (WHERE status = 'approved' AND source_type = 'donation'), 0) AS donations,
       COALESCE(SUM(amount_base) FILTER (WHERE status = 'approved' AND source_type = 'salary'), 0) AS salaries,
       COALESCE(SUM(amount_base) FILTER (WHERE status = 'approved' AND source_type = 'withdrawal'), 0) AS withdrawals,
       COALESCE(SUM(amount_base) FILTER (WHERE status = 'approved' AND source_type = 'expense'), 0) AS operating,
       count(*) FILTER (WHERE status = 'pending')::int AS pending
     FROM finance_entries WHERE occurred_on BETWEEN $1 AND $2`, [from, to]);

  const byCategory = await q(
    `SELECT c.direction, c.name, COALESCE(SUM(e.amount_base), 0) AS total
       FROM finance_entries e JOIN finance_categories c ON c.id = e.category_id
      WHERE e.status = 'approved' AND e.source_type <> 'transfer' AND e.occurred_on BETWEEN $1 AND $2
      GROUP BY c.direction, c.name ORDER BY 3 DESC`, [from, to]);

  const byMonth = await q(
    `SELECT to_char(occurred_on, 'YYYY-MM') AS month,
            COALESCE(SUM(amount_base) FILTER (WHERE direction = 'income'), 0) AS income,
            COALESCE(SUM(amount_base) FILTER (WHERE direction = 'expense'), 0) AS expense
       FROM finance_entries WHERE status = 'approved' AND source_type <> 'transfer'
        AND occurred_on > CURRENT_DATE - interval '12 months'
      GROUP BY 1 ORDER BY 1`);

  const accounts = await listAccounts(q);
  const base = await baseCurrency(q);
  const balance = accounts.filter((a) => a.is_active && a.currency === base)
    .reduce((sum, a) => sum + Number(a.balance), 0);

  const [unpaid] = await q(
    `SELECT COALESCE(SUM(amount - invoice_net_paid(id)), 0) AS remaining,
            count(*) FILTER (WHERE due_date < CURRENT_DATE AND amount > invoice_net_paid(id))::int AS overdue
       FROM invoices WHERE status = 'open'`);

  const n = (v) => Math.round(Number(v) * 100) / 100;
  return {
    period: { from, to },
    currency: base,
    income: n(totals.income), expense: n(totals.expense), net: n(totals.income - totals.expense),
    fees: n(totals.fees), donations: n(totals.donations), salaries: n(totals.salaries),
    withdrawals: n(totals.withdrawals), operating: n(totals.operating),
    pending: totals.pending,
    balance: n(balance),
    unpaid_fees: n(unpaid.remaining), overdue_invoices: unpaid.overdue,
    accounts, by_category: byCategory.map((c) => ({ ...c, total: n(c.total) })),
    by_month: byMonth.map((m) => ({ ...m, income: n(m.income), expense: n(m.expense) })),
  };
}
