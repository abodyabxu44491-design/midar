/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest, conflict, forbidden, notFound } from "../../core/http/errors.js";
import { t, z } from "../../core/http/validate.js";
import { addEntry } from "./ledger.service.js";
import { notify } from "./notify.service.js";

export const KINDS = { advance: "سلفة لموظف", purchase: "شراء مستلزمات", maintenance: "صيانة", other: "طلب آخر" };
export const STATUSES = { pending: "بانتظار المراجعة", approved: "معتمد بانتظار الصرف", rejected: "مرفوض", paid: "تم الصرف", canceled: "ملغى" };

export const createSchema = z.object({
  kind: z.enum(Object.keys(KINDS)),
  title: t.shortText("عنوان الطلب", 150),
  details: t.optText(1000),
  amount: z.coerce.number().positive("اكتب المبلغ").max(100_000_000),
  beneficiary: t.optText(120),
  teacher_id: t.optId,
});
export const decideSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: t.optText(300),
  approved_amount: z.union([z.coerce.number().positive().max(100_000_000), z.literal(""), z.null()]).optional().transform((v) => (v === "" ? null : v)),
}).refine((b) => b.decision !== "reject" || (b.note || "").trim().length >= 3, "اكتب سبب الرفض");
export const paySchema = z.object({
  account_id: t.id,
  category_id: t.optId,
  method: z.enum(["cash", "transfer", "card", "online"]).default("cash"),
  reference: t.optText(80),
  occurred_on: t.optDate,
  rate: z.coerce.number().positive().optional(),
});

// Who may do what: every admin can ask; finance approval belongs to full admins and accountants with the approval permission.
export function powers(user) {
  const fullAdmin = user.role === "admin" && (user.admin_scope || "full") === "full";
  return {
    create: user.role === "admin",
    decide: fullAdmin || (user.role === "accountant" && user.can_approve_finance),
    pay: fullAdmin || (user.role === "accountant" && user.can_approve_finance),
  };
}

const SELECT = `SELECT r.*, tc.full_name AS teacher_name, e.entry_no
  FROM finance_requests r LEFT JOIN teachers tc ON tc.id = r.teacher_id LEFT JOIN finance_entries e ON e.id = r.entry_id`;

export async function list(q, { status } = {}) {
  const rows = await q(`${SELECT} WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.status IN ('pending', 'approved')) DESC, r.requested_at DESC LIMIT 300`,
    [status || null]);
  const [counts] = await q(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'approved')::int AS approved,
                                   COALESCE(sum(COALESCE(approved_amount, amount)) FILTER (WHERE status = 'approved'), 0) AS to_pay
                              FROM finance_requests`);
  return { items: rows, counts };
}

export async function getOne(q, id, lock = false) {
  const [r] = await q(`${SELECT} WHERE r.id = $1${lock ? " FOR UPDATE OF r" : ""}`, [id]);
  if (!r) throw notFound("الطلب غير موجود");
  return r;
}

async function financeUsers(q) {
  return (await q(`SELECT id FROM users WHERE is_active AND ((role = 'accountant' AND can_approve_finance) OR (role = 'admin' AND admin_scope = 'full'))`)).map((u) => u.id);
}

export async function create(q, b, user, actor) {
  if (b.teacher_id) {
    const [tc] = await q("SELECT id FROM teachers WHERE id = $1", [b.teacher_id]);
    if (!tc) throw notFound("المعلم غير موجود");
  }
  const [{ n }] = await q("SELECT next_counter('finance_request') AS n");
  const no = `R-${String(n).padStart(5, "0")}`;
  const [row] = await q(
    `INSERT INTO finance_requests (tenant_id, request_no, kind, title, details, amount, beneficiary, teacher_id, requested_by, requested_by_id)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, request_no`,
    [no, b.kind, b.title, b.details ?? null, b.amount, b.beneficiary ?? null, b.teacher_id ?? null, actor, user.id]);
  await notify(q, { event: "request", users: (await financeUsers(q)).filter((x) => Number(x) !== Number(user.id)),
    title: `طلب مالي جديد ${no}`, body: `${KINDS[b.kind]}: ${b.title} — ${b.amount}`, link: "finance-requests", dedupKey: `freq:${row.id}` }).catch(() => {});
  return row;
}

export async function cancel(q, id, user, actor) {
  const r = await getOne(q, id, true);
  if (r.status !== "pending") throw conflict("لا يُلغى إلا طلب بانتظار المراجعة");
  if (Number(r.requested_by_id) !== Number(user.id) && !powers(user).decide) throw forbidden("يلغي الطلب صاحبه أو من يملك الاعتماد");
  await q("UPDATE finance_requests SET status = 'canceled', decided_by = $2, decided_at = now() WHERE id = $1", [id, actor]);
}

export async function decide(q, id, b, actor) {
  const r = await getOne(q, id, true);
  if (r.status !== "pending") throw conflict("تمت مراجعة هذا الطلب مسبقًا");
  if (b.decision === "approve" && b.approved_amount && b.approved_amount > Number(r.amount)) throw badRequest("المبلغ المعتمد أكبر من المطلوب");
  await q(`UPDATE finance_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, approved_amount = $5 WHERE id = $1`,
    [id, b.decision === "approve" ? "approved" : "rejected", actor, b.note ?? null, b.decision === "approve" ? (b.approved_amount ?? r.amount) : null]);
  if (r.requested_by_id) {
    await notify(q, { event: "request", users: [r.requested_by_id], title: `${b.decision === "approve" ? "اعتُمد" : "رُفض"} الطلب ${r.request_no}`,
      body: b.decision === "approve" ? `${r.title} — بانتظار الصرف` : `${r.title}: ${b.note}`, link: "finance-requests", dedupKey: `freqd:${id}` }).catch(() => {});
  }
}

export async function pay(q, id, b, actor) {
  const r = await getOne(q, id, true);
  if (r.status !== "approved") throw conflict(r.status === "paid" ? "صُرف هذا الطلب مسبقًا" : "لا يُصرف إلا طلب معتمد");
  let categoryId = b.category_id;
  if (!categoryId) {
    const [c] = await q("SELECT id FROM finance_categories WHERE direction = 'expense' AND is_active ORDER BY (code IS NULL), id LIMIT 1");
    categoryId = c?.id;
  }
  if (!categoryId) throw badRequest("اختر تصنيف المصروف");
  const amount = Number(r.approved_amount ?? r.amount);
  const entry = await addEntry(q, {
    direction: "expense", amount, account_id: b.account_id, category_id: categoryId,
    occurred_on: b.occurred_on || new Date().toISOString().slice(0, 10),
    reason: `صرف الطلب ${r.request_no}: ${r.title}`.slice(0, 300), beneficiary: r.beneficiary || r.teacher_name || null,
    method: b.method, reference: b.reference ?? null, attachment: null, note: `طلبه ${r.requested_by} واعتمده ${r.decided_by}`.slice(0, 300), rate: b.rate,
  }, { actor, sourceType: "request", sourceId: id, status: "approved" });
  await q("UPDATE finance_requests SET status = 'paid', paid_by = $2, paid_at = now(), entry_id = $3 WHERE id = $1", [id, actor, entry.id]);
  if (r.requested_by_id) {
    await notify(q, { event: "request", users: [r.requested_by_id], title: `صُرف الطلب ${r.request_no}`, body: `${r.title} — سند ${entry.entry_no}`,
      link: "finance-requests", dedupKey: `freqp:${id}` }).catch(() => {});
  }
  return { entry_no: entry.entry_no };
}
