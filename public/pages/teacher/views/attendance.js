import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { myClasses } from "./home.js";

// params.classId يأتي من «حصص اليوم» ليفتح فصل الحصة مباشرة
export default function attendance({ me, params }) {
  return attendanceBoard("/api/teacher/attendance", myClasses(me), null, params?.classId);
}
