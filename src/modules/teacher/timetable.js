// جدول المعلم وحصص اليوم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { forTeacher, forToday } from "../shared/timetable.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    week: await forTeacher(q, req.user.teacher_id),
    today: await forToday(q, req.user.teacher_id),
  })));
}));

export default r;
