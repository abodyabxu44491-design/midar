// بوابة المعلم. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "../shared/js/dom.js";
import { startSync, wipeLocal, saveOfflineProfile, warmOfflineShell } from "../shared/js/offline/sync.js";
import { syncIndicator } from "./offline.js";
import { api } from "../shared/js/api.js";
import { attachBell } from "../shared/js/inbox.js";
import { topbar, footer, tabs, lazy, panel, notice, passwordChangeScreen, schoolLogoUrl } from "../shared/js/ui.js";
import home from "./views/home.js";
import { rememberSchool } from "../shared/js/recent.js";
const attendance = lazy(() => import("./views/attendance.js"), new URL("./views/attendance.js", import.meta.url).pathname);
const exams = lazy(() => import("./views/exams.js"), new URL("./views/exams.js", import.meta.url).pathname);
const announcements = lazy(() => import("./views/announcements.js"), new URL("./views/announcements.js", import.meta.url).pathname);
const students = lazy(() => import("./views/students.js"), new URL("./views/students.js", import.meta.url).pathname);
const account = lazy(() => import("./views/account.js"), new URL("./views/account.js", import.meta.url).pathname);
const timetable = lazy(() => import("./views/timetable.js"), new URL("./views/timetable.js", import.meta.url).pathname);
const homework = lazy(() => import("./views/homework.js"), new URL("./views/homework.js", import.meta.url).pathname);
const papers = lazy(() => import("./views/papers.js"), new URL("./views/papers.js", import.meta.url).pathname);
const behavior = lazy(() => import("./views/behavior.js"), new URL("./views/behavior.js", import.meta.url).pathname);
const lessons = lazy(() => import("./views/lessons.js"), new URL("./views/lessons.js", import.meta.url).pathname);
const calendar = lazy(() => import("./views/calendar.js"), new URL("./views/calendar.js", import.meta.url).pathname);
const meetings = lazy(() => import("./views/meetings.js"), new URL("./views/meetings.js", import.meta.url).pathname);
const surveys = lazy(() => import("./views/surveys.js"), new URL("./views/surveys.js", import.meta.url).pathname);
const mine = lazy(() => import("./views/mine.js"), new URL("./views/mine.js", import.meta.url).pathname);
const chat = lazy(() => import("./views/chat.js"), new URL("./views/chat.js", import.meta.url).pathname);

const app = $("#app");

export async function startTeacher(offlineMe = null) {
  // بدون اتصال: نبدأ من الملف المحفوظ على الجهاز (الاسم والفصول فقط، بلا كلمات مرور ولا رموز جلسة)
  let me;
  try { me = await api("/api/teacher/me"); } catch (e) {
    if (!offlineMe || (e.code !== "network" && e.code !== "timeout")) throw e;
    me = offlineMe;
  }
  rememberSchool({ id: me.school.id, name: me.school.name, role: "teacher" });
  if (me.access?.locked) {
    return mount(app, topbar({ school: me.school.name, subtitle: me.name, onLogout: async () => { await api("/api/teacher/logout", {}); location.reload(); } }),
      h("main", {}, panel("اشتراك المدرسة غير فعّال حاليًا", null, notice("لا يمكن استخدام المنصة الآن لأن اشتراك المدرسة متوقف. كل البيانات محفوظة، وتعود للعمل فور تجديد الإدارة للاشتراك.", "warn"))), footer());
  }
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/teacher/password", logoutEndpoint: "/api/teacher/logout", school: me.school.name, name: me.name });
  }
  const MODULE_OF = { timetable: "timetable", attendance: "attendance", exams: "exams",
    homework: "homework", announcements: "announcements", papers: "exam_papers",
    behavior: "behavior", lessons: "lesson_plans", calendar: "calendar", meetings: "meetings", surveys: "surveys", me: "staff_attendance", chat: "chat" };
  const list = [["home", "الرئيسية"], ["students", "طلابي"], ["chat", "الرسائل"], ["attendance", "الحضور"], ["behavior", "السلوك"], ["timetable", "جدولي"],
    ["papers", "الاختبارات والامتحانات"], ["exams", "رصد الدرجات"], ["homework", "الواجبات"], ["lessons", "تحضير الدروس"],
    ["calendar", "التقويم"], ["meetings", "المواعيد"], ["surveys", "الاستبيانات"], ["announcements", "التعاميم"],
    ["me", "حضوري وإجازاتي"], ["account", "حسابي"]]
    .filter(([key]) => !MODULE_OF[key] || me.modules?.[MODULE_OF[key]]);
  // العمل بدون إنترنت: قاعدة محلية لهذا المستخدم ومحرك المزامنة
  if (!me.offline) saveOfflineProfile({ role: "teacher", tenantId: me.school.id, userId: me.user_id, savedAt: Date.now(), me: { ...me, offline: true } });
  try { await startSync({ tenantId: me.school.id, userId: me.user_id, me }); } catch (e) { console.warn("المزامنة غير متاحة على هذا المتصفح", e); }
  warmOfflineShell();
  const logout = async () => {
    await wipeLocal(me.school.id, me.user_id);   // لا تبقى بيانات الطلاب على الجهاز بعد الخروج
    try { await api("/api/teacher/logout", {}); } catch { /* بدون اتصال: الجلسة تنتهي على الخادم لاحقًا */ }
    location.reload();
  };
  const ctx = { me };
  const t = tabs(list, { home, students, timetable, attendance, papers, exams, homework, announcements, account, behavior, lessons, calendar, meetings, surveys, me: mine, chat }, ctx);
  ctx.goTo = (key, params) => { ctx.params = params; t.show(key); };
  const bar = topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: `بوابة المعلم — ${me.name}`, onLogout: logout });
  bar.querySelector(".in")?.insertBefore(syncIndicator(), bar.querySelector(".in").lastElementChild);
  attachBell(bar, "/api/teacher", (n) => {
    const tab = { substitute: "me", lesson_plan: "lessons", leave: "me", meeting: "meetings", survey: "surveys", grades_review: "exams", timetable: "timetable",
      announcement: "announcements", message: "announcements", chat: "chat" }[n.kind];
    if (!tab || !list.some((x) => x[0] === tab || x.key === tab)) return false;
    t.show(tab); return true;
  });
  mount(app, bar, h("main", {}, t.el), footer());
  t.start("home");
}
