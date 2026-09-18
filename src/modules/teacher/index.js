// بوابة المعلم — منفصلة تمامًا عن الإدارة. كل قسم في ملف.
import { Router } from "express";
import { requireStaff } from "../../core/auth/guards.js";
import { logoutRouter, changePassword } from "../shared/staff-auth.js";
import profile from "./profile.js";
import attendance from "./attendance.js";
import exams from "./exams.js";
import timetable from "./timetable.js";

const r = Router();
r.use(logoutRouter("teacher"));
r.use(requireStaff("teacher"));
r.post("/password", changePassword);
r.use(profile);
r.use("/attendance", attendance);
r.use("/exams", exams);
r.use("/timetable", timetable);
export default r;
