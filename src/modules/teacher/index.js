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

const r = Router();
r.use(logoutRouter("teacher"));
r.use(requireStaff("teacher"));
r.post("/password", changePassword);
r.use(profile);
r.use("/attendance", requireModule("attendance"), attendance);
r.use("/exams", requireModule("exams"), exams);
r.use("/timetable", requireModule("timetable"), timetable);
r.use("/homework", requireModule("homework"), homework);
r.use("/papers", requireModule("exam_papers"), papersRouter("teacher"));
export default r;
