// أقسام المنصة: كل مدرسة تُشغّل ما تحتاجه
import { z } from "../../core/http/validate.js";

export const MODULES = [
  { key: "attendance", name: "الحضور والغياب", note: "تسجيل الحضور اليومي وتقاريره" },
  { key: "timetable", name: "الجدول الدراسي", note: "جدول حصص لكل صف وجدول لكل معلم" },
  { key: "exams", name: "الاختبارات والدرجات", note: "إدخال الدرجات واعتمادها ونشرها" },
  { key: "reports", name: "كشوف الدرجات", note: "يحتاج تشغيل الاختبارات" },
  { key: "homework", name: "الواجبات", note: "ينشرها المعلم ويتابعها ولي الأمر" },
  { key: "announcements", name: "التعاميم", note: "رسائل المدرسة لأولياء الأمور" },
  { key: "admissions", name: "طلبات التسجيل", note: "طلبات التحاق الطلاب الجدد" },
  { key: "analytics", name: "التحليلات", note: "نسب الحضور ومتوسطات الدرجات" },
  { key: "messaging", name: "رسائل واتساب", note: "أزرار التنبيه لأولياء الأمور" },
  { key: "fees", name: "الرسوم والفواتير", note: "فواتير الطلاب والسداد والإيصالات" },
  { key: "finance", name: "النظام المالي", note: "الحسابات والصناديق وسجل الحركات" },
  { key: "donations", name: "التبرعات", note: "يحتاج تشغيل النظام المالي" },
  { key: "payroll", name: "الرواتب", note: "الموظفون ومسير الرواتب — يحتاج النظام المالي" },
  { key: "transfers", name: "التحويل بين الحسابات", note: "يحتاج تشغيل النظام المالي" },
];
export const KEYS = MODULES.map((m) => m.key);

// القيم الافتراضية إذا لم يُنشأ صف المدرسة بعد
export const DEFAULTS = Object.fromEntries(KEYS.map((k) => [k, !["donations", "payroll"].includes(k)]));

export const modulesSchema = z.object(Object.fromEntries(KEYS.map((k) => [k, z.boolean()]))).partial();

export async function getModules(q) {
  const [row] = await q(`SELECT ${KEYS.join(", ")} FROM school_modules WHERE tenant_id = app_tenant()`);
  if (row) return row;
  await q("INSERT INTO school_modules (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  const [created] = await q(`SELECT ${KEYS.join(", ")} FROM school_modules WHERE tenant_id = app_tenant()`);
  return created || { ...DEFAULTS };
}

export async function updateModules(q, patch) {
  await getModules(q);
  const keys = KEYS.filter((k) => patch[k] !== undefined);
  if (!keys.length) return getModules(q);
  const [row] = await q(
    `UPDATE school_modules SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}
      WHERE tenant_id = app_tenant() RETURNING ${KEYS.join(", ")}`, keys.map((k) => patch[k]));
  return row;
}
