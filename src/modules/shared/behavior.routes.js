// مسارات السلوك: الإدارة (كل الطلاب والبنود) والمعلم (طلاب فصوله فقط، وحذف ما سجله هو)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as behavior from "./behavior.service.js";
import { featureSettings } from "./feature-settings.service.js";
import { teachesClass } from "../teacher/access.js";

export function behaviorRouter(role) {
  const r = Router();
  const teacherId = (req) => (role === "teacher" ? req.user.teacher_id : null);

  r.get("/categories", handle(async (req, res) => {
    res.json(await inTenant(req, (q) => behavior.categories(q, { activeOnly: role === "teacher" })));
  }));
  r.get("/", handle(async (req, res) => {
    const f = parse(behavior.listQuery, req.query);
    res.json(await inTenant(req, (q) => behavior.list(q, f, { teacherId: teacherId(req) })));
  }));
  r.get("/summary", handle(async (req, res) => {
    const { class_id } = parse(behavior.listQuery.pick({ class_id: true }), req.query);
    res.json(await inTenant(req, (q) => behavior.summary(q, { class_id, teacherId: teacherId(req) })));
  }));
  r.get("/student/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    res.json(await inTenant(req, async (q) => {
      const [s] = await q("SELECT id, full_name, class_id FROM students WHERE id = $1", [id]);
      if (!s) throw forbidden("الطالب غير موجود");
      if (role === "teacher" && !(await teachesClass(q, req.user.teacher_id, s.class_id))) throw forbidden("الطالب ليس ضمن فصولك");
      return { student: { id: s.id, name: s.full_name }, ...(await behavior.forStudent(q, id)) };
    }));
  }));
  r.post("/", handle(async (req, res) => {
    const b = parse(behavior.recordSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => {
      if (role === "teacher" && !(await featureSettings(q, "behavior")).teacher_can_record) throw forbidden("تسجيل السلوك للإدارة فقط في هذه المدرسة");
      return behavior.record(q, b, { teacherId: teacherId(req), actor: req.actor,
        allowedClass: role === "teacher" ? (cid) => teachesClass(q, req.user.teacher_id, cid) : null });
    }));
  }));
  r.delete("/:id", handle(async (req, res) => {
    const id = parse(t.id, req.params.id);
    await inTenant(req, (q) => behavior.remove(q, id, { teacherId: teacherId(req) }));
    res.json({ ok: true });
  }));

  if (role === "admin") {
    r.post("/categories", handle(async (req, res) => {
      const b = parse(behavior.categorySchema, req.body);
      res.status(201).json(await inTenant(req, (q) => behavior.addCategory(q, b)));
    }));
    r.patch("/categories/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      const b = parse(behavior.categorySchema.partial(), req.body);
      await inTenant(req, (q) => behavior.updateCategory(q, id, b));
      res.json({ ok: true });
    }));
    r.delete("/categories/:id", handle(async (req, res) => {
      const id = parse(t.id, req.params.id);
      res.json(await inTenant(req, (q) => behavior.removeCategory(q, id)));
    }));
  }
  return r;
}
