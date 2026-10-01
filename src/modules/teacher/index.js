// بوابة المعلم — منفصلة تمامًا عن الإدارة. كل قسم في ملف.
import { Router } from "express";
import { requireStaff, requireModule } from "../../core/auth/guards.js";
import { logoutRouter, changePassword } from "../shared/staff-auth.js";
import profile from "./profile.js";
import attendance from "./attendance.js";
import exams from "./exams.js";
import timetable from "./timetable.js";
import homework from "./homework.js";
import { papersRouter } from "../shared/exam-papers.routes.js";
import { teacherSyncRouter } from "../shared/sync.routes.js";
import { staffNotificationsRouter } from "../shared/notifications.routes.js";
import { behaviorRouter } from "../shared/behavior.routes.js";
import { onlineExamsRouter } from "../shared/online-exams.routes.js";
import { teacherStaffRoutes } from "./staff.js";

const r = Router();
r.use(logoutRouter("teacher"));
r.use(requireStaff("teacher"));
r.post("/password", changePassword);
r.use(profile);
r.use("/notifications", staffNotificationsRouter());
r.use("/attendance", requireModule("attendance"), attendance);
r.use("/exams", requireModule("exams"), exams);
r.use("/timetable", requireModule("timetable"), timetable);
r.use("/homework", requireModule("homework"), homework);
r.use("/behavior", requireModule("behavior"), behaviorRouter("teacher"));
r.use("/papers", requireModule("exam_papers"), papersRouter("teacher"));
r.use("/online-exams", requireModule("online_exams"), onlineExamsRouter("teacher"));
teacherStaffRoutes(r);
r.use("/sync", teacherSyncRouter());      // العمل بدون إنترنت: الحضور والدرجات
export default r;
