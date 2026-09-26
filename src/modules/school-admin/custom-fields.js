// الحقول المخصصة: تعريفها من الإعدادات، وقيمها مع كل طالب
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as fields from "../shared/custom-fields.service.js";

const r = Router();
const entity = z.enum(["student", "teacher", "staff"]);

r.get("/", handle(async (req, res) => {
  const e = req.query.entity ? parse(entity, req.query.entity) : null;
  res.json(await inTenant(req, (q) => fields.list(q, e)));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(fields.fieldSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => fields.addField(q, b)));
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(fields.fieldSchema.partial(), req.body);
  await inTenant(req, (q) => fields.updateField(q, id, b));
  res.json({ ok: true });
}));

r.delete("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => fields.removeField(q, id));
  res.json({ ok: true });
}));

// قيم كيان (طالب مثلًا)
r.get("/values/:entity/:id", handle(async (req, res) => {
  const e = parse(entity, req.params.entity);
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => fields.valuesOf(q, e, id)));
}));

r.put("/values/:entity/:id", handle(async (req, res) => {
  const e = parse(entity, req.params.entity);
  const id = parse(t.id, req.params.id);
  const b = parse(fields.valuesSchema, req.body);
  await inTenant(req, (q) => fields.saveValues(q, e, id, b.values));
  res.json({ ok: true });
}));

export default r;
