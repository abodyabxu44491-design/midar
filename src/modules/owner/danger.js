// منطقة الحذر في لوحة المالك: عمليات استثنائية على مدرسة، بمراحل وتحقق وتسجيل كامل.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import * as dz from "../shared/danger-zone.service.js";

const r = Router();
const code = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "رمز المدرسة غير صحيح");
const ctxOf = (req) => ({ scope: "owner", actor: "مالك المنصة", ip: req.ip, userId: null });
const idParam = (req) => parse(z.object({ id: t.id }), req.params).id;

r.get("/catalog", (req, res) => res.json(dz.catalog("owner")));

r.get("/schools", handle(async (req, res) => {
  res.json(await transaction({ platform: true }, (q) => q(
    `SELECT t.id, t.name, t.status, t.emergency_locked_at, u.students, u.teachers
       FROM tenants t JOIN platform_tenant_usage() u ON u.tenant_id = t.id ORDER BY t.name`)));
}));

r.get("/schools/:tenant", handle(async (req, res) => res.json(await dz.summary(parse(code, req.params.tenant)))));

r.post("/plan", handle(async (req, res) => {
  const { tenant, ...rest } = req.body || {};
  res.status(201).json(await dz.plan(ctxOf(req), parse(code, tenant), parse(dz.planSchema, rest)));
}));

const withTenant = (req) => parse(code, req.body?.tenant);
r.post("/:id/backup", handle(async (req, res) => {
  const { token } = parse(dz.stepSchema, req.body);
  res.json(await dz.stepBackup(ctxOf(req), withTenant(req), idParam(req), token));
}));
r.post("/:id/execute", handle(async (req, res) => {
  const b = parse(dz.executeSchema, req.body);
  res.json(await dz.execute(ctxOf(req), withTenant(req), idParam(req), b));
}));
r.post("/:id/cancel", handle(async (req, res) => {
  const { token } = parse(dz.stepSchema, req.body);
  res.json(await dz.cancel(ctxOf(req), withTenant(req), idParam(req), token));
}));

r.get("/history", handle(async (req, res) => {
  const tid = req.query.tenant ? parse(code, req.query.tenant) : null;
  res.json(await transaction({ platform: true }, (q) => dz.history(q, tid)));
}));
r.get("/backups", handle(async (req, res) => {
  const tid = req.query.tenant ? parse(code, req.query.tenant) : null;
  res.json(await transaction({ platform: true }, (q) => dz.listBackups(q, tid)));
}));
// تنزيل النسخة (للمالك فقط): ملف JSON مضغوط كما هو محفوظ، مع البصمة في الترويسة
r.get("/backups/:id/download", handle(async (req, res) => {
  const id = idParam(req);
  const b = await transaction({ platform: true, actor: "مالك المنصة", ip: req.ip }, async (q) => {
    const { row } = await dz.readBackup(q, id);
    await q("INSERT INTO audit_log (tenant_id, actor, action, ip) VALUES ($1, 'مالك المنصة', $2, NULLIF(current_setting('app.ip', true), '')::inet)",
      [row.tenant_id, `منطقة الحذر: تنزيل النسخة الاحتياطية #${row.id}`]);
    return row;
  });
  res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="midar-${b.tenant_id}-backup-${b.id}.json.gz"`,
    "X-Backup-SHA256": b.sha256, "Cache-Control": "no-store" }).send(b.data);
}));

export default r;
