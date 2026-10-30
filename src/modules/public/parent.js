/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { AppError, handle, unauthorized, forbidden, badRequest } from "../../core/http/errors.js";
import { parse, z, t } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { createSession, destroySession, readSession } from "../../core/auth/sessions.js";
import { inSchool } from "./context.js";
import * as parents from "../shared/parents.service.js";
import { activeModules } from "../shared/notify.service.js";
import { subscriptionSchema, savePush } from "../shared/notifications.routes.js";

const r = Router({ mergeParams: true });
const ACTOR = "ولي أمر";

const asParent = (fn) => handle(async (req, res) => {
  res.json(await inSchool(req, ACTOR, async (q, tenant) => {
    const p = await parents.sessionParent(req, q, tenant.id);
    if (!p) throw unauthorized("سجّل الدخول بحساب ولي الأمر");
    req.parent = p;
    return fn(q, p, tenant, req, res);
  }));
});

r.post("/parent/login", limits.parentLogin, handle(async (req, res) => {
  const b = parse(parents.loginSchema, req.body);
  const out = await inSchool(req, ACTOR, async (q, tenant) => {
    const o = await parents.login(q, b, { ip: req.ip });
    if (o.parent) await createSession(res, "parent", { parentId: o.parent.id, tenantId: tenant.id, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);
    return { ...o, tenant: tenant.id };
  });
  if (out.fail) {
    await transaction({ tenantId: out.tenant, actor: ACTOR, ip: req.ip }, (q) => parents.recordFailure(q, out, { ip: req.ip }));
    throw unauthorized(out.error);
  }
  if (out.error) throw new AppError(out.status || 401, out.error, "denied");
  res.json({ ok: true, must_change_password: out.parent.must_change_password });
}));

const signIn = (req, res, tenant, parentId, q) => createSession(res, "parent",
  { parentId, tenantId: tenant.id, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);

r.post("/parent/register", limits.parentLogin, handle(async (req, res) => {
  const b = parse(parents.registerSchema, req.body);
  const out = await inSchool(req, ACTOR, async (q, tenant) => {
    const o = await parents.register(q, b, { ip: req.ip });
    if (o.parent_id) await signIn(req, res, tenant, o.parent_id, q);
    return o;
  });
  if (out.error) throw new AppError(out.status || 400, out.error, out.exists ? "exists" : "denied", out.invalid ? { invalid: out.invalid } : undefined);
  res.json({ ok: true, linked: out.linked, requested: out.requested, already: out.already, siblings: out.siblings });
}));

r.post("/parent/activate", limits.parentLogin, handle(async (req, res) => {
  const b = parse(parents.activateSchema, req.body);
  const out = await inSchool(req, ACTOR, async (q, tenant) => {
    const o = await parents.activate(q, b, { ip: req.ip });
    if (o.parent_id) await createSession(res, "parent", { parentId: o.parent_id, tenantId: tenant.id, ip: req.ip, userAgent: req.get("user-agent"), remember: true }, q);
    return o;
  });
  if (out.error) throw new AppError(out.status || 400, out.error, "denied");
  res.json({ ok: true, siblings: out.siblings });
}));

r.post("/parent/logout", handle(async (req, res) => {
  // Signing out of this device also stops its notifications (the parent's other devices keep theirs).
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.slice(0, 1000) : null;
  if (endpoint) {
    const s = await readSession(req, "parent");
    if (s?.parent_id) await inSchool(req, ACTOR, (q) => q("DELETE FROM push_subscriptions WHERE parent_id = $1 AND endpoint = $2", [s.parent_id, endpoint]));
  }
  await destroySession(req, res, "parent");
  res.json({ ok: true });
}));

r.post("/parent/me", asParent((q, p) => parents.dashboard(q, p)));

r.post("/parent/password", asParent(async (q, p, tenant, req) => {
  const b = parse(parents.passwordSchema, req.body);
  return parents.changePassword(q, p, b);
}));

r.post("/parent/children/add", asParent(async (q, p, tenant, req) => {
  if (!Array.isArray(req.body?.keys)) return parents.addChildByKey(q, p, parse(parents.linkKeySchema, req.body));
  const o = await parents.addChildren(q, p, parse(parents.linkKeysSchema, req.body), { ip: req.ip });
  if (o.error) throw new AppError(o.status || 400, o.error, "denied", o.invalid ? { invalid: o.invalid } : undefined);
  return o;
}));
r.post("/parent/children/request", asParent(async (q, p, tenant, req) => {
  const b = parse(parents.requestSchema, req.body);
  return parents.requestChild(q, p, b);
}));

r.post("/parent/photo", asParent(async (q, p, tenant, req) => {
  const { student_id } = parse(z.object({ student_id: t.id }), req.body);
  const s = await parents.linkedStudent(q, p.id, student_id);
  return { photo: s.photo ? `data:${s.photo_type};base64,${Buffer.from(s.photo).toString("base64")}` : null };
}));

r.post("/parent/push", asParent(async (q, p, tenant, req) => {
  const sub = parse(subscriptionSchema, req.body.subscription);
  if (!(await activeModules(q)).notifications) throw badRequest("الإشعارات الفورية غير مفعّلة في هذه المدرسة");
  const kids = (await parents.children(q, p.id)).filter((k) => k.active);
  if (!kids.length) throw forbidden("لا يوجد أبناء مرتبطون بالحساب");
  for (const k of kids) {
    await savePush(q, { student_id: k.id }, sub);
    await q("UPDATE push_subscriptions SET parent_id = $1 WHERE student_id = $2 AND endpoint = $3", [p.id, k.id, sub.endpoint]);
  }
  return { ok: true, children: kids.length };
}));

export default r;
