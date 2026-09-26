import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { myClasses } from "./home.js";
import { attendanceSource } from "../offline.js";

// params.classId يأتي من «حصص اليوم» ليفتح فصل الحصة مباشرة
export default function attendance({ me, params }) {
  // مصدر محلي: القراءة من الجهاز والكتابة عمليات تُزامَن (يعمل بدون إنترنت)
  return attendanceBoard(attendanceSource, myClasses(me), null, params?.classId);
}
