// تبويب الحضور (كل الفصول)
import { attendanceBoard } from "/shared/js/attendance-board.js";
import { A, loadClasses } from "./common.js";

export default async function attendance() {
  return attendanceBoard(`${A}/attendance`, await loadClasses());
}
