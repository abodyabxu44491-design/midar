// لوحة إدارة المدرسة — نقطة البداية. كل تبويب في ملف داخل views/
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs, loginScreen } from "/shared/js/ui.js";
import dashboard from "./views/dashboard.js";
import students from "./views/students.js";
import teachers from "./views/teachers.js";
import structure from "./views/structure.js";
import attendance from "./views/attendance.js";
import exams from "./views/exams.js";
import finance from "./views/finance.js";
import announcements from "./views/announcements.js";
import settings from "./views/settings.js";
import audit from "./views/audit.js";

const app = $("#app");

async function start() {
  let me;
  try { me = await api("/api/admin/me"); }
  catch { return mount(app, loginScreen({ role: "لوحة إدارة المدرسة", endpoint: "/api/admin/login", onSuccess: start })); }

  const t = tabs([
    ["dashboard", "الرئيسية"], ["students", "الطلاب"], ["teachers", "المعلمون"], ["structure", "الفصول والمواد"],
    ["attendance", "الحضور"], ["exams", "الاختبارات"], ["finance", "الرسوم"], ["announcements", "الإعلانات"],
    ["settings", "الإعدادات"], ["audit", "السجل"],
  ], { dashboard, students, teachers, structure, attendance, exams, finance, announcements, settings, audit }, { me });

  mount(app,
    topbar({ school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`,
      onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("dashboard");
}
start();
