// بوابة المعلم. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "../shared/js/dom.js";
import { api } from "../shared/js/api.js";
import { topbar, footer, tabs, lazy, panel, notice, passwordChangeScreen } from "../shared/js/ui.js";
import home from "./views/home.js";
const attendance = lazy(() => import("./views/attendance.js"));
const exams = lazy(() => import("./views/exams.js"));
const announcements = lazy(() => import("./views/announcements.js"));
const account = lazy(() => import("./views/account.js"));
const timetable = lazy(() => import("./views/timetable.js"));
const homework = lazy(() => import("./views/homework.js"));
const papers = lazy(() => import("./views/papers.js"));

const app = $("#app");

export async function startTeacher() {
  const me = await api("/api/teacher/me");
  if (me.access?.locked) {
    return mount(app, topbar({ school: me.school.name, subtitle: me.name, onLogout: async () => { await api("/api/teacher/logout", {}); location.reload(); } }),
      h("main", {}, panel("اشتراك المدرسة غير فعّال حاليًا", null, notice("لا يمكن استخدام المنصة الآن لأن اشتراك المدرسة متوقف. كل البيانات محفوظة، وتعود للعمل فور تجديد الإدارة للاشتراك.", "warn"))), footer());
  }
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/teacher/password", logoutEndpoint: "/api/teacher/logout", school: me.school.name, name: me.name });
  }
  const MODULE_OF = { timetable: "timetable", attendance: "attendance", exams: "exams",
    homework: "homework", announcements: "announcements", papers: "exam_papers" };
  const list = [["home", "فصولي"], ["timetable", "جدولي"], ["attendance", "الحضور"], ["papers", "الاختبارات والامتحانات"], ["exams", "رصد الدرجات"],
    ["homework", "الواجبات"], ["announcements", "التعاميم"], ["account", "حسابي"]]
    .filter(([key]) => !MODULE_OF[key] || me.modules?.[MODULE_OF[key]]);
  const ctx = { me };
  const t = tabs(list, { home, timetable, attendance, papers, exams, homework, announcements, account }, ctx);
  ctx.goTo = (key, params) => { ctx.params = params; t.show(key); };
  mount(app,
    topbar({ school: me.school.name, subtitle: `بوابة المعلم — ${me.name}`,
      onLogout: async () => { await api("/api/teacher/logout", {}); location.reload(); } }),
    h("main", {}, t.el), footer());
  t.show("home");
}
