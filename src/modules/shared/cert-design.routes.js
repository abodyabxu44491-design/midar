/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Certificate designs and their image library, for schools and institutes. Everyone with access to
// certificates can view designs; only management edits them (checked on every request).
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t } from "../../core/http/validate.js";
import { logEvent } from "../../core/audit.js";
import * as d from "./cert-design.service.js";
import { PRESETS, KINDS, FIELDS } from "../../../public/shared/js/cert-presets.js";

export function designRouter({ canEdit }) {
  const r = Router();
  const edit = (req, res, next) => (canEdit(req) ? next() : next(forbidden("تعديل تصاميم الشهادات للإدارة فقط.")));
  const id = (req) => parse(t.id, req.params.id);
  const audit = (q, req, action) => logEvent(q, { tenantId: req.tenantId, actor: req.actor, action });

  r.get("/", handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => ({
      templates: await d.list(q), can_edit: canEdit(req),
      presets: Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name, kinds: p.kinds })), kinds: KINDS, fields: FIELDS,
    })));
  }));
  r.get("/assets", handle(async (req, res) => res.json(await inTenant(req, (q) => d.assets(q)))));
  r.get("/assets/:id", handle(async (req, res) => {
    const img = await inTenant(req, (q) => d.readAsset(q, id(req)));
    res.set("Cache-Control", "private, max-age=31536000, immutable").type(img.mime).send(img.data);
  }));
  r.post("/assets", edit, handle(async (req, res) => {
    const b = parse(d.assetSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => { const a = await d.addAsset(q, b, req.actor); await audit(q, req, `رفع صورة لتصاميم الشهادات: ${a.name}`); return a; }));
  }));
  r.post("/assets/:id/hide", edit, handle(async (req, res) => {
    await inTenant(req, (q) => d.hideAsset(q, id(req)));
    res.json({ ok: true });
  }));
  r.get("/:id", handle(async (req, res) => res.json(await inTenant(req, (q) => d.get(q, id(req))))));
  r.post("/", edit, handle(async (req, res) => {
    const b = parse(d.createSchema, req.body);
    res.status(201).json(await inTenant(req, async (q) => { const x = await d.create(q, b, req.actor); await audit(q, req, `إنشاء تصميم شهادة «${x.name}»`); return x; }));
  }));
  r.put("/:id", edit, handle(async (req, res) => {
    const b = parse(d.templateSchema, req.body);
    res.json(await inTenant(req, async (q) => { const x = await d.update(q, id(req), b, req.actor); await audit(q, req, `تعديل تصميم الشهادة «${x.name}» (نسخة ${x.version})`); return x; }));
  }));
  r.post("/:id/default", edit, handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => { const x = await d.setDefault(q, id(req)); await audit(q, req, `اعتماد تصميم افتراضي لـ ${KINDS[x.kind]}`); return x; }));
  }));
  r.post("/:id/archive", edit, handle(async (req, res) => {
    res.json(await inTenant(req, async (q) => { const x = await d.archive(q, id(req)); await audit(q, req, `حذف تصميم شهادة ${id(req)}`); return x; }));
  }));
  return r;
}
