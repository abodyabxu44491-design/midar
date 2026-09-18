// لوحة إدارة المدرسة. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs } from "/shared/js/ui.js";
import dashboard from "./views/dashboard.js";
import students from "./views/students.js";
import teachers from "./views/teachers.js";
import structure from "./views/structure.js";
import academic from "./views/academic.js";
import attendance from "./views/attendance.js";
import exams from "./views/exams.js";
import finance from "./views/finance.js";
import announcements from "./views/announcements.js";
import settings from "./views/settings.js";
import audit from "./views/audit.js";
import timetable from "./views/timetable.js";
import reports from "./views/reports.js";
import admissions from "./views/admissions.js";

const app = $("#app");

export async function startAdmin() {
  const me = await api("/api/admin/me");
  const t = tabs([
    ["dashboard", "الرئيسية"], ["students", "الطلاب"], ["teachers", "المعلمون"], ["structure", "الفصول والمواد"], ["academic", "السنة الدراسية"],
    ["attendance", "الحضور"], ["timetable", "الجدول"], ["exams", "الاختبارات"], ["reports", "كشف الدرجات"],
    ["finance", "الرسوم"], ["admissions", "طلبات التسجيل"], ["announcements", "الإعلانات"], ["settings", "الإعدادات"], ["audit", "السجل"],
  ], { dashboard, students, teachers, structure, academic, attendance, timetable, exams, reports, finance, admissions, announcements, settings, audit }, { me });

  mount(app,
    topbar({ school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`,
      onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("dashboard");
}
