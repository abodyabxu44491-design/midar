// مسارات المزامنة: المعلم (لقطة، تغييرات، إرسال عمليات، تعارضاته) — الإدارة (كل التعارضات، الأجهزة، المؤشرات)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import * as sync from "./sync.service.js";

const opId = z.string().uuid("هوية غير صحيحة");

export function teacherSyncRouter() {
  const r = Router();
  const who = (req) => ({ teacherId: req.user.teacher_id, user: req.user, userId: req.user.id, actor: req.actor, req });
  r.get("/bootstrap", handle(async (req, res) => res.json(await inTenant(req, (q) => sync.bootstrap(q, req.user.teacher_id)))));
  r.get("/changes", handle(async (req, res) => {
    const f = parse(sync.changesQuery, req.query);
    res.json(await inTenant(req, (q) => sync.changes(q, req.user.teacher_id, f)));
  }));
  r.post("/push", handle(async (req, res) => {
    const b = parse(sync.pushSchema, req.body);
    res.json(await inTenant(req, (q) => sync.push(q, who(req), b)));
  }));
  r.get("/conflicts", handle(async (req, res) => res.json(await inTenant(req, (q) => sync.listConflicts(q, req.user.id)))));
  r.post("/conflicts/:id/resolve", handle(async (req, res) => {
    const b = parse(sync.resolveSchema, req.body);
    res.json(await inTenant(req, (q) => sync.resolve(q, parse(opId, req.params.id), b.choice, { ...who(req), admin: false })));
  }));
  return r;
}

export function adminSyncRouter() {
  const r = Router();
  r.get("/conflicts", handle(async (req, res) => res.json(await inTenant(req, (q) => sync.listConflicts(q)))));
  r.post("/conflicts/:id/resolve", handle(async (req, res) => {
    const b = parse(sync.resolveSchema, req.body);
    res.json(await inTenant(req, (q) => sync.resolve(q, parse(opId, req.params.id), b.choice, { actor: req.actor, userId: req.user.id, admin: true })));
  }));
  r.get("/devices", handle(async (req, res) => res.json(await inTenant(req, sync.listDevices))));
  r.post("/devices/:id/revoke", handle(async (req, res) => {
    await inTenant(req, (q) => sync.revokeDevice(q, parse(opId, req.params.id), req.actor));
    res.json({ ok: true });
  }));
  r.get("/stats", handle(async (req, res) => res.json(await inTenant(req, sync.stats))));
  return r;
}
