// الاستبيانات ومواعيد أولياء الأمور (الإدارة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { requireModule } from "../../core/auth/guards.js";
import * as en from "../shared/engagement.service.js";

const r = Router();
const run = (fn) => handle(async (req, res) => res.json(await inTenant(req, (q) => fn(q, req))));
const id = (req) => parse(t.id, req.params.id);

const sv = Router();
sv.get("/", run((q) => en.listSurveys(q)));
sv.post("/", run((q, req) => en.createSurvey(q, parse(en.surveySchema, req.body), req.actor)));
sv.get("/:id", run((q, req) => en.results(q, id(req))));
sv.post("/:id/status", run(async (q, req) => { await en.setSurveyStatus(q, id(req), parse(z.object({ status: z.enum(["open", "closed"]) }), req.body).status); return { ok: true }; }));
sv.delete("/:id", run(async (q, req) => { await en.removeSurvey(q, id(req)); return { ok: true }; }));
r.use("/surveys", requireModule("surveys"), sv);

const mt = Router();
mt.get("/", run((q) => en.slotsList(q, { adminView: true })));
mt.post("/", run(async (q, req) => {
  const b = parse(en.slotsSchema, req.body);
  let host = b.host_name || "إدارة المدرسة";
  if (b.teacher_id) {
    const [tch] = await q("SELECT full_name FROM teachers WHERE id = $1", [b.teacher_id]);
    if (!tch) throw notFound("المعلم غير موجود");
    host = tch.full_name;
  }
  return en.createSlots(q, b, { teacherId: b.teacher_id ?? null, hostName: host, actor: req.actor });
}));
mt.delete("/:id", run(async (q, req) => { await en.removeSlot(q, id(req)); return { ok: true }; }));
mt.post("/bookings/:id", run(async (q, req) => { await en.setBookingStatus(q, id(req), parse(z.object({ status: z.enum(["done", "no_show", "cancelled"]) }), req.body).status); return { ok: true }; }));
r.use("/meetings", requireModule("meetings"), mt);
export default r;
