// جدول المعلم وحصص اليوم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { forTeacher, forToday } from "../shared/timetable.service.js";
import { dayStatus } from "../shared/attendance.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    // يوم الإجازة: لا حصص اليوم، ويُعاد سبب الإجازة لعرضه للمعلم
    const day = await dayStatus(q, new Date().toISOString().slice(0, 10));
    return {
      week: await forTeacher(q, req.user.teacher_id),
      today: day.holiday ? [] : await forToday(q, req.user.teacher_id),
      holiday: day.holiday,
    };
  }));
}));

export default r;
