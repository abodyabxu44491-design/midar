// منطقة الحذر لمدير المدرسة: جزء محدود من العمليات (الأمان، النسخ الاحتياطي، إعادة ضبط الإعدادات، حذف فئات آمنة)،
// لمن يملك صلاحية «منطقة الحذر» فقط، وبنفس المراحل والتحقق (كلمة مرور المدير) والتسجيل.
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as dz from "../shared/danger-zone.service.js";

const r = Router();
const allowed = async (req) => {
  const [u] = await inTenant(req, (q) => q("SELECT can_danger_zone FROM users WHERE id = $1 AND role = 'admin'", [req.user.id]));
  return Boolean(u?.can_danger_zone);
};
const guard = async (req) => { if (!(await allowed(req))) throw forbidden("ليست لديك صلاحية «منطقة الحذر». تواصل مع مالك المنصة."); };
const ctxOf = (req) => ({ scope: "admin", actor: `${req.user.full_name} (إدارة)`, ip: req.ip, userId: req.user.id });
const idParam = (req) => parse(z.object({ id: t.id }), req.params).id;

r.get("/catalog", handle(async (req, res) => res.json({ ...dz.catalog("admin"), allowed: await allowed(req),
  owner_only: Object.entries(dz.OPERATIONS).filter(([, o]) => !o.scopes.includes("admin")).map(([, o]) => o.label) })));

r.get("/summary", handle(async (req, res) => { await guard(req); res.json(await dz.summary(req.tenantId)); }));
r.post("/plan", handle(async (req, res) => {
  await guard(req);
  res.status(201).json(await dz.plan(ctxOf(req), req.tenantId, parse(dz.planSchema, req.body)));
}));
r.post("/:id/backup", handle(async (req, res) => {
  await guard(req);
  res.json(await dz.stepBackup(ctxOf(req), req.tenantId, idParam(req), parse(dz.stepSchema, req.body).token));
}));
r.post("/:id/execute", handle(async (req, res) => {
  await guard(req);
  res.json(await dz.execute(ctxOf(req), req.tenantId, idParam(req), parse(dz.executeSchema, req.body)));
}));
r.post("/:id/cancel", handle(async (req, res) => {
  await guard(req);
  res.json(await dz.cancel(ctxOf(req), req.tenantId, idParam(req), parse(dz.stepSchema, req.body).token));
}));
r.get("/history", handle(async (req, res) => { await guard(req); res.json(await inTenant(req, (q) => dz.history(q, req.tenantId))); }));

export default r;
