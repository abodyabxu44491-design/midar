/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, notFound } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { baseUrl } from "../../core/links.js";
import { logEvent } from "../../core/audit.js";
import * as sf from "../shared/school-files.service.js";
import { uniqueSchoolCode } from "../shared/school-files.service.js";

const r = Router();
const platform = (req, fn) => transaction({ actor: req.actor, ip: req.ip, platform: true }, fn);
const code = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "رمز المدرسة غير صحيح");
// Sending channels the platform can really deliver through. Nothing is reported as sent unless it was.
const CAPABILITIES = { email: false, whatsapp_api: false };

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["active", "suspended", "archived"]).optional().or(z.literal("")),
  stage: z.enum(sf.STAGES.map(([k]) => k)).optional().or(z.literal("")),
  delivery: z.enum(["sent", "failed", "pending", "none"]).optional().or(z.literal("")),
  sort: z.enum(["newest", "oldest", "updated"]).prefault("newest"),
  org_type: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional().or(z.literal("")),
});

r.get("/", handle(async (req, res) => {
  const f = parse(listQuery, req.query);
  res.json(await platform(req, async (q) => ({ items: await sf.list(q, f), counts: await sf.counts(q), stages: sf.STAGES, capabilities: CAPABILITIES })));
}));

r.get("/suggest-code", handle(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().max(150) }), req.query);
  res.json({ code: await platform(req, (q) => uniqueSchoolCode(q, name)) });
}));

r.get("/export.csv", handle(async (req, res) => {
  const f = parse(listQuery.extend({ ids: z.string().max(20000).optional() }), req.query);
  const wanted = f.ids ? new Set(f.ids.split(",").filter(Boolean)) : null;
  const rows = (await platform(req, (q) => sf.list(q, f))).filter((x) => !wanted || wanted.has(x.id));
  const stage = Object.fromEntries(sf.STAGES);
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["رمز المدرسة", "اسم المدرسة", "نوع المؤسسة", "المسؤول", "الجوال", "البريد", "تاريخ التسجيل", "المرحلة", "حالة الحساب", "تسليم البيانات", "الباقة", "آخر تحديث"]]
    .concat(rows.map((x) => [x.id, x.name, x.org_type_name, x.contact_name, x.phone, x.email, x.created_at?.toISOString?.().slice(0, 10) ?? x.created_at,
      stage[x.stage], x.status === "active" ? "فعال" : x.status === "suspended" ? "موقوف" : "مؤرشف", sf.DELIVERY[x.delivery] || "لم يُرسل",
      x.plan_name, x.updated_at?.toISOString?.().slice(0, 10) ?? x.updated_at]));
  await platform(req, (q) => logEvent(q, { actor: req.actor, action: `تصدير بيانات ${rows.length} مدرسة` }));
  res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", "attachment; filename=\"midar-schools.csv\"")
    .send(`﻿${lines.map((l) => l.map(cell).join(",")).join("\r\n")}`);
}));

r.get("/:id", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  res.json({ ...(await platform(req, (q) => sf.getFile(q, id, baseUrl(req)))), channels: sf.CHANNELS, delivery_labels: sf.DELIVERY,
    fields: sf.PROFILE_FIELDS, capabilities: CAPABILITIES });
}));

r.patch("/:id", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const b = parse(sf.profileSchema, req.body);
  res.json(await platform(req, (q) => sf.updateProfile(q, id, b, req.actor)));
}));

r.post("/:id/notes", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const b = parse(z.object({ body: t.shortText("الملاحظة", 2000) }), req.body);
  await platform(req, async (q) => {
    const [x] = await q("SELECT 1 FROM tenants WHERE id = $1", [id]);
    if (!x) throw notFound("المدرسة غير موجودة");
    await sf.addEvent(q, id, { kind: "note", body: b.body }, req.actor);
  });
  res.status(201).json({ ok: true });
}));

r.post("/:id/link", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const out = await platform(req, async (q) => {
    const link = await sf.issueLink(q, id, req.actor, baseUrl(req));
    await logEvent(q, { actor: req.actor, action: `إصدار رابط تفعيل لمدير المدرسة ${id}` });
    return link;
  });
  res.json(out);
}));

r.post("/:id/link/revoke", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  res.json(await platform(req, (q) => sf.revokeLinks(q, id, req.actor)));
}));

r.post("/:id/deliveries", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const b = parse(z.object({ channel: z.enum(Object.keys(sf.CHANNELS)), recipient: t.optText(160), note: t.optText(300) }), req.body);
  if (b.channel === "email" && !CAPABILITIES.email) {
    const out = await platform(req, (q) => sf.recordDelivery(q, id, { channel: "email", recipient: b.recipient, status: "failed",
      error: "خدمة البريد الإلكتروني غير مهيأة في المنصة" }, req.actor));
    return res.status(409).json({ error: "خدمة البريد الإلكتروني غير مهيأة بعد، فلم يُرسل شيء. استخدم النسخ أو واتساب أو ملف PDF.", event_id: out.id });
  }
  // Manual channels (copy, WhatsApp chat, PDF) wait for the owner's confirmation before counting as delivered.
  const out = await platform(req, (q) => sf.recordDelivery(q, id, { channel: b.channel, recipient: b.recipient, status: "pending", body: b.note }, req.actor));
  res.status(201).json({ event_id: out.id, status: "pending" });
}));

r.post("/:id/deliveries/:event", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const eventId = parse(t.id, req.params.event);
  const b = parse(z.object({ status: z.enum(["sent", "failed"]), error: t.optText(300) }), req.body);
  await platform(req, (q) => sf.setDelivery(q, id, eventId, b.status, b.status === "failed" ? b.error || "لم يصل للمدرسة" : null, req.actor));
  res.json({ ok: true });
}));

r.post("/:id/status", handle(async (req, res) => {
  const id = parse(code, req.params.id);
  const b = parse(z.object({ status: z.enum(["active", "suspended"]), reason: t.optText(300) }), req.body);
  await platform(req, (q) => sf.setStatus(q, id, b.status, b.reason, req.actor));
  res.json({ ok: true });
}));

export default r;
