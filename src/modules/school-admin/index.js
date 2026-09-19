// لوحة إدارة المدرسة — تجميع الأقسام
// كل قسم في ملف مستقل. لإضافة قسم جديد: أنشئ ملفًا يصدّر Router ثم سجّله هنا.
import { Router } from "express";
import { requireStaff } from "../../core/auth/guards.js";
import { logoutRouter, changePassword } from "../shared/staff-auth.js";
import dashboard from "./dashboard.js";
import structure from "./structure.js";
import teachers from "./teachers.js";
import students from "./students.js";
import attendance from "./attendance.js";
import exams from "./exams.js";
import finance from "./finance.js";
import ledger from "./ledger.js";
import announcements from "./announcements.js";
import settings from "./settings.js";
import audit from "./audit.js";
import timetable from "./timetable.js";
import academic from "./academic.js";
import analytics from "./analytics.js";
import reports from "./reports.js";
import messaging from "./messaging.js";
import exportData from "./export.js";
import homework from "./homework.js";
import admissions from "./admissions.js";

const r = Router();
r.use(logoutRouter("admin"));            // /logout (بدون حارس)
r.use(requireStaff("admin"));             // كل ما بعده للمدير فقط
r.post("/password", changePassword);
r.use(dashboard);
r.use("/structure", structure);
r.use("/teachers", teachers);
r.use("/students", students);
r.use("/attendance", attendance);
r.use("/exams", exams);
r.use("/finance", finance);
r.use("/ledger", ledger);
r.use("/announcements", announcements);
r.use("/settings", settings);
r.use("/academic", academic);
r.use("/analytics", analytics);
r.use("/timetable", timetable);
r.use("/reports", reports);
r.use("/messaging", messaging);
r.use("/homework", homework);
r.use("/admissions", admissions);
r.use("/export", exportData);
r.use("/audit", audit);
export default r;
