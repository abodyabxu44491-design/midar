/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// What this teacher does not need: the sections the administration hid (for all teachers or for him), and the
// attendance entry when the administration or the gate takes the attendance.
export const teacherHides = (me, key) => (me.prefs?.hidden || []).includes(key)
  || (key === "attendance" && (me.prefs?.attendance_by || "teacher") !== "teacher");
export const shows = (me, key, module = key) => (module === null || me.modules?.[module]) && !teacherHides(me, key);
