// الموظفون والرواتب: مسير شهري باعتماد، وصرفه يُنشئ حركات مالية
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { addSystemEntry } from "./ledger.service.js";

export const CATEGORIES = { teacher: "معلم", admin: "إداري", worker: "عامل", other: "أخرى" };

export const staffSchema = z.object({
  full_name: t.name("اسم الموظف"),
  job_title: t.optText(80),
  category: z.enum(["teacher", "admin", "worker", "other"]).default("other"),
  phone: t.phone,
  iban: z.string().trim().transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/, "رقم الآيبان غير صحيح")).optional().or(z.literal("")).transform((v) => v || null),
  base_salary: z.coerce.number().min(0).max(1_000_000).default(0),
  teacher_id: t.optId,
});
export const runSchema = z.object({
  period: t.date,                       // أي يوم في الشهر المطلوب
  note: t.optText(300),
});
export const itemSchema = z.object({
  allowances: z.coerce.number().min(0).max(1_000_000).default(0),
  bonus: z.coerce.number().min(0).max(1_000_000).default(0),
  deductions: z.coerce.number().min(0).max(1_000_000).default(0),
  advances: z.coerce.number().min(0).max(1_000_000).default(0),
  note: t.optText(200),
});
export const paySchema = z.object({ method: z.enum(["cash", "transfer", "card", "online"]).default("transfer") });

export const listStaff = (q) => q(
  `SELECT s.id, s.full_name, s.job_title, s.category, s.phone, s.iban, s.base_salary, s.is_active, s.teacher_id
     FROM staff s ORDER BY s.is_active DESC, s.full_name`);

export async function addStaff(q, b) {
  const [row] = await q(
    `INSERT INTO staff (tenant_id, full_name, job_title, category, phone, iban, base_salary, teacher_id)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [b.full_name, b.job_title, b.category, b.phone, b.iban, b.base_salary, b.teacher_id]);
  return row;
}

export async function updateStaff(q, id, b) {
  const rows = await q(
    `UPDATE staff SET full_name = $2, job_title = $3, category = $4, phone = $5, iban = $6, base_salary = $7
      WHERE id = $1 RETURNING id`, [id, b.full_name, b.job_title, b.category, b.phone, b.iban, b.base_salary]);
  if (!rows.length) throw notFound("الموظف غير موجود");
}

export async function setStaffActive(q, id, active) {
  const rows = await q("UPDATE staff SET is_active = $2 WHERE id = $1 RETURNING id", [id, active]);
  if (!rows.length) throw notFound("الموظف غير موجود");
}

// إضافة المعلمين المسجلين كموظفين بضغطة (بدون تكرار)
export async function importTeachers(q) {
  const rows = await q(
    `INSERT INTO staff (tenant_id, full_name, job_title, category, phone, teacher_id)
     SELECT app_tenant(), t.full_name, 'معلم', 'teacher', t.phone, t.id FROM teachers t
      WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.teacher_id = t.id)
     RETURNING id`);
  return rows.length;
}

export const listRuns = (q) => q(
  `SELECT r.id, r.period, r.status, r.note, r.created_by, r.approved_by, r.paid_at, r.created_at,
          COALESCE(SUM(i.net), 0) AS total, count(i.id)::int AS employees
     FROM payroll_runs r LEFT JOIN payroll_items i ON i.run_id = r.id
    GROUP BY r.id ORDER BY r.period DESC LIMIT 60`);

export const runItems = (q, runId) => q(
  `SELECT i.id, i.staff_id, s.full_name, s.job_title, s.category, i.base, i.allowances, i.bonus,
          i.deductions, i.advances, i.net, i.note, e.entry_no
     FROM payroll_items i JOIN staff s ON s.id = i.staff_id
     LEFT JOIN finance_entries e ON e.id = i.entry_id
    WHERE i.run_id = $1 ORDER BY s.full_name`, [runId]);

// إنشاء مسير الشهر لكل الموظفين النشطين برواتبهم الأساسية
export async function createRun(q, b, actor) {
  const period = `${b.period.slice(0, 7)}-01`;
  const [dup] = await q("SELECT id FROM payroll_runs WHERE period = $1", [period]);
  if (dup) throw conflict("يوجد مسير رواتب لهذا الشهر");
  const [run] = await q(
    "INSERT INTO payroll_runs (tenant_id, period, note, created_by) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
    [period, b.note, actor]);
  const staff = await q("SELECT id, base_salary FROM staff WHERE is_active");
  if (!staff.length) throw badRequest("لا يوجد موظفون نشطون. أضف الموظفين أولًا.");
  for (const s of staff) {
    await q("INSERT INTO payroll_items (tenant_id, run_id, staff_id, base) VALUES (app_tenant(), $1, $2, $3)",
      [run.id, s.id, s.base_salary]);
  }
  return { id: run.id, employees: staff.length };
}

async function getRun(q, id, lock = false) {
  const [run] = await q(`SELECT * FROM payroll_runs WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  if (!run) throw notFound("مسير الرواتب غير موجود");
  return run;
}

export async function updateItem(q, runId, itemId, b) {
  const run = await getRun(q, runId);
  if (run.status !== "draft") throw badRequest("لا يمكن التعديل بعد اعتماد المسير");
  const rows = await q(
    `UPDATE payroll_items SET allowances = $3, bonus = $4, deductions = $5, advances = $6, note = $7
      WHERE id = $2 AND run_id = $1 RETURNING net`,
    [runId, itemId, b.allowances, b.bonus, b.deductions, b.advances, b.note]);
  if (!rows.length) throw notFound("السطر غير موجود");
  return rows[0];
}

export async function approveRun(q, runId, actor) {
  const run = await getRun(q, runId, true);
  if (run.status !== "draft") throw badRequest("المسير معتمد مسبقًا");
  await q("UPDATE payroll_runs SET status = 'approved', approved_by = $2 WHERE id = $1", [runId, actor]);
}

// الصرف: حركة مصروف لكل موظف مرتبطة بسطره في المسير
export async function payRun(q, runId, method, actor) {
  const run = await getRun(q, runId, true);
  if (run.status === "paid") throw badRequest("المسير مصروف مسبقًا");
  if (run.status !== "approved") throw badRequest("اعتمد المسير قبل الصرف");
  const items = await q(
    `SELECT i.id, i.net, s.full_name FROM payroll_items i JOIN staff s ON s.id = i.staff_id
      WHERE i.run_id = $1 AND i.entry_id IS NULL AND i.net > 0`, [runId]);
  const month = String(run.period).slice(0, 7);
  for (const item of items) {
    const entry = await addSystemEntry(q, {
      direction: "expense", amount: item.net, method, occurredOn: new Date().toISOString().slice(0, 10),
      reason: `راتب شهر ${month}`, beneficiary: item.full_name, reference: null,
      categoryCode: "salaries", sourceType: "salary", sourceId: item.id, actor,
    });
    await q("UPDATE payroll_items SET entry_id = $2 WHERE id = $1", [item.id, entry.id]);
  }
  await q("UPDATE payroll_runs SET status = 'paid', paid_at = now() WHERE id = $1", [runId]);
  return { paid: items.length };
}
