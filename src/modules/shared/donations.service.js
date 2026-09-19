// التبرعات: تُسجَّل مع مصدرها وتظهر كإيراد مستقل عن الرسوم
import { z, t } from "../../core/http/validate.js";
import { notFound } from "../../core/http/errors.js";
import { addSystemEntry } from "./ledger.service.js";

export const donationSchema = z.object({
  donor_name: t.optText(120),
  anonymous: z.boolean().default(false),
  phone: t.phone,
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر").max(100_000_000).multipleOf(0.01),
  purpose: t.optText(200),
  method: z.enum(["cash", "transfer", "card", "online"]),
  reference: t.optText(80),
  received_on: t.date,
  note: t.optText(300),
}).refine((b) => b.anonymous || (b.donor_name && b.donor_name.length >= 2), {
  message: "اكتب اسم المتبرع أو اجعل التبرع باسم مجهول", path: ["donor_name"],
});

export const list = (q, { from = null, to = null } = {}) => q(
  `SELECT d.id, d.donor_name, d.anonymous, d.phone, d.amount, d.purpose, d.method, d.reference,
          d.received_on, d.note, d.created_by, e.entry_no, e.status
     FROM donations d LEFT JOIN finance_entries e ON e.id = d.entry_id
    WHERE ($1::date IS NULL OR d.received_on >= $1) AND ($2::date IS NULL OR d.received_on <= $2)
    ORDER BY d.received_on DESC, d.id DESC LIMIT 500`, [from, to]);

export async function add(q, b, actor) {
  const donor = b.anonymous ? "متبرع مجهول" : b.donor_name;
  const entry = await addSystemEntry(q, {
    direction: "income", amount: b.amount, method: b.method, occurredOn: b.received_on,
    reason: b.purpose ? `تبرع: ${b.purpose}` : "تبرع للمدرسة",
    beneficiary: donor, reference: b.reference, categoryCode: "donation",
    sourceType: "donation", sourceId: null, actor,
  });
  const [row] = await q(
    `INSERT INTO donations (tenant_id, donor_name, anonymous, phone, amount, purpose, method, reference,
        received_on, entry_id, note, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [b.anonymous ? null : b.donor_name, b.anonymous, b.phone, b.amount, b.purpose, b.method, b.reference,
     b.received_on, entry?.id ?? null, b.note, actor]);
  if (entry) await q("UPDATE finance_entries SET source_id = $2 WHERE id = $1", [entry.id, row.id]);
  return { ...row, entry_no: entry?.entry_no ?? null };
}

export async function get(q, id) {
  const [d] = await q("SELECT * FROM donations WHERE id = $1", [id]);
  if (!d) throw notFound("التبرع غير موجود");
  return d;
}
