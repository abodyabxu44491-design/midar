// سجل العمليات (قراءة فقط)
import { tableLabel } from "../shared/danger-zone.service.js";
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { describeChanges } from "../shared/audit-labels.js";

const r = Router();
const TABLES = { students: "الطلاب", attendance: "الحضور", exams: "الاختبارات", scores: "الدرجات", invoices: "الفواتير",
  payments: "المدفوعات", teachers: "المعلمون", users: "الحسابات", classes: "الشعب", subjects: "المواد",
  teacher_assignments: "إسناد المعلمين", announcements: "الإعلانات", tenants: "إعدادات المدرسة",
  stages: "المراحل", grades: "الصفوف", subject_grades: "ربط المواد بالصفوف", academic_years: "السنوات الدراسية",
  terms: "الفصول الدراسية", holidays: "الإجازات", school_profile: "ملف المدرسة والإعداد", timetable_slots: "الجدول الدراسي",
  finance_entries: "القيود المالية", payroll_items: "مسير الرواتب", payroll_runs: "دورات الرواتب", staff: "الموظفون",
  school_modules: "أقسام المنصة المفعلة", school_public_settings: "إعدادات الصفحة العامة", assignments: "الواجبات",
  student_alerts: "تنبيهات الطلاب", exam_papers: "أوراق الاختبارات", grade_components: "توزيع الدرجات", finance_accounts: "الحسابات المالية",
  admissions: "طلبات القبول", fee_plans: "خطط الرسوم", fee_adjustments: "تعديلات الرسوم", donations: "التبرعات",
  payment_claims: "إشعارات الدفع", custom_fields: "الحقول المخصصة", attachments: "المرفقات", subscriptions: "الاشتراك" };
const OPS = { insert: "إضافة", update: "تعديل", delete: "حذف" };

// قائمة الأقسام للتصفية في الواجهة
r.get("/filters", handle(async (req, res) => {
  res.json({
    tables: Object.entries(TABLES).map(([key, name]) => ({ key, name })),
    actions: Object.entries(OPS).map(([key, name]) => ({ key, name })),
  });
}));

r.get("/", handle(async (req, res) => {
  const f = parse(z.object({
    before: z.coerce.number().int().positive().optional(),
    table: z.string().max(40).optional(),
    action: z.enum(["insert", "update", "delete"]).optional(),
    actor: z.string().max(80).optional(),
    from: t.date.optional(),
    to: t.date.optional(),
    q: z.string().max(60).optional(),
  }), req.query);

  const rows = await inTenant(req, (q) => q(
    `SELECT id, actor, action, table_name, record_id, old_data, new_data, host(ip) AS ip, created_at
       FROM audit_log
      WHERE ($1::bigint IS NULL OR id < $1)
        AND ($2::text IS NULL OR table_name = $2)
        AND ($3::text IS NULL OR action = $3)
        AND ($4::text IS NULL OR actor ILIKE '%' || $4 || '%')
        AND ($5::date IS NULL OR created_at >= $5)
        AND ($6::date IS NULL OR created_at < $6::date + 1)
        AND ($7::text IS NULL OR actor ILIKE '%' || $7 || '%'
             OR COALESCE(new_data::text, '') ILIKE '%' || $7 || '%'
             OR COALESCE(old_data::text, '') ILIKE '%' || $7 || '%')
      ORDER BY id DESC LIMIT 100`,
    [f.before ?? null, f.table ?? null, f.action ?? null, f.actor ?? null, f.from ?? null, f.to ?? null, f.q ?? null]));
  res.json(rows.map((a) => ({
    id: a.id, actor: a.actor === "system" ? "النظام" : a.actor, ip: a.ip, created_at: a.created_at,
    summary: a.table_name ? `${OPS[a.action] || a.action} — ${TABLES[a.table_name] || tableLabel(a.table_name)} #${a.record_id ?? ""}` : a.action.replace("(undefined)", "(محاسب)"),
    changes: a.action === "update" && a.old_data && a.new_data
      ? describeChanges(a.old_data, a.new_data)
      : null,
  })));
}));

export default r;
