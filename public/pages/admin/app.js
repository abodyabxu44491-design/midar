// لوحة إدارة المدرسة. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { setCurrency } from "/shared/js/format.js";
import { topbar, footer, tabs, passwordChangeScreen } from "/shared/js/ui.js";
import { setApiBase } from "./views/common.js";
import dashboard from "./views/dashboard.js";
import students from "./views/students.js";
import teachers from "./views/teachers.js";
import structure from "./views/structure.js";
import setupWizard from "./views/setup.js";
import distribution from "./views/distribution.js";
import academic from "./views/academic.js";
import attendance from "./views/attendance.js";
import exams from "./views/exams.js";
import finance from "./views/finance.js";
import ledger from "./views/ledger.js";
import announcements from "./views/announcements.js";
import settings from "./views/settings.js";
import audit from "./views/audit.js";
import timetable from "./views/timetable.js";
import reports from "./views/reports.js";
import sheets from "./views/sheets.js";
import analytics from "./views/analytics.js";
import admissions from "./views/admissions.js";

const app = $("#app");

export async function startAdmin() {
  setApiBase("admin");
  const me = await api("/api/admin/me");
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/admin/password", logoutEndpoint: "/api/admin/logout", school: me.school.name, name: me.name });
  }
  setCurrency(me.school.currency);
  const on = (key) => me.modules?.[key] !== false;
  // التبويب يظهر فقط إذا كان قسمه مفعّلًا في هذه المدرسة
  const MODULE_OF = {
    attendance: "attendance", timetable: "timetable", exams: "exams", reports: "reports",
    analytics: "analytics", finance: "fees", ledger: "finance", admissions: "admissions", sheets: "attendance",
    distribution: "timetable",
    announcements: "announcements",
  };
  const allTabs = [
    ...(me.setup_completed === false ? [["setup", "معالج الإعداد"]] : []),
    ["dashboard", "الرئيسية"], ["students", "الطلاب"], ["teachers", "المعلمون"], ["structure", "الهيكل الأكاديمي"], ["academic", "السنة الدراسية"],
    ["attendance", "الحضور"], ["distribution", "توزيع المعلمين"], ["timetable", "الجدول"], ["exams", "الاختبارات"], ["reports", "كشف الدرجات"], ["sheets", "أوراق للطباعة"], ["analytics", "التحليلات"],
    ["finance", "الرسوم"], ["ledger", "المالية"], ["admissions", "طلبات التسجيل"], ["announcements", "التعاميم"], ["settings", "الإعدادات"], ["audit", "السجل"],
  ].filter(([key]) => !MODULE_OF[key] || me.modules?.[MODULE_OF[key]]);

  const t = tabs(allTabs,
    { dashboard, setup: setupWizard, students, teachers, structure, academic, attendance, distribution, timetable, exams, reports, sheets, analytics, finance, ledger, admissions, announcements, settings, audit }, { me });

  mount(app,
    topbar({ school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`,
      onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("dashboard");
}
