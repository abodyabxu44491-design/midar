import { attendanceBoard } from "/shared/js/attendance-board.js";
import { myClasses } from "./home.js";

export default function attendance({ me }) {
  return attendanceBoard("/api/teacher/attendance", myClasses(me));
}
