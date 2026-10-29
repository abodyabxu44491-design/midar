/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { setTerms, T } from "../shared/js/terms.js";
import { $, mount, h } from "../shared/js/dom.js";
import { mySubscription, accessBanner, lockScreen } from "./views/my-subscription.js";
import { api } from "../shared/js/api.js";
import { setCurrency } from "../shared/js/format.js";
import { attachBell } from "../shared/js/inbox.js";
import { topbar, footer, tabs, lazy, passwordChangeScreen, schoolLogoUrl } from "../shared/js/ui.js";
import { setApiBase } from "./views/common.js";
import dashboard from "./views/dashboard.js";
import { rememberSchool } from "../shared/js/recent.js";
const students = lazy(() => import("./views/students.js"), new URL("./views/students.js", import.meta.url).pathname);
const parents = lazy(() => import("./views/parents.js"), new URL("./views/parents.js", import.meta.url).pathname);
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
const quran = lazy(() => import("./views/quran.js"), new URL("./views/quran.js", import.meta.url).pathname);
const calendar = lazy(() => import("./views/calendar.js"), new URL("./views/calendar.js", import.meta.url).pathname);
const certificates = lazy(() => import("./views/certificates.js"), new URL("./views/certificates.js", import.meta.url).pathname);
const services = lazy(() => import("./views/services.js"), new URL("./views/services.js", import.meta.url).pathname);
const financeRequests = lazy(() => import("./views/finance-requests.js"), new URL("./views/finance-requests.js", import.meta.url).pathname);
const bookDeposits = lazy(() => import("./views/book-deposits.js"), new URL("./views/book-deposits.js", import.meta.url).pathname);
const aiAssistant = lazy(() => import("./views/ai.js"), new URL("./views/ai.js", import.meta.url).pathname);

const app = $("#app");

export async function startAdmin() {
  setApiBase("admin");
  const me = await api("/api/admin/me");
  rememberSchool({ id: me.school.id, name: me.school.name, role: "admin" });
  if (me.must_change_password) {
    return passwordChangeScreen({ endpoint: "/api/admin/password", logoutEndpoint: "/api/admin/logout", school: me.school.name, name: me.name });
  }
  if (me.access?.locked) return lockScreen(me, app);
  setCurrency(me.school.currency);
  setTerms(me.terms);
  if (me.org_type === "institute") return startInstitute(me);
  if (me.org_type === "university") return startUniversity(me);
  const on = (key) => me.modules?.[key] !== false;
  if (me.setup_completed === false) {
    mount(app,
      topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: "إعداد المدرسة",
        onLogout: async () => { await api("/api/admin/logout", {}); await api("/api/account/logout", {}).catch(() => {}); location.reload(); } }),
      h("main", {}, await setupWizard({ me, refresh: () => location.reload() })),
      footer());
    return;
  }

  const MODULE_OF = {
    attendance: "attendance", timetable: "timetable", exams: "exams", reports: "reports",
    analytics: "analytics", finance: "fees", ledger: "finance", admissions: "admissions", sheets: "attendance",
    distribution: "timetable",
    announcements: "announcements", papers: "exam_papers",
    communication: ["notifications", "messaging", "sms", "surveys", "meetings", "chat"], staff: ["staff_attendance", "substitutes", "lesson_plans"],
    behavior: "behavior", calendar: "calendar", certificates: "certificates",
    services: ["transport", "library", "inventory", "clinic"], ai: "ai_assistant", deposits: "finance", quran: "quran",
  };
  const schoolScope = me.admin_scope === "school";
  const FULL_ONLY = new Set(["finance", "ledger", "deposits", "subscription"]);
  const enabled = (m) => [].concat(m).some((k) => me.modules?.[k]);
  const allTabs = [
    ["dashboard", "الرئيسية"], ["ai", "المساعد الذكي"],
    [null, `${T("students")} والأسر`], ["students", T("students")], ["parents", T("guardians")], ["admissions", "طلبات التسجيل"],
    ["attendance", "الحضور"], ["behavior", "السلوك"],
    [null, "التعليم"], ["quran", "حلقات التحفيظ"], ["teachers", T("teachers")], ["timetable", "الجدول"], ["distribution", "توزيع المعلمين"],
    ["exams", "الدرجات"], ["papers", "أوراق الاختبارات"], ["reports", "كشف الدرجات"], ["certificates", "الشهادات"], ["sheets", "أوراق للطباعة"],
    [null, "المالية والموظفون"], ["finance", "الرسوم"], ["ledger", "المالية"], ["money-requests", "الطلبات المالية"], ["deposits", "تأمين الكتب"], ["staff", "شؤون الموظفين"],
    [null, "التواصل"], ["announcements", "التعاميم"], ["communication", "التواصل"],
    [null, "الإدارة"], ["academic", "السنة الدراسية"], ["calendar", "التقويم"], ["analytics", "التحليلات"], ["services", "الخدمات"],
    ["subscription", "اشتراكي"], ["settings", "الإعدادات"], ["audit", "السجل"],
  ]
    .filter(([key]) => !MODULE_OF[key] || enabled(MODULE_OF[key]))
    .filter(([key]) => !(key === "finance" && me.modules?.finance))
    .filter(([key]) => !(schoolScope && FULL_ONLY.has(key)));

  const ctx = { me, sections: allTabs.filter(([key]) => key && key !== "dashboard") };
  const t = tabs(allTabs,
    { dashboard, setup: setupWizard, students, parents, teachers, academic, attendance, distribution, timetable, exams, papers, reports, sheets, analytics, finance, ledger, admissions, announcements, subscription: mySubscription, settings, audit,
      communication, staff: staffAffairs, behavior, quran, calendar, certificates, services, ai: aiAssistant, "money-requests": financeRequests, deposits: bookDeposits }, ctx,
    { primary: [...(me.modules?.quran ? ["dashboard", "quran"] : ["dashboard"]),
      ...(schoolScope ? ["students", "attendance", "money-requests"] : ["students", "attendance", "ledger", "finance"])] });
  ctx.goTo = (key) => {
    if (key === "finance" && me.modules?.finance) {
      try { sessionStorage.setItem("midar_finance_part", "fees"); } catch { /* ignore */ }
      key = "ledger";
    }
    return t.show(key);
  };

  const bar = topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: `إدارة المدرسة — ${me.name}`,
    onLogout: async () => { await api("/api/admin/logout", {}); await api("/api/account/logout", {}).catch(() => {}); location.reload(); } });
  attachBell(bar, "/api/admin", (n) => {
    const tab = { leave: "staff", request: n.link === "staff" ? "staff" : "admissions", meeting: "communication", survey: "communication", grades_review: "exams",
      timetable: "timetable", announcement: "announcements", system: "students" }[n.kind] || n.link;
    if (n.link === "finance-requests") { ctx.goTo("money-requests"); return true; }
    if (!tab || !allTabs.some(([k]) => k === tab || (tab === "finance" && k === "ledger"))) return false;
    ctx.goTo(tab); return true;
  });
  mount(app, bar, h("main", {}, accessBanner(me.access, ctx.goTo), t.el), footer());
  t.start("dashboard");
}

