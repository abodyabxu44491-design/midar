/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from "../../core/http/validate.js";
import { badRequest } from "../../core/http/errors.js";

export const MODULES = [
  { key: "attendance", name: "الحضور والغياب", note: "تسجيل الحضور اليومي وتقاريره" },
  { key: "timetable", name: "الجدول الدراسي", note: "جدول حصص لكل صف وجدول لكل معلم" },
  { key: "exams", name: "الاختبارات والدرجات", note: "إدخال الدرجات واعتمادها ونشرها" },
  { key: "reports", name: "كشوف الدرجات", note: "يحتاج تشغيل الاختبارات" },
  { key: "exam_papers", name: "مصمم الاختبارات الورقية", note: "بنك الأسئلة وإنشاء أوراق الاختبارات وطباعتها" },
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
  { key: "installments", name: "الأقساط وخصم الإخوة", note: "تقسيط الفواتير وخصم تلقائي للإخوة — يحتاج الرسوم" },
  { key: "notifications", name: "الإشعارات الفورية", note: "إشعار على جوال ولي الأمر والمعلم من التطبيق المثبّت" },
  { key: "sms", name: "الرسائل النصية", note: "رسائل SMS تلقائية لأولياء الأمور برصيد رسائل" },
  { key: "surveys", name: "الاستبيانات", note: "استبيانات لأولياء الأمور والمعلمين" },
  { key: "meetings", name: "مواعيد أولياء الأمور", note: "حجز موعد مع المعلم أو الإدارة" },
  { key: "chat", name: "مراسلة المعلمين", note: "محادثة بين ولي الأمر ومعلمي ابنه داخل التطبيق" },
  { key: "calendar", name: "التقويم المدرسي", note: "الاختبارات والإجازات والفعاليات في تقويم واحد" },
  { key: "behavior", name: "السلوك والانضباط", note: "المخالفات والإنجازات بالنقاط" },
  { key: "certificates", name: "الشهادات الرسمية", note: "شهادات الفصل والعام برمز تحقق" },
  { key: "online_exams", name: "الاختبارات الإلكترونية", note: "الطالب يحل من جواله — يحتاج مصمم الاختبارات والاختبارات" },
  { key: "lesson_plans", name: "تحضير الدروس", note: "خطط المعلمين الأسبوعية واعتمادها" },
  { key: "staff_attendance", name: "حضور الموظفين والإجازات", note: "حضور المعلمين والموظفين وطلبات الإجازة" },
  { key: "substitutes", name: "حصص الانتظار", note: "معلم بديل لحصص الغائب — يحتاج الجدول" },
  { key: "transport", name: "النقل المدرسي", note: "الحافلات والخطوط والطلاب" },
  { key: "library", name: "المكتبة", note: "الكتب والإعارة" },
  { key: "inventory", name: "العهد والمخزون", note: "الأصناف والعهد" },
  { key: "clinic", name: "العيادة المدرسية", note: "الملف الصحي والزيارات" },
  { key: "ai_assistant", name: "المساعد الذكي", note: "اسأل عن بيانات مدرستك" },
];

export const REQUIRES = {
  reports: ["exams"], donations: ["finance"], payroll: ["finance"], transfers: ["finance"],
  online_exams: ["exam_papers", "exams"], installments: ["fees"], substitutes: ["timetable"],
};
const NAME = (k) => MODULES.find((m) => m.key === k)?.name || k;
export const KEYS = MODULES.map((m) => m.key);

export const DEFAULTS = Object.fromEntries(KEYS.map((k) => [k, k !== "donations"]));

export const modulesSchema = z.object(Object.fromEntries(KEYS.map((k) => [k, z.boolean()]))).partial();

export async function getModules(q) {
  const [row] = await q(`SELECT ${KEYS.join(", ")} FROM school_modules WHERE tenant_id = app_tenant()`);
  if (row) return row;
  await q("INSERT INTO school_modules (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
  const [created] = await q(`SELECT ${KEYS.join(", ")} FROM school_modules WHERE tenant_id = app_tenant()`);
  return created || { ...DEFAULTS };
}

export async function updateModules(q, patch) {
  const cur = await getModules(q);
  patch = { ...patch };
  for (const [child, parents] of Object.entries(REQUIRES)) {
    if (parents.some((p) => patch[p] === false) && patch[child] === undefined && cur[child]) patch[child] = false;
  }
  for (const [child, parents] of Object.entries(REQUIRES)) {
    if (patch[child] !== true) continue;
    const off = parents.filter((p) => !(patch[p] ?? cur[p]));
    if (off.length) throw badRequest(`«${NAME(child)}» يحتاج تشغيل: ${off.map(NAME).join("، ")}`);
  }
  const keys = KEYS.filter((k) => patch[k] !== undefined);
  if (!keys.length) return getModules(q);
  const [row] = await q(
    `UPDATE school_modules SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}
      WHERE tenant_id = app_tenant() RETURNING ${KEYS.join(", ")}`, keys.map((k) => patch[k]));
  return row;
}

export const effectiveModules = (toggles, entitled) => Object.fromEntries(KEYS.map((k) => [k, Boolean(toggles[k]) && entitled.has(k)]));
