// المعلم: حضوري وإجازاتي وحصص الانتظار، وتحضير الدروس، والتقويم
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z as zz } from "../../core/http/validate.js";
import { requireModule } from "../../core/auth/guards.js";
import * as sa from "../shared/staff-affairs.service.js";
import * as plans from "../shared/lesson-plans.service.js";
import * as cal from "../shared/calendar.service.js";
import * as en from "../shared/engagement.service.js";

export const mine = Router();
mine.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    ...(await sa.myStatus(q, req.user.teacher_id)),
    substitutions: req.modules?.substitutes ? await sa.mySubstitutions(q, req.user.teacher_id) : [],
  })));
}));
mine.post("/check-in", handle(async (req, res) => res.json(await inTenant(req, (q) => sa.selfCheck(q, req.user.teacher_id, "in", req.actor)))));
mine.post("/check-out", handle(async (req, res) => res.json(await inTenant(req, (q) => sa.selfCheck(q, req.user.teacher_id, "out", req.actor)))));
mine.post("/leaves", handle(async (req, res) => {
  const b = parse(sa.leaveSchema, req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    const [s] = await q("SELECT id FROM staff WHERE teacher_id = $1", [req.user.teacher_id]);
    if (!s) throw notFound("لا يوجد سجل وظيفي لهذا الحساب. تواصل مع الإدارة.");
    return sa.requestLeave(q, b, { staffId: s.id, actor: req.actor });
  }));
}));
mine.post("/leaves/:id/cancel", handle(async (req, res) => {
  await inTenant(req, async (q) => {
    const [s] = await q("SELECT id FROM staff WHERE teacher_id = $1", [req.user.teacher_id]);
    await sa.cancelLeave(q, parse(t.id, req.params.id), s?.id ?? 0);
  });
  res.json({ ok: true });
}));

export const lessons = Router();
lessons.get("/", handle(async (req, res) => res.json(await inTenant(req, (q) => plans.list(q, { teacherId: req.user.teacher_id })))));
lessons.post("/", handle(async (req, res) => {
  const b = parse(plans.planSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => plans.save(q, req.user.teacher_id, b)));
}));
lessons.put("/:id", handle(async (req, res) => {
  const b = parse(plans.planSchema, req.body);
  res.json(await inTenant(req, (q) => plans.save(q, req.user.teacher_id, b, parse(t.id, req.params.id))));
}));
lessons.delete("/:id", handle(async (req, res) => {
  await inTenant(req, (q) => plans.remove(q, req.user.teacher_id, parse(t.id, req.params.id)));
  res.json({ ok: true });
}));

export const calendar = Router();
calendar.get("/", handle(async (req, res) => {
  const r = parse(cal.rangeSchema, req.query);
  res.json(await inTenant(req, async (q) => {
    const cls = (await q("SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id = $1", [req.user.teacher_id])).map((x) => Number(x.class_id));
    return cal.feed(q, r, { view: "staff", classIds: cls.length ? cls : [0] });
  }));
}));

export const teacherStaffRoutes = (r) => {
  r.use("/me-staff", requireModule("staff_attendance"), mine);
  r.use("/lesson-plans", requireModule("lesson_plans"), lessons);
  r.use("/calendar", requireModule("calendar"), calendar);
  r.use("/surveys", requireModule("surveys"), surveys);
  r.use("/meetings", requireModule("meetings"), meetings);
};

// الاستبيانات للمعلم، ومواعيده مع أولياء الأمور
export const surveys = Router();
surveys.get("/", handle(async (req, res) => res.json(await inTenant(req, (q) => en.availableFor(q, { user_id: req.user.id })))));
surveys.post("/:id", handle(async (req, res) => {
  const { answers } = parse(en.respondSchema, req.body);
  res.json(await inTenant(req, (q) => en.respond(q, parse(t.id, req.params.id), { user_id: req.user.id }, answers)));
}));
export const meetings = Router();
meetings.get("/", handle(async (req, res) => res.json(await inTenant(req, (q) => en.slotsList(q, { teacherId: req.user.teacher_id })))));
meetings.post("/", handle(async (req, res) => {
  const b = parse(en.slotsSchema.omit({ teacher_id: true, host_name: true }), req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    if (b.class_id) {
      const [ok] = await q("SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2", [req.user.teacher_id, b.class_id]);
      if (!ok) throw notFound("الشعبة غير مسندة لك");
    }
    return en.createSlots(q, b, { teacherId: req.user.teacher_id, hostName: req.user.full_name, actor: req.actor });
  }));
}));
meetings.delete("/:id", handle(async (req, res) => { await inTenant(req, (q) => en.removeSlot(q, parse(t.id, req.params.id), { teacherId: req.user.teacher_id })); res.json({ ok: true }); }));
meetings.post("/bookings/:id", handle(async (req, res) => {
  const { status } = parse(zz.object({ status: zz.enum(["done", "no_show", "cancelled"]) }), req.body);
  await inTenant(req, (q) => en.setBookingStatus(q, parse(t.id, req.params.id), status, { teacherId: req.user.teacher_id }));
  res.json({ ok: true });
}));
