// بوابة المعلم. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs } from "/shared/js/ui.js";
import home from "./views/home.js";
import attendance from "./views/attendance.js";
import exams from "./views/exams.js";
import announcements from "./views/announcements.js";
import account from "./views/account.js";

const app = $("#app");

export async function startTeacher() {
  const me = await api("/api/teacher/me");
  const t = tabs([["home", "فصولي"], ["attendance", "الحضور"], ["exams", "الاختبارات والدرجات"], ["announcements", "الإعلانات"], ["account", "حسابي"]],
    { home, attendance, exams, announcements, account }, { me });
  mount(app,
    topbar({ school: me.school.name, subtitle: `بوابة المعلم — ${me.name}`,
      onLogout: async () => { await api("/api/teacher/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("home");
}
