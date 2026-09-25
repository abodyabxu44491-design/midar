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
import finance from "./finance.js";
import ledger from "./ledger.js";
import users from "./users.js";
import passwordRequests from "./password-requests.js";
import announcements from "./announcements.js";
import settings from "./settings.js";
import subscription from "./subscription.js";
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
import { papersRouter, papersAdminSettingsRouter } from "../shared/exam-papers.routes.js";

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
r.use("/finance", requireModule("fees"), finance);
r.use("/ledger", requireModule("finance"), ledger);
r.use("/users", users);
r.use("/password-requests", passwordRequests);
r.use("/announcements", requireModule("announcements"), announcements);
r.use("/settings", settings);
r.use("/subscription", subscription);     // متاح حتى عند توقف الاشتراك (للتجديد)
r.use("/academic", academic);
r.use("/analytics", requireModule("analytics"), analytics);
r.use("/timetable", requireModule("timetable"), timetable);
r.use("/reports", requireModule("exams", "reports"), reports);
r.use("/messaging", requireModule("messaging"), messaging);
r.use("/homework", requireModule("homework"), homework);
r.use("/admissions", requireModule("admissions"), admissions);
r.use("/papers", requireModule("exam_papers"), papersRouter("admin"));
r.use("/papers-settings", requireModule("exam_papers"), papersAdminSettingsRouter());
r.use("/import", importData);
r.use("/sheets", sheets);
r.use("/setup", setup);
r.use("/custom-fields", customFields);
r.use("/export", exportData);
r.use("/audit", audit);
export default r;
