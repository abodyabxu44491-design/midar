// الموظفون والرواتب (جزء من المالية):
//   الموظفون بأنواعهم، والمعلمون منهم تلقائيًا (من قائمة المعلمين، الترحيل 0049).
//   مسير شهري: يُنشأ من رواتب الموظفين النشطين (أساسي + بدل ثابت) ← تعديل البدلات والخصومات ← اعتماد ← صرف.
//   الصرف يُنشئ حركة مصروف لكل موظف في سجل الحركات (تصنيف الرواتب)، فتظهر في كل التقارير المالية.
import { z, t, asciiDigits } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { addSystemEntry } from "./ledger.service.js";

// الأنواع بالترتيب الذي تظهر به: [المفرد، الجمع]
export const CATEGORIES = {
  teacher: ["معلم", "المعلمون"], admin: ["إداري", "الإداريون"], accountant: ["محاسب", "المحاسبون"],
  supervisor: ["مشرف", "المشرفون"], guard: ["حارس", "الحراسة"], driver: ["سائق", "السائقون"],
  cleaner: ["عامل نظافة", "النظافة"], worker: ["عامل", "العمال"], other: ["أخرى", "أخرى"],
};
const CAT_KEYS = Object.keys(CATEGORIES);
// المبالغ: أرقام عربية وفواصل الآلاف مقبولة (١٥٠٬٠٠٠ ← 150000)
const money = z.preprocess((v) => (typeof v === "string" ? asciiDigits(v).replace(/[,،٬\s]/g, "").replace("٫", ".") : v),
  z.coerce.number({ invalid_type_error: "المبلغ أرقام فقط" }).min(0, "المبلغ لا يكون سالبًا").max(100_000_000));
const optNumber = z.preprocess((v) => (typeof v === "string" ? asciiDigits(v).replace(/\s+/g, "") : v),
  z.string().regex(/^[0-9-]{4,34}$/, "رقم الحساب أرقام فقط").optional().nullable().or(z.literal("")).transform((v) => v || null));

export const staffSchema = z.object({
  full_name: t.name("اسم الموظف"),
  job_title: t.optText(80),
  category: z.enum(CAT_KEYS).default("other"),
  phone: t.phone,
  iban: z.string().trim().transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/, "رقم الآيبان غير صحيح")).optional().nullable().or(z.literal("")).transform((v) => v || null),
  base_salary: money.default(0),
  allowance: money.default(0),
  pay_method: z.enum(["cash", "transfer"]).default("cash"),
  account_number: optNumber,
  hire_date: t.optDate,
  notes: t.optText(300),
  teacher_id: t.optId,
});
export const salarySchema = z.object({ base_salary: money, allowance: money.default(0) });
export const runSchema = z.object({
  period: t.date,                       // أي يوم في الشهر المطلوب
  note: t.optText(300),
});
export const itemSchema = z.object({
  allowances: money.default(0),
  bonus: money.default(0),
  deductions: money.default(0),
  advances: money.default(0),
  note: t.optText(200),
});
export const paySchema = z.object({
  method: z.enum(["cash", "transfer", "card", "online"]).default("cash"),
  paid_on: t.optDate,                   // تاريخ الصرف (افتراضيًا اليوم)
});

const STAFF_SELECT = `SELECT s.id, s.full_name, s.job_title, s.category, s.phone, s.iban, s.base_salary, s.allowance,
    s.base_salary + s.allowance AS monthly, s.pay_method, s.account_number, s.hire_date::text AS hire_date, s.notes,
    s.is_active, s.teacher_id,
    (SELECT count(DISTINCT ta.class_id)::int FROM teacher_assignments ta WHERE ta.teacher_id = s.teacher_id) AS classes,
    (SELECT string_agg(DISTINCT sb.name, '، ') FROM teacher_assignments ta JOIN subjects sb ON sb.id = ta.subject_id WHERE ta.teacher_id = s.teacher_id) AS subjects
  FROM staff s`;

export const listStaff = (q) => q(`${STAFF_SELECT}
  ORDER BY s.is_active DESC, array_position($1::text[], s.category), s.full_name`, [CAT_KEYS]);

/** ملخص الموظفين: العدد والرواتب لكل نوع (النشطون فقط) */
export async function staffSummary(q) {
  const rows = await q(`SELECT category, count(*)::int AS count, COALESCE(SUM(base_salary + allowance), 0) AS monthly,
                               count(*) FILTER (WHERE base_salary = 0)::int AS no_salary
                          FROM staff WHERE is_active GROUP BY category`);
  const by = Object.fromEntries(rows.map((r) => [r.category, { ...r, monthly: Number(r.monthly) }]));
  const types = CAT_KEYS.filter((k) => by[k]).map((k) => ({ key: k, name: CATEGORIES[k][1], ...by[k] }));
  return {
    types,
    count: types.reduce((n, x) => n + x.count, 0),
    monthly: types.reduce((n, x) => n + x.monthly, 0),
    no_salary: types.reduce((n, x) => n + x.no_salary, 0),
  };
}

