// قوالب الرسوم والتقسيط والخصومات
// القالب يُطبَّق على صف أو شعبة أو طلاب محددين، ويُنشئ فواتير الدفعات دفعة واحدة.
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";

export const KINDS = { discount: "خصم", scholarship: "منحة", exemption: "إعفاء كامل", extra: "رسوم إضافية" };

export const planSchema = z.object({
  name: t.shortText("اسم القالب", 80),
  grade_id: t.optId,
  amount: z.coerce.number().min(0).max(10_000_000),
  installments: z.coerce.number().int().min(1).max(12).default(1),
  first_due: t.optDate,
  interval_months: z.coerce.number().int().min(1).max(12).default(1),
  note: t.optText(300),
});

export const applySchema = z.object({
  grade_id: t.optId,
  class_ids: z.array(t.id).max(200).optional(),
  student_ids: z.array(t.id).max(2000).optional(),
  dry_run: z.boolean().default(false),
});

export const adjustmentSchema = z.object({
  student_id: t.id,
  kind: z.enum(["discount", "scholarship", "exemption", "extra"]),
  percent: z.coerce.number().min(0.01).max(100).optional(),
  amount: z.coerce.number().min(0.01).max(10_000_000).optional(),
  note: t.optText(200),
});

/* ---------- القوالب ---------- */
export const listPlans = (q) => q(
  `SELECT p.id, p.name, p.grade_id, g.name AS grade_name, p.amount, p.installments, p.first_due,
          p.interval_months, p.note, p.is_active,
          (SELECT count(DISTINCT i.student_id) FROM invoices i WHERE i.plan_id = p.id)::int AS students
     FROM fee_plans p LEFT JOIN grades g ON g.id = p.grade_id
    ORDER BY p.is_active DESC, p.id DESC`);

export async function addPlan(q, b) {
  const [dup] = await q("SELECT 1 FROM fee_plans WHERE name = $1", [b.name]);
  if (dup) throw conflict("يوجد قالب بنفس الاسم");
  const [row] = await q(
    `INSERT INTO fee_plans (tenant_id, name, grade_id, amount, installments, first_due, interval_months, term_id, note)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, current_term(), $7) RETURNING id, name`,
    [b.name, b.grade_id ?? null, b.amount, b.installments, b.first_due ?? null, b.interval_months, b.note ?? null]);
  return row;
}

export async function updatePlan(q, id, b) {
  const rows = await q(
    `UPDATE fee_plans SET name = COALESCE($2, name), grade_id = $3, amount = COALESCE($4, amount),
        installments = COALESCE($5, installments), first_due = $6, interval_months = COALESCE($7, interval_months),
        note = $8, is_active = COALESCE($9, is_active)
      WHERE id = $1 RETURNING id`,
    [id, b.name ?? null, b.grade_id ?? null, b.amount ?? null, b.installments ?? null, b.first_due ?? null,
     b.interval_months ?? null, b.note ?? null, b.is_active ?? null]);
  if (!rows.length) throw notFound("القالب غير موجود");
}

/* ---------- الخصومات ---------- */
export const listAdjustments = (q, studentId = null) => q(
  `SELECT a.id, a.student_id, s.full_name AS student_name, a.kind, a.percent, a.amount, a.note, a.created_by, a.created_at
     FROM fee_adjustments a JOIN students s ON s.id = a.student_id
    WHERE ($1::bigint IS NULL OR a.student_id = $1) ORDER BY a.id DESC LIMIT 500`, [studentId]);

export async function addAdjustment(q, b, actor) {
  if (b.kind !== "exemption" && !b.percent && !b.amount) throw badRequest("حدد نسبة أو مبلغًا");
  const [student] = await q("SELECT id FROM students WHERE id = $1 AND status = 'active'", [b.student_id]);
  if (!student) throw notFound("الطالب غير موجود");
  const [row] = await q(
    `INSERT INTO fee_adjustments (tenant_id, student_id, kind, percent, amount, note, created_by)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id`,
    [b.student_id, b.kind, b.percent ?? null, b.amount ?? null, b.note ?? null, actor]);
  return row;
}

