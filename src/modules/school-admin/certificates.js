/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { env } from "../../config/env.js";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { logEvent } from "../../core/audit.js";
import * as certs from "../shared/certificates.service.js";
import * as results from "../shared/results.service.js";

const r = Router();
export const originOf = (req) => env.PUBLIC_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;

// Any administrator prepares results and sends them for review; approving them, and issuing, revoking or
// replacing certificates, belongs to the school's management (full scope).
const approver = (req) => (req.user.admin_scope || "full") === "full";
const requireApprover = (req, res, next) => (approver(req) ? next()
  : next(forbidden("اعتماد النتائج وإصدار الشهادات وإلغاؤها لإدارة المدرسة العامة فقط.")));
const audit = (q, req, action) => logEvent(q, { tenantId: req.tenantId, actor: req.actor, action });

// ---------- Results approval ----------
const keyOf = (req, src) => parse(results.classKeySchema, src);
r.get("/results", handle(async (req, res) => {
  const k = keyOf(req, req.query);
  res.json(await inTenant(req, async (q) => ({ ...(await results.overview(q, await results.classScope(q, k))), can_approve: approver(req) })));
}));
r.post("/results/submit", handle(async (req, res) => {
  const k = keyOf(req, req.body);
  res.json(await inTenant(req, async (q) => {
    const sc = await results.classScope(q, k);
    const out = await results.submit(q, sc, req.actor);
    await audit(q, req, `إرسال نتائج ${sc.cls.name} (${sc.label}) للمراجعة`);
    return out;
  }));
}));
r.post("/results/return", handle(async (req, res) => {
  const k = keyOf(req, req.body);
  const { reason } = parse(results.reasonSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const sc = await results.classScope(q, k);
    const out = await results.sendBack(q, sc, req.actor, reason);
    await audit(q, req, `إعادة نتائج ${sc.cls.name} (${sc.label}) للتعديل: ${reason}`);
    return out;
  }));
}));
r.post("/results/approve", requireApprover, handle(async (req, res) => {
  const k = keyOf(req, req.body);
  const b = parse(results.approveSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const sc = await results.classScope(q, k);
    const out = await results.approve(q, sc, req.actor, b);
    await audit(q, req, `اعتماد نتائج ${sc.cls.name} (${sc.label}) داخليًا${b.allow_incomplete ? " باستثناء" : ""}`);
    return out;
  }));
}));
r.post("/results/reopen", requireApprover, handle(async (req, res) => {
  const k = keyOf(req, req.body);
  const { reason } = parse(results.reasonSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const sc = await results.classScope(q, k);
    const out = await results.reopen(q, sc, req.actor, reason);
    await audit(q, req, `إعادة فتح نتائج ${sc.cls.name} (${sc.label}): ${reason}`);
    return out;
  }));
}));

// ---------- Certificates ----------
r.get("/", handle(async (req, res) => {
  const f = parse(z.object({ class_id: t.optId, student_id: t.optId }), req.query);
  res.json(await inTenant(req, (q) => certs.list(q, f)));
}));
r.post("/issue", handle(async (req, res, next) => {
  const b = parse(certs.issueSchema, req.body);
  if (!b.dry_run && !approver(req)) return next(forbidden("إصدار الشهادات لإدارة المدرسة العامة فقط."));
  const out = await inTenant(req, async (q) => {
    const o = await certs.issue(q, b, req.actor);
    if (o.issued) await audit(q, req, `إصدار ${o.issued} شهادة من النتائج المعتمدة`);
    return o;
  });
  if (out.stale) throw conflict(results.STALE);
  res.status(b.dry_run ? 200 : 201).json(out);
}));
r.post("/custom", requireApprover, handle(async (req, res) => {
  const b = parse(certs.customSchema, req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    const c = await certs.issueCustom(q, b, req.actor);
    await audit(q, req, `إصدار شهادة مخصصة رقم ${c.serial}`);
    return c;
  }));
}));
r.post("/print", handle(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(t.id).min(1).max(500) }), req.body);
  res.json(await inTenant(req, (q) => certs.forPrint(q, ids, originOf(req), { actor: req.actor })));
}));
r.get("/:id/history", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => q("SELECT action, actor, reason, created_at FROM certificate_events WHERE certificate_id = $1 ORDER BY id", [id])));
}));
r.post("/:id/revoke", requireApprover, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { reason } = parse(z.object({ reason: t.shortText("سبب الإلغاء", 200) }), req.body);
  await inTenant(req, async (q) => {
    const c = await certs.revoke(q, id, reason, req.actor);
    await audit(q, req, `إلغاء الشهادة ${c.serial}: ${reason}`);
  });
  res.json({ ok: true });
}));
r.post("/:id/replace", requireApprover, handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(certs.replaceSchema, req.body);
  const out = await inTenant(req, async (q) => {
    const o = await certs.replace(q, id, b, req.actor);
    if (o.issued) await audit(q, req, `استبدال الشهادة ${id}: ${b.reason}`);
    return o;
  });
  if (out.stale) throw conflict(results.STALE);
  res.status(201).json(out);
}));
export default r;
