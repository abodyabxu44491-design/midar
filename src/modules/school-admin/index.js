// لوحة إدارة المدرسة — تجميع الأقسام
// كل قسم في ملف مستقل. لإضافة قسم جديد: أنشئ ملفًا يصدّر Router ثم سجّله هنا.
import { Router } from "express";
import { requireStaff, requireModule } from "../../core/auth/guards.js";
import { logoutRouter, changePassword } from "../shared/staff-auth.js";
import dashboard from "./dashboard.js";
import structure from "./structure.js";
import teachers from "./teachers.js";
import students from "./students.js";
import attendance from "./attendance.js";
import exams from "./exams.js";
import gradeComponents from "./grade-components.js";
import finance from "./finance.js";
import ledger from "./ledger.js";
import users from "./users.js";
import passwordRequests from "./password-requests.js";
import announcements from "./announcements.js";
import settings from "./settings.js";
import subscription from "./subscription.js";
import ai from "./ai.js";
import danger from "./danger.js";
import audit from "./audit.js";
import timetable from "./timetable.js";
import academic from "./academic.js";
import analytics from "./analytics.js";
import reports from "./reports.js";
import messaging from "./messaging.js";
import exportData from "./export.js";
import importData from "./import.js";
import sheets from "./sheets.js";
import setup from "./setup.js";
import customFields from "./custom-fields.js";
import homework from "./homework.js";
import admissions from "./admissions.js";
import communication from "./communication.js";
import { behaviorRouter } from "../shared/behavior.routes.js";
import certificates from "./certificates.js";
import { staff as staffAffairs, calendar } from "./staff-affairs.js";
import services from "./services.js";
import engagement from "./engagement.js";
import { onlineExamsRouter } from "../shared/online-exams.routes.js";
import { papersRouter, papersAdminSettingsRouter } from "../shared/exam-papers.routes.js";
import { adminSyncRouter } from "../shared/sync.routes.js";
import { jobsRouter } from "../shared/jobs.routes.js";
import { staffNotificationsRouter } from "../shared/notifications.routes.js";

const r = Router();
r.use(logoutRouter("admin"));            // /logout (بدون حارس)
r.use(requireStaff("admin"));             // كل ما بعده للمدير فقط
r.post("/password", changePassword);
r.use(dashboard);
r.use("/structure", structure);
r.use("/teachers", teachers);
r.use("/students", students);
r.use("/attendance", requireModule("attendance"), attendance);
r.use("/exams", requireModule("exams"), exams);
r.use("/grade-components", requireModule("exams"), gradeComponents);
r.use("/finance", requireModule("fees"), finance);
r.use("/ledger", requireModule("finance"), ledger);
r.use("/users", users);
r.use("/notifications", staffNotificationsRouter());   // صندوق الإشعارات والإشعار الفوري
r.use("/jobs", jobsRouter("school"));     // تقدم العمليات الطويلة (الاستيراد)
r.use("/password-requests", passwordRequests);
r.use("/announcements", requireModule("announcements"), announcements);
r.use("/settings", settings);
r.use("/communication", communication);   // الإشعارات والرسائل النصية وإعدادات الأقسام الجديدة
r.use("/subscription", subscription);     // متاح حتى عند توقف الاشتراك (للتجديد)
r.use("/academic", academic);
r.use("/analytics", requireModule("analytics"), analytics);
r.use("/timetable", requireModule("timetable"), timetable);
r.use("/reports", requireModule("exams", "reports"), reports);
r.use("/messaging", requireModule("messaging"), messaging);
r.use("/homework", requireModule("homework"), homework);
r.use("/behavior", requireModule("behavior"), behaviorRouter("admin"));
r.use("/certificates", requireModule("certificates"), certificates);
r.use("/staff-affairs", staffAffairs);   // كل قسم داخله بحارسه
r.use("/calendar", requireModule("calendar"), calendar);
r.use("/engagement", engagement);        // الاستبيانات ومواعيد أولياء الأمور
r.use("/services", services);            // النقل والمكتبة والمخزون والعيادة (كل قسم بحارسه)
r.use("/admissions", requireModule("admissions"), admissions);
r.use("/papers", requireModule("exam_papers"), papersRouter("admin"));
r.use("/online-exams", requireModule("online_exams"), onlineExamsRouter("admin"));
r.use("/papers-settings", requireModule("exam_papers"), papersAdminSettingsRouter());
r.use("/sync", adminSyncRouter());         // تعارضات المزامنة والأجهزة
r.use("/import", importData);
r.use("/sheets", sheets);
r.use("/setup", setup);
r.use("/custom-fields", customFields);
r.use("/export", exportData);
r.use("/audit", audit);
r.use("/ai", requireModule("ai_assistant"), ai);   // المساعد الذكي (قراءة فقط)
r.use("/danger", danger);            // منطقة الحذر (حسب صلاحية المدير)
export default r;
