// بوابة المعلم. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, tabs, passwordChangeScreen } from "/shared/js/ui.js";
import home from "./views/home.js";
import attendance from "./views/attendance.js";
import exams from "./views/exams.js";
import announcements from "./views/announcements.js";
import account from "./views/account.js";
import timetable from "./views/timetable.js";
import homework from "./views/homework.js";

const app = $("#app");

export async function startTeacher() {
  const me = await api("/api/teacher/me");
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/teacher/password", logoutEndpoint: "/api/teacher/logout", school: me.school.name, name: me.name });
  }
  const MODULE_OF = { timetable: "timetable", attendance: "attendance", exams: "exams",
    homework: "homework", announcements: "announcements" };
  const list = [["home", "فصولي"], ["timetable", "جدولي"], ["attendance", "الحضور"], ["exams", "الاختبارات والدرجات"],
    ["homework", "الواجبات"], ["announcements", "التعاميم"], ["account", "حسابي"]]
    .filter(([key]) => !MODULE_OF[key] || me.modules?.[MODULE_OF[key]]);
  const t = tabs(list, { home, timetable, attendance, exams, homework, announcements, account }, { me });
  mount(app,
    topbar({ school: me.school.name, subtitle: `بوابة المعلم — ${me.name}`,
      onLogout: async () => { await api("/api/teacher/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("home");
}
