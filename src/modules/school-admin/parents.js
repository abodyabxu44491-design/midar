// أولياء الأمور (الإدارة): حساب واحد لكل ولي أمر مرتبط بكل أبنائه، وإنشاء الحسابات تلقائيًا من أرقام الجوال،
// وربط وفك ارتباط الأبناء، وإعادة كلمة المرور، والإيقاف، ومراجعة طلبات الربط.
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, z, t } from "../../core/http/validate.js";
import * as parents from "../shared/parents.service.js";
import { getFeatureSettings, updateFeatureSettings } from "../shared/feature-settings.service.js";

const r = Router();
const idP = z.object({ id: t.id });

r.get("/", handle(async (req, res) => {
  const { search } = parse(z.object({ search: z.string().trim().max(60).optional().default("") }), req.query);
  res.json(await inTenant(req, (q) => parents.listParents(q, { search })));
}));
r.post("/", handle(async (req, res) => {
  const b = parse(parents.parentBody, req.body);
  res.status(201).json(await inTenant(req, (q) => parents.createParent(q, b, { actor: req.actor })));
}));
r.get("/settings", handle(async (req, res) => res.json(await inTenant(req, async (q) => (await getFeatureSettings(q)).parents))));
r.put("/settings", handle(async (req, res) => res.json(await inTenant(req, (q) => updateFeatureSettings(q, "parents", req.body || {})))));
r.post("/auto-create", handle(async (req, res) => res.json(await inTenant(req, (q) => parents.autoCreate(q, { actor: req.actor })))));
r.get("/requests", handle(async (req, res) => res.json(await inTenant(req, parents.listRequests))));
r.post("/requests/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  res.json(await inTenant(req, (q) => parents.decideRequest(q, id, approve, { actor: req.actor })));
}));
r.get("/of-student/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => parents.parentsOfStudent(q, id)));
}));

r.get("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => parents.getParent(q, id)));
}));
r.patch("/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(parents.parentBody, req.body);
  res.json(await inTenant(req, (q) => parents.updateParent(q, id, b)));
}));
r.post("/:id/link", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(parents.linkBody, req.body);
  res.json(await inTenant(req, async (q) => {
    await parents.getParent(q, id);
    return parents.link(q, id, b.student_id, { actor: req.actor, relation: b.relation || null, canViewFees: b.can_view_fees ?? null });
  }));
}));
r.post("/:id/unlink", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { student_id } = parse(z.object({ student_id: t.id }), req.body);
  res.json(await inTenant(req, (q) => parents.unlink(q, id, student_id, { actor: req.actor })));
}));
r.post("/:id/reset-password", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => parents.resetPassword(q, id)));
}));
r.post("/:id/:action(disable|enable)", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => parents.setStatus(q, id, req.params.action === "disable" ? "disabled" : "active")));
}));

export default r;
