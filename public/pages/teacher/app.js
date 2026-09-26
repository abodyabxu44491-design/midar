// بوابة المعلم. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "../shared/js/dom.js";
import { startSync, wipeLocal, saveOfflineProfile, warmOfflineShell } from "../shared/js/offline/sync.js";
import { syncIndicator } from "./offline.js";
import { api } from "../shared/js/api.js";
import { topbar, footer, tabs, lazy, panel, notice, passwordChangeScreen } from "../shared/js/ui.js";
import home from "./views/home.js";
const attendance = lazy(() => import("./views/attendance.js"), new URL("./views/attendance.js", import.meta.url).pathname);
const exams = lazy(() => import("./views/exams.js"), new URL("./views/exams.js", import.meta.url).pathname);
const announcements = lazy(() => import("./views/announcements.js"), new URL("./views/announcements.js", import.meta.url).pathname);
const account = lazy(() => import("./views/account.js"), new URL("./views/account.js", import.meta.url).pathname);
const timetable = lazy(() => import("./views/timetable.js"), new URL("./views/timetable.js", import.meta.url).pathname);
const homework = lazy(() => import("./views/homework.js"), new URL("./views/homework.js", import.meta.url).pathname);
const papers = lazy(() => import("./views/papers.js"), new URL("./views/papers.js", import.meta.url).pathname);

const app = $("#app");

export async function startTeacher(offlineMe = null) {
  // بدون اتصال: نبدأ من الملف المحفوظ على الجهاز (الاسم والفصول فقط، بلا كلمات مرور ولا رموز جلسة)
  let me;
  try { me = await api("/api/teacher/me"); } catch (e) {
    if (!offlineMe || (e.code !== "network" && e.code !== "timeout")) throw e;
    me = offlineMe;
  }
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
  const t = tabs(list, { home, timetable, attendance, papers, exams, homework, announcements, account }, ctx);
  ctx.goTo = (key, params) => { ctx.params = params; t.show(key); };
  const bar = topbar({ school: me.school.name, subtitle: `بوابة المعلم — ${me.name}`, onLogout: logout });
  bar.querySelector(".in")?.insertBefore(syncIndicator(), bar.querySelector(".in").lastElementChild);
  mount(app, bar, h("main", {}, t.el), footer());
  t.show("home");
}
