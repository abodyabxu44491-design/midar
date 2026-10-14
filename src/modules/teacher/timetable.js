/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { forTeacher, forToday } from "../shared/timetable.service.js";
import { dayStatus } from "../shared/attendance.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const day = await dayStatus(q, new Date().toISOString().slice(0, 10));
    return {
      week: await forTeacher(q, req.user.teacher_id),
      today: day.holiday ? [] : await forToday(q, req.user.teacher_id),
      holiday: day.holiday,
    };
  }));
}));

export default r;
