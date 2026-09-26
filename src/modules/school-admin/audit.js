// سجل العمليات (قراءة فقط)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";

const r = Router();
const TABLES = { students: "الطلاب", attendance: "الحضور", exams: "الاختبارات", scores: "الدرجات", invoices: "الفواتير",
  payments: "المدفوعات", teachers: "المعلمون", users: "الحسابات", classes: "الفصول", subjects: "المواد",
  teacher_assignments: "إسناد المعلمين", announcements: "الإعلانات", tenants: "إعدادات المدرسة" };
const OPS = { insert: "إضافة", update: "تعديل", delete: "حذف" };

r.get("/", handle(async (req, res) => {
  const before = Number(req.query.before) || null;
  const rows = await inTenant(req, (q) => q(
    `SELECT id, actor, action, table_name, record_id, old_data, new_data, host(ip) AS ip, created_at
       FROM audit_log WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT 100`, [before]));
  res.json(rows.map((a) => ({
    id: a.id, actor: a.actor, ip: a.ip, created_at: a.created_at,
    summary: a.table_name ? `${OPS[a.action] || a.action} — ${TABLES[a.table_name] || a.table_name} #${a.record_id ?? ""}` : a.action,
    changes: a.action === "update" && a.old_data && a.new_data
      ? Object.keys(a.new_data).filter((k) => !["updated_at", "version"].includes(k) && JSON.stringify(a.old_data[k]) !== JSON.stringify(a.new_data[k]))
          .map((k) => ({ field: k, from: a.old_data[k], to: a.new_data[k] }))
      : null,
  })));
}));

export default r;