export const removeAdjustment = async (q, id) => {
  const rows = await q("DELETE FROM fee_adjustments WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) throw notFound("السجل غير موجود");
};

/** صافي مبلغ الطالب بعد الخصومات والإضافات */
export function netAmount(base, adjustments) {
  let amount = Number(base);
  for (const a of adjustments) {
    if (a.kind === "exemption") return 0;
    const value = a.percent ? (Number(base) * Number(a.percent)) / 100 : Number(a.amount);
    amount += a.kind === "extra" ? value : -value;
  }
  return Math.max(0, Math.round(amount * 100) / 100);
}

const addMonths = (dateStr, months) => {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

/**
 * تطبيق القالب: فاتورة لكل دفعة لكل طالب، مع خصم الطالب إن وُجد.
 * لا يتكرر: إعادة التطبيق تُنشئ الناقص فقط (قيد فريد في قاعدة البيانات).
 */
export async function applyPlan(q, planId, b, actor) {
  const [plan] = await q("SELECT * FROM fee_plans WHERE id = $1 AND is_active", [planId]);
  if (!plan) throw notFound("القالب غير موجود أو موقوف");

  const gradeId = b.grade_id ?? plan.grade_id;
  const students = await q(
    `SELECT s.id, s.full_name AS name, s.fees_enabled FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.status = 'active'
        AND ($1::bigint IS NULL OR c.grade_id = $1)
        AND ($2::bigint[] IS NULL OR s.class_id = ANY($2))
        AND ($3::bigint[] IS NULL OR s.id = ANY($3))
      ORDER BY s.full_name`,
    [gradeId ?? null, b.class_ids?.length ? b.class_ids : null, b.student_ids?.length ? b.student_ids : null]);
  if (!students.length) throw badRequest("لا يوجد طلاب مطابقون لهذا الاختيار");

  const adjustments = await q("SELECT student_id, kind, percent, amount FROM fee_adjustments");
  const byStudent = new Map();
  for (const a of adjustments) {
    const key = Number(a.student_id);
    byStudent.set(key, [...(byStudent.get(key) || []), a]);
  }

  const installments = plan.installments;
  const firstDue = plan.first_due || new Date().toISOString().slice(0, 10);
  const preview = students.map((s) => {
    const total = netAmount(plan.amount, byStudent.get(Number(s.id)) || []);
    const each = Math.round((total / installments) * 100) / 100;
    return { student_id: s.id, name: s.name, total, per_installment: each, exempt: total === 0 };
  });

  if (b.dry_run) return { students: preview.length, invoices: 0, skipped: 0, preview };

  let created = 0, skipped = 0;
  for (const p of preview) {
    if (p.exempt) { skipped++; continue; }
    await q("UPDATE students SET fees_enabled = true WHERE id = $1 AND NOT fees_enabled", [p.student_id]);
    for (let n = 1; n <= installments; n++) {
      // آخر دفعة تحمل فرق التقريب
      const amount = n === installments
        ? Math.round((p.total - p.per_installment * (installments - 1)) * 100) / 100
        : p.per_installment;
      const title = installments === 1 ? plan.name : `${plan.name} — دفعة ${n} من ${installments}`;
      const due = addMonths(firstDue, (n - 1) * plan.interval_months);
      const rows = await q(
        `INSERT INTO invoices (tenant_id, student_id, title, amount, due_date, created_by, plan_id, installment_no, term_id)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, current_term())
         ON CONFLICT DO NOTHING RETURNING id`,
        [p.student_id, title, amount, due, actor, planId, n]);
      if (rows.length) created++; else skipped++;
    }
  }
  return { students: preview.length, invoices: created, skipped, preview };
}
