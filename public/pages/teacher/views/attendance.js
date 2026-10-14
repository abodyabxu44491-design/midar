/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { attendanceBoard } from "../../shared/js/attendance-board.js";
import { myClasses } from "./home.js";
import { attendanceSource } from "../offline.js";

export default async function attendance({ me, params }) {
  return attendanceBoard(attendanceSource, myClasses(me), null, params?.classId);
}
