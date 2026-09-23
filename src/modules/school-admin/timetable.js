// الجدول الدراسي (الإدارة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as timetable from "../shared/timetable.service.js";
import * as gen from "../shared/timetable-gen.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  const classId = req.query.class_id ? parse(t.id, req.query.class_id) : null;
  res.json(await inTenant(req, (q) => (classId ? timetable.forClass(q, classId) : timetable.forAllClasses(q))));
}));

r.put("/slot", handle(async (req, res) => {
  const b = parse(timetable.slotSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const [c] = await q("SELECT id FROM classes WHERE id = $1", [b.class_id]);
    if (!c) throw notFound("الصف غير موجود");
    return timetable.setSlot(q, b);
  }));
}));

r.delete("/class/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json({ deleted: await inTenant(req, (q) => timetable.clearClass(q, id)) });
}));

/* ---------- إعدادات الجدول ---------- */
r.get("/settings", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({ settings: await gen.getSettings(q), times: gen.periodTimes(await gen.getSettings(q)) })));
}));

r.put("/settings", handle(async (req, res) => {
  const b = parse(gen.settingsSchema, req.body);
  res.json(await inTenant(req, (q) => gen.saveSettings(q, b)));
}));

/* ---------- نسخ جدول شعبة إلى أخرى ---------- */
r.post("/copy", handle(async (req, res) => {
  const b = parse(z.object({ from_class_id: t.id, to_class_id: t.id, keep_teachers: z.boolean().default(false) }), req.body);
  if (b.from_class_id === b.to_class_id) throw notFound("اختر شعبتين مختلفتين");
  res.json(await inTenant(req, async (q) => {
    const [target] = await q("SELECT id FROM classes WHERE id = $1", [b.to_class_id]);
    if (!target) throw notFound("الشعبة الهدف غير موجودة");
    const source = await q("SELECT day, period, subject_id, teacher_id, room FROM timetable_slots WHERE class_id = $1",
      [b.from_class_id]);
    await q("DELETE FROM timetable_slots WHERE class_id = $1", [b.to_class_id]);
    let copied = 0, skipped = 0;
    for (const s of source) {
      // المعلم يُنسخ فقط إذا كان متفرغًا في ذلك الوقت، وإلا تُترك الحصة بلا معلم
      let teacher = b.keep_teachers ? s.teacher_id : null;
      if (teacher) {
        const [busy] = await q(
          "SELECT 1 FROM timetable_slots WHERE teacher_id = $1 AND day = $2 AND period = $3", [teacher, s.day, s.period]);
        if (busy) { teacher = null; skipped++; }
      }
      await q(
        `INSERT INTO timetable_slots (tenant_id, class_id, day, period, subject_id, teacher_id, room)
         VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) ON CONFLICT (class_id, day, period) DO NOTHING`,
        [b.to_class_id, s.day, s.period, s.subject_id, teacher, s.room]);
      copied++;
    }
    return { copied, without_teacher: skipped };
  }));
}));

/* ---------- التوليد التلقائي ---------- */
r.post("/generate", handle(async (req, res) => {
  const b = parse(gen.generateSchema, req.body);
  res.json(await inTenant(req, (q) => gen.generate(q, b)));     // مسودة فقط، لا تُحفظ
}));

r.post("/apply", handle(async (req, res) => {
  const b = parse(gen.applySchema, req.body);
  res.json(await inTenant(req, (q) => gen.apply(q, b)));
}));

r.get("/conflicts", handle(async (req, res) => {
  res.json(await inTenant(req, gen.conflicts));
}));

export default r;