export async function addStaff(q, b) {
  const [row] = await q(
    `INSERT INTO staff (tenant_id, full_name, job_title, category, phone, iban, base_salary, allowance, pay_method, account_number, hire_date, notes, teacher_id)
     VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [b.full_name, b.job_title, b.category, b.phone, b.iban, b.base_salary, b.allowance, b.pay_method, b.account_number, b.hire_date ?? null, b.notes, b.teacher_id ?? null]);
  return row;
}

// المعلم المرتبط: اسمه وجواله ونوعه من ملف المعلم (يُعدَّلان هناك)، والباقي من هنا
export async function updateStaff(q, id, b) {
  const [cur] = await q("SELECT teacher_id FROM staff WHERE id = $1", [id]);
  if (!cur) throw notFound("الموظف غير موجود");
  const linked = Boolean(cur.teacher_id);
  await q(
    `UPDATE staff SET full_name = CASE WHEN $2 THEN full_name ELSE $3 END, phone = CASE WHEN $2 THEN phone ELSE $4 END,
            category = CASE WHEN $2 THEN 'teacher' ELSE $5 END,
            job_title = $6, iban = $7, base_salary = $8, allowance = $9, pay_method = $10, account_number = $11, hire_date = $12, notes = $13
      WHERE id = $1`,
    [id, linked, b.full_name, b.phone, b.category, b.job_title, b.iban, b.base_salary, b.allowance, b.pay_method, b.account_number, b.hire_date ?? null, b.notes]);
}

export async function setSalary(q, id, b) {
  const rows = await q("UPDATE staff SET base_salary = $2, allowance = $3 WHERE id = $1 RETURNING id", [id, b.base_salary, b.allowance]);
  if (!rows.length) throw notFound("الموظف غير موجود");
}

export async function setStaffActive(q, id, active) {
  const rows = await q("UPDATE staff SET is_active = $2 WHERE id = $1 RETURNING id", [id, active]);
  if (!rows.length) throw notFound("الموظف غير موجود");
}

// احتياط للمدارس القديمة: أي معلم بلا سجل وظيفي يُضاف (المعلمون الجدد يُضافون تلقائيًا بمشغّل في القاعدة)
export async function importTeachers(q) {
  const rows = await q(
    `INSERT INTO staff (tenant_id, full_name, job_title, category, phone, teacher_id, hire_date)
     SELECT app_tenant(), t.full_name, COALESCE(t.job_title, 'معلم'), 'teacher', t.phone, t.id, t.hire_date FROM teachers t
      WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.teacher_id = t.id)
     ON CONFLICT DO NOTHING RETURNING id`);
  return rows.length;
}

/* ---------- المسيرات ---------- */
export const listRuns = (q) => q(
  `SELECT r.id, r.period::text AS period, r.status, r.note, r.created_by, r.approved_by, r.paid_at, r.created_at,
          COALESCE(SUM(i.net), 0) AS total, count(i.id)::int AS employees
     FROM payroll_runs r LEFT JOIN payroll_items i ON i.run_id = r.id
    WHERE r.status <> 'void' GROUP BY r.id ORDER BY r.period DESC LIMIT 60`);

export const runItems = (q, runId) => q(
  `SELECT i.id, i.staff_id, s.full_name, s.job_title, s.category, s.pay_method, s.account_number, i.base, i.allowances, i.bonus,
          i.deductions, i.advances, i.net, i.note, e.entry_no
     FROM payroll_items i JOIN staff s ON s.id = i.staff_id
     LEFT JOIN finance_entries e ON e.id = i.entry_id
    WHERE i.run_id = $1 ORDER BY array_position($2::text[], s.category), s.full_name`, [runId, CAT_KEYS]);

const monthOf = (d) => `${String(d).slice(0, 7)}-01`;

/** شهر واحد: المسير إن وُجد مع سطوره، وإلا معاينة من سيدخل فيه ورواتبهم */
export async function month(q, period) {
  const p = monthOf(period);
  const [run] = await q(
    `SELECT r.id, r.period::text AS period, r.status, r.note, r.created_by, r.approved_by, r.paid_at,
            COALESCE(SUM(i.net), 0) AS total, count(i.id)::int AS employees
       FROM payroll_runs r LEFT JOIN payroll_items i ON i.run_id = r.id WHERE r.period = $1 AND r.status <> 'void' GROUP BY r.id`, [p]);
  if (run) return { period: p, run, items: await runItems(q, run.id) };
  const preview = await q(
    `SELECT s.id AS staff_id, s.full_name, s.job_title, s.category, s.base_salary AS base, s.allowance AS allowances, s.base_salary + s.allowance AS net
       FROM staff s WHERE s.is_active ORDER BY array_position($1::text[], s.category), s.full_name`, [CAT_KEYS]);
  return { period: p, run: null, preview, total: preview.reduce((n, x) => n + Number(x.net), 0) };
}

// إنشاء مسير الشهر لكل الموظفين النشطين: الأساسي والبدل الثابت من ملف الموظف
export async function createRun(q, b, actor) {
  const period = monthOf(b.period);
  const [dup] = await q("SELECT id, status FROM payroll_runs WHERE period = $1 FOR UPDATE", [period]);
  if (dup && dup.status !== "void") throw conflict("يوجد مسير رواتب لهذا الشهر");
  const staff = await q("SELECT id, base_salary, allowance FROM staff WHERE is_active");
  if (!staff.length) throw badRequest("لا يوجد موظفون نشطون. أضف الموظفين أولًا.");
  // مسير ملغى للشهر نفسه يُعاد فتحه مسودة (الشهر الواحد له مسير واحد)
  const [run] = dup
    ? await q("UPDATE payroll_runs SET status = 'draft', note = $2, created_by = $3, approved_by = NULL, paid_at = NULL WHERE id = $1 RETURNING id", [dup.id, b.note ?? null, actor])
    : await q("INSERT INTO payroll_runs (tenant_id, period, note, created_by) VALUES (app_tenant(), $1, $2, $3) RETURNING id",
      [period, b.note ?? null, actor]);
  await q(`INSERT INTO payroll_items (tenant_id, run_id, staff_id, base, allowances)
           SELECT app_tenant(), $1, s, b, a FROM unnest($2::bigint[], $3::numeric[], $4::numeric[]) AS x(s, b, a)`,
    [run.id, staff.map((s) => s.id), staff.map((s) => s.base_salary), staff.map((s) => s.allowance)]);
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
  if (Number(rows[0].net) < 0) throw badRequest("الخصومات والسلف أكبر من الراتب");
  return rows[0];
}

// حذف مسودة (خطأ في الشهر مثلًا): المسودة فقط، والمعتمد والمصروف يبقيان في السجل
export async function deleteDraft(q, runId) {
  const run = await getRun(q, runId, true);
  if (run.status !== "draft") throw badRequest("لا يُحذف إلا المسير المسودة");
  await q("DELETE FROM payroll_items WHERE run_id = $1", [runId]);
  await q("UPDATE payroll_runs SET status = 'void' WHERE id = $1", [runId]);   // يبقى في السجل، وإنشاء مسير للشهر نفسه يعيد استخدامه
}

export async function approveRun(q, runId, actor) {
  const run = await getRun(q, runId, true);
  if (run.status !== "draft") throw badRequest("المسير معتمد مسبقًا");
  await q("UPDATE payroll_runs SET status = 'approved', approved_by = $2 WHERE id = $1", [runId, actor]);
}

// الصرف: حركة مصروف لكل موظف مرتبطة بسطره في المسير
export async function payRun(q, runId, { method = "cash", paid_on = null } = {}, actor) {
  const run = await getRun(q, runId, true);
  if (run.status === "paid") throw badRequest("المسير مصروف مسبقًا");
  if (run.status !== "approved") throw badRequest("اعتمد المسير قبل الصرف");
  const items = await q(
    `SELECT i.id, i.net, s.full_name, s.account_number FROM payroll_items i JOIN staff s ON s.id = i.staff_id
      WHERE i.run_id = $1 AND i.entry_id IS NULL AND i.net > 0`, [runId]);
  const monthLabel = String(run.period).slice(0, 7);
  const on = paid_on || new Date().toISOString().slice(0, 10);
  for (const item of items) {
    const entry = await addSystemEntry(q, {
      direction: "expense", amount: item.net, method, occurredOn: on,
      reason: `راتب شهر ${monthLabel}`, beneficiary: item.full_name, reference: item.account_number,
      categoryCode: "salaries", sourceType: "salary", sourceId: item.id, actor,
    });
    await q("UPDATE payroll_items SET entry_id = $2 WHERE id = $1", [item.id, entry.id]);
  }
  await q("UPDATE payroll_runs SET status = 'paid', paid_at = $2::date + time '12:00' WHERE id = $1", [runId, on]);
  return { paid: items.length, total: items.reduce((n, x) => n + Number(x.net), 0) };
}
