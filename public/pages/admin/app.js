// لوحة إدارة المدرسة. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "../shared/js/dom.js";
import { mySubscription, accessBanner, lockScreen } from "./views/my-subscription.js";
import { api } from "../shared/js/api.js";
import { setCurrency } from "../shared/js/format.js";
import { topbar, footer, tabs, lazy, passwordChangeScreen } from "../shared/js/ui.js";
import { setApiBase } from "./views/common.js";
import dashboard from "./views/dashboard.js";
const students = lazy(() => import("./views/students.js"));
const teachers = lazy(() => import("./views/teachers.js"));
const structure = lazy(() => import("./views/structure.js"));
const setupWizard = lazy(() => import("./views/setup.js"));
const distribution = lazy(() => import("./views/distribution.js"));
const academic = lazy(() => import("./views/academic.js"));
const attendance = lazy(() => import("./views/attendance.js"));
const exams = lazy(() => import("./views/exams.js"));
const finance = lazy(() => import("./views/finance.js"));
const ledger = lazy(() => import("./views/ledger.js"));
const announcements = lazy(() => import("./views/announcements.js"));
const settings = lazy(() => import("./views/settings.js"));
const audit = lazy(() => import("./views/audit.js"));
const timetable = lazy(() => import("./views/timetable.js"));
const reports = lazy(() => import("./views/reports.js"));
const sheets = lazy(() => import("./views/sheets.js"));
const analytics = lazy(() => import("./views/analytics.js"));
const admissions = lazy(() => import("./views/admissions.js"));
const papers = lazy(() => import("./views/papers.js"));

const app = $("#app");

export async function startAdmin() {
  setApiBase("admin");
  const me = await api("/api/admin/me");
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/admin/password", logoutEndpoint: "/api/admin/logout", school: me.school.name, name: me.name });
  }
  // اشتراك متوقف: شاشة الاشتراك وحدها (البيانات محفوظة، والتجديد من هنا)
  if (me.access?.locked) return lockScreen(me, app);
  setCurrency(me.school.currency);
  const on = (key) => me.modules?.[key] !== false;
  // مدرسة جديدة: المعالج يملأ الشاشة قبل ظهور اللوحة، ويمكن تخطيه
  if (me.setup_completed === false) {
    mount(app,
      topbar({ school: me.school.name, subtitle: "إعداد المدرسة",
        onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } }),
      h("main", {}, await setupWizard({ me, refresh: () => location.reload() })),
      footer());
    return;
  }

  // التبويب يظهر فقط إذا كان قسمه مفعّلًا في هذه المدرسة
  const MODULE_OF = {
    attendance: "attendance", timetable: "timetable", exams: "exams", reports: "reports",
    analytics: "analytics", finance: "fees", ledger: "finance", admissions: "admissions", sheets: "attendance",
    distribution: "timetable",
    announcements: "announcements", papers: "exam_papers",
  };
  const allTabs = [
    ["dashboard", "الرئيسية"], ["students", "الطلاب"], ["teachers", "المعلمون"], ["structure", "الهيكل الأكاديمي"], ["academic", "السنة الدراسية"],
    ["attendance", "الحضور"], ["distribution", "توزيع المعلمين"], ["timetable", "الجدول"], ["exams", "الاختبارات"], ["papers", "الاختبارات الورقية"], ["reports", "كشف الدرجات"], ["sheets", "أوراق للطباعة"], ["analytics", "التحليلات"],
    ["finance", "الرسوم"], ["ledger", "المالية"], ["admissions", "طلبات التسجيل"], ["announcements", "التعاميم"], ["subscription", "اشتراكي"], ["settings", "الإعدادات"], ["audit", "السجل"],
  ].filter(([key]) => !MODULE_OF[key] || me.modules?.[MODULE_OF[key]]);

  const ctx = { me };
  const t = tabs(allTabs,
    { dashboard, setup: setupWizard, students, teachers, structure, academic, attendance, distribution, timetable, exams, papers, reports, sheets, analytics, finance, ledger, admissions, announcements, subscription: mySubscription, settings, audit }, ctx);
  ctx.goTo = (key) => t.show(key);

  mount(app,
    topbar({ school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`,
      onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } }),
    h("main", {}, accessBanner(me.access, ctx.goTo), t.el), footer());
  t.show("dashboard");
}
