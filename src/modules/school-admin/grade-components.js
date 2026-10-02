// توزيع الدرجات (الإدارة): أنواع الدرجات وأوزانها لكل المدرسة أو لكل صف
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import * as gc from "../shared/grade-components.service.js";

const r = Router();

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    items: await gc.list(q),
    grades: await q(`SELECT g.id, g.name, st.name AS stage FROM grades g JOIN stages st ON st.id = g.stage_id ORDER BY st.sort_order, g.sort_order, g.id`),
    templates: Object.entries(gc.TEMPLATES).map(([key, x]) => ({ key, name: x.name, items: x.items.map(([name, weight, def]) => ({ name, weight, is_default: !!def })) })),
  })));
}));

r.put("/", handle(async (req, res) => {
  const b = parse(gc.saveSchema, req.body);
  res.json(await inTenant(req, (q) => gc.save(q, b)));
}));

export default r;
