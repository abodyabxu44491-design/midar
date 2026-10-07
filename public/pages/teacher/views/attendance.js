import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { myClasses } from "./home.js";
import { attendanceSource } from "../offline.js";

// params.classId يأتي من «حصص اليوم» ليفتح فصل الحصة مباشرة
// (المسح عند البوابة صار من جهاز بوابة تعتمده الإدارة — جوال الحارس أو المعلم المناوب — لا من حساب المعلم)
export default async function attendance({ me, params }) {
  // مصدر محلي: القراءة من الجهاز والكتابة عمليات تُزامَن (يعمل بدون إنترنت)
  return attendanceBoard(attendanceSource, myClasses(me), null, params?.classId);
}
