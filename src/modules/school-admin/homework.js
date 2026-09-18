// الواجبات (الإدارة: عرض ومتابعة وحذف)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import * as homework from "../shared/homework.service.js";

const r = Router();

r.get("/", handle(async (req, res) => res.json(await inTenant(req, homework.listAll))));

r.post("/", handle(async (req, res) => {
  const b = parse(homework.createSchema, req.body);
  res.status(201).json(await inTenant(req, (q) => homework.create(q, b, { actor: req.actor })));
}));

r.get("/:id/submissions", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, async (q) => homework.sheet(q, await homework.get(q, id))));
}));

r.delete("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const rows = await inTenant(req, (q) => homework.remove(q, id));
  if (!rows.length) throw notFound("الواجب غير موجود");
  res.json({ ok: true });
}));

export default r;