// Universities: the registrar's office (structure, terms and sections, admission and registration, grades and records).
async function startUniversity(me) {
  const V = await import("./views/university.js");
  await V.loadMeta();
  const list = [
    ["dashboard", "الرئيسية"],
    [null, "الشؤون الأكاديمية"], ["ustructure", "الهيكل الأكاديمي"], ["uterms", "الفصول والشعب"], ["uinstructors", T("teachers")],
    [null, "القبول والتسجيل"], ["ustudents", T("students")],
    [null, "الإدارة"], ["usettings", "اللائحة والتقديرات"], ["subscription", "اشتراكي"], ["audit", "السجل"],
  ];
  const ctx = { me };
  const t = tabs(list, { dashboard: V.dashboard, ustructure: V.structure, uterms: V.terms, uinstructors: V.instructors, ustudents: V.students,
    usettings: V.settings, subscription: mySubscription, audit }, ctx, { primary: ["dashboard", "ustudents", "uterms", "ustructure"] });
  ctx.goTo = (key) => t.show(key);
  const bar = topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: `القبول والتسجيل — ${me.name}`,
    onLogout: async () => { await api("/api/admin/logout", {}); await api("/api/account/logout", {}).catch(() => {}); location.reload(); } });
  attachBell(bar, "/api/admin", () => false);
  mount(app, bar, h("main", {}, accessBanner(me.access, ctx.goTo), t.el), footer());
  t.start("dashboard");
}

// Institutes get their own sections; school sections stay hidden (and closed on the server for non-director roles).
async function startInstitute(me) {
  const [{ loadMeta, inst, T }, V] = await Promise.all([import("../shared/js/institute-ui.js"), import("./views/institute.js")]);
  const meta = await loadMeta("/api/admin/institute");
  inst.school = me.school.name;
  const can = (c) => meta.caps.includes(c);
  const director = meta.staff_role === "director";
  const list = [
    ["dashboard", "الرئيسية"],
    [null, "التدريب"], ["trainees", T("trainees")], ["courses", T("courses")], ["programs", T("programs")], ["sessions", "الجدول والحضور"],
    can("catalog") || director ? ["trainers", T("trainers")] : null,
    director && me.modules?.quran ? ["quran", "حلقات التحفيظ"] : null,
    [null, "النتائج والشهادات"], can("reports") ? ["ireports", "التقارير"] : null, ["icerts", "الشهادات"],
    [null, "المالية"], can("finance") ? ["ifees", "الرسوم والمدفوعات"] : null, director && me.modules?.finance ? ["ledger", "المالية"] : null,
    [null, "الإدارة"], director ? ["istaff", "الموظفون والصلاحيات"] : null, director ? ["isettings", `إعدادات ${T("org")}`] : null,
    director ? ["subscription", "اشتراكي"] : null, director ? ["audit", "السجل"] : null,
  ].filter(Boolean);
  const ctx = { me };
  const t = tabs(list, { dashboard: V.dashboard, trainees: V.trainees, courses: V.courses, programs: V.programs, sessions: V.sessions, trainers: V.trainers,
    ireports: V.reports, icerts: V.certificates, ifees: V.fees, ledger, quran, istaff: V.staff, isettings: V.settings, subscription: mySubscription, audit }, ctx,
  { primary: ["dashboard", "trainees", "courses", "sessions", can("finance") ? "ifees" : "icerts"] });
  ctx.goTo = (key) => t.show(key);
  const roleName = meta.labels.staff_roles[meta.staff_role] || `إدارة ${T("org")}`;
  const bar = topbar({ logo: schoolLogoUrl(me.school.id, me.school.logo), school: me.school.name, subtitle: `${roleName} — ${me.name}`,
    onLogout: async () => { await api("/api/admin/logout", {}); await api("/api/account/logout", {}).catch(() => {}); location.reload(); } });
  attachBell(bar, "/api/admin", () => false);
  mount(app, bar, h("main", {}, accessBanner(me.access, ctx.goTo), t.el), footer());
  t.start("dashboard");
}
