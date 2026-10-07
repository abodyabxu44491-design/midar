import { h } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { btn, dialog } from "../../shared/js/ui.js";
import { gateScanner } from "../../shared/js/gate-scanner.js";
import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { myClasses } from "./home.js";
import { attendanceSource } from "../offline.js";

// params.classId يأتي من «حصص اليوم» ليفتح فصل الحصة مباشرة
export default async function attendance({ me, params }) {
  // مصدر محلي: القراءة من الجهاز والكتابة عمليات تُزامَن (يعمل بدون إنترنت)
  const board = attendanceBoard(attendanceSource, myClasses(me), null, params?.classId);
  // بوابة الحضور للمعلم المناوب (إن سمحت الإدارة، وتحتاج اتصالًا)
  const gate = await api("/api/teacher/attendance/gate").catch(() => null);
  const open = () => dialog("بوابة الحضور", gateScanner("/api/teacher"));
  return [gate?.allowed ? h("div", { class: "toolbar" }, btn("بوابة الحضور: مسح بطاقات الطلاب", open, "ghost")) : null, await board];
}
