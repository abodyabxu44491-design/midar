// لوحة إدارة المدرسة. كل تبويب في ملف داخل views/
// تُشغَّل من باب المدرسة الموحّد بعد التعرف على دور الحساب.
import { $, mount, h } from "../shared/js/dom.js";
import { mySubscription, accessBanner, lockScreen } from "./views/my-subscription.js";
import { api } from "../shared/js/api.js";
import { setCurrency } from "../shared/js/format.js";
import { attachBell } from "../shared/js/inbox.js";
import { topbar, footer, tabs, lazy, passwordChangeScreen, schoolLogoUrl } from "../shared/js/ui.js";
import { setApiBase } from "./views/common.js";
import dashboard from "./views/dashboard.js";
const students = lazy(() => import("./views/students.js"), new URL("./views/students.js", import.meta.url).pathname);
const teachers = lazy(() => import("./views/teachers.js"), new URL("./views/teachers.js", import.meta.url).pathname);
const setupWizard = lazy(() => import("./views/setup.js"), new URL("./views/setup.js", import.meta.url).pathname);
const distribution = lazy(() => import("./views/distribution.js"), new URL("./views/distribution.js", import.meta.url).pathname);
const academic = lazy(() => import("./views/academic.js"), new URL("./views/academic.js", import.meta.url).pathname);
const attendance = lazy(() => import("./views/attendance.js"), new URL("./views/attendance.js", import.meta.url).pathname);
const exams = lazy(() => import("./views/exams.js"), new URL("./views/exams.js", import.meta.url).pathname);
const finance = lazy(() => import("./views/finance.js"), new URL("./views/finance.js", import.meta.url).pathname);
const ledger = lazy(() => import("./views/ledger.js"), new URL("./views/ledger.js", import.meta.url).pathname);
const announcements = lazy(() => import("./views/announcements.js"), new URL("./views/announcements.js", import.meta.url).pathname);
const settings = lazy(() => import("./views/settings.js"), new URL("./views/settings.js", import.meta.url).pathname);
const audit = lazy(() => import("./views/audit.js"), new URL("./views/audit.js", import.meta.url).pathname);
const timetable = lazy(() => import("./views/timetable.js"), new URL("./views/timetable.js", import.meta.url).pathname);
const reports = lazy(() => import("./views/reports.js"), new URL("./views/reports.js", import.meta.url).pathname);
const sheets = lazy(() => import("./views/sheets.js"), new URL("./views/sheets.js", import.meta.url).pathname);
const analytics = lazy(() => import("./views/analytics.js"), new URL("./views/analytics.js", import.meta.url).pathname);
const admissions = lazy(() => import("./views/admissions.js"), new URL("./views/admissions.js", import.meta.url).pathname);
const papers = lazy(() => import("./views/papers.js"), new URL("./views/papers.js", import.meta.url).pathname);
const communication = lazy(() => import("./views/communication.js"), new URL("./views/communication.js", import.meta.url).pathname);
const staffAffairs = lazy(() => import("./views/staff-affairs.js"), new URL("./views/staff-affairs.js", import.meta.url).pathname);
const behavior = lazy(() => import("./views/behavior.js"), new URL("./views/behavior.js", import.meta.url).pathname);
const calendar = lazy(() => import("./views/calendar.js"), new URL("./views/calendar.js", import.meta.url).pathname);
const certificates = lazy(() => import("./views/certificates.js"), new URL("./views/certificates.js", import.meta.url).pathname);
const services = lazy(() => import("./views/services.js"), new URL("./views/services.js", import.meta.url).pathname);
const aiAssistant = lazy(() => import("./views/ai.js"), new URL("./views/ai.js", import.meta.url).pathname);

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
      topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: "إعداد المدرسة",
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
    // الأقسام الجامعة: تظهر إذا كان أي قسم فيها مفعّلًا
    communication: ["notifications", "messaging", "sms", "surveys", "meetings"], staff: ["staff_attendance", "substitutes", "lesson_plans"],
    behavior: "behavior", calendar: "calendar", certificates: "certificates",
    services: ["transport", "library", "inventory", "clinic"], ai: "ai_assistant",
  };
  const enabled = (m) => [].concat(m).some((k) => me.modules?.[k]);
  // الأقسام بترتيب العمل اليومي، بلا عناوين تجميع
  const allTabs = [
    ["dashboard", "الرئيسية"], ["ai", "المساعد الذكي"],
    ["students", "الطلاب"], ["teachers", "المعلمون"], ["staff", "شؤون الموظفين"],
    ["attendance", "الحضور"], ["behavior", "السلوك"], ["timetable", "الجدول"], ["distribution", "توزيع المعلمين"],
    ["exams", "الاختبارات"], ["papers", "الاختبارات الورقية"], ["reports", "كشف الدرجات"], ["certificates", "الشهادات"],
    ["academic", "السنة الدراسية"], ["calendar", "التقويم"], ["sheets", "أوراق للطباعة"], ["analytics", "التحليلات"],
    ["finance", "الرسوم"], ["ledger", "المالية"], ["services", "الخدمات"], ["admissions", "طلبات التسجيل"],
    ["announcements", "التعاميم"], ["communication", "التواصل"], ["subscription", "اشتراكي"],
    ["settings", "الإعدادات"], ["audit", "السجل"],
  ]
    .filter(([key]) => !MODULE_OF[key] || enabled(MODULE_OF[key]))
    // مع النظام المالي تصبح «الرسوم» جزءًا من «المالية» (تبويب واحد لكل المال)
    .filter(([key]) => !(key === "finance" && me.modules?.finance));

  const ctx = { me };
  const t = tabs(allTabs,
    { dashboard, setup: setupWizard, students, teachers, academic, attendance, distribution, timetable, exams, papers, reports, sheets, analytics, finance, ledger, admissions, announcements, subscription: mySubscription, settings, audit,
      communication, staff: staffAffairs, behavior, calendar, certificates, services, ai: aiAssistant }, ctx);
  ctx.goTo = (key) => {
    // روابط «الرسوم» القديمة (من الرئيسية والتنبيهات) تفتح قسم الرسوم داخل المالية
    if (key === "finance" && me.modules?.finance) {
      try { sessionStorage.setItem("midar_finance_part", "fees"); } catch { /* تجاهل */ }
      key = "ledger";
    }
    return t.show(key);
  };

  const bar = topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`,
    onLogout: async () => { await api("/api/admin/logout", {}); location.reload(); } });
  attachBell(bar, "/api/admin", (n) => {
    const tab = { leave: "staff", request: n.link === "staff" ? "staff" : "admissions", meeting: "communication", survey: "communication", grades_review: "exams",
      timetable: "timetable", announcement: "announcements", system: "students" }[n.kind] || n.link;
    if (!tab || !allTabs.some(([k]) => k === tab || (tab === "finance" && k === "ledger"))) return false;
    ctx.goTo(tab); return true;
  });
  mount(app, bar, h("main", {}, accessBanner(me.access, ctx.goTo), t.el), footer());
  t.start("dashboard");
}
