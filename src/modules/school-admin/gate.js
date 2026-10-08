// البوابة الذكية — جهة الإدارة: البوابات، أجهزة الحراس (رابط ← موافقة)، بطاقات الحضور،
// متابعة اليوم، «لم يسجل حضور» والاستثناءات واعتماد الغياب، والمسح المشبوه، وسجل التعديلات.
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, z, t } from "../../core/http/validate.js";
import { baseUrl } from "../../core/links.js";
import * as gate from "../shared/gate.service.js";
import { qrDataUrl } from "../shared/certificates.service.js";
import { getFeatureSettings, updateFeatureSettings } from "../shared/feature-settings.service.js";

const r = Router();
const dateQ = z.object({ date: t.date });
const idP = z.object({ id: t.id });
const reasonBody = z.object({ reason: t.optText(200) });
const pairLink = (req, d) => `${baseUrl(req)}/${req.tenantId}/gate#p=${d.public_id}.${d.code}`;
const device = (req) => String(req.get("user-agent") || "").slice(0, 120);

/* ---------- الإعدادات ---------- */
r.get("/settings", handle(async (req, res) => res.json(await inTenant(req, async (q) => (await getFeatureSettings(q)).gate))));
r.put("/settings", handle(async (req, res) => res.json(await inTenant(req, async (q) => {
  // عناوين الشبكة: كل عنوان أو نطاق يجب أن يكون صالحًا
  if (typeof req.body?.allowed_networks === "string") gate.networkList(req.body.allowed_networks);
  return updateFeatureSettings(q, "gate", req.body || {});
}))));

/* ---------- اليوم ---------- */
r.get("/summary", handle(async (req, res) => {
  const { date } = parse(dateQ, req.query);
  res.json(await inTenant(req, (q) => gate.daySummary(q, date)));
}));
r.get("/feed", handle(async (req, res) => {
  const b = parse(gate.feedQuery, req.query);
  res.json(await inTenant(req, (q) => gate.feed(q, b)));
}));
r.get("/unrecorded", handle(async (req, res) => {
  const { date } = parse(dateQ, req.query);
  res.json(await inTenant(req, (q) => gate.unrecorded(q, date)));
}));
r.post("/exceptions", handle(async (req, res) => {
  const b = parse(gate.exceptionsBody, req.body);
  res.json(await inTenant(req, (q) => gate.setExceptions(q, b, { actor: req.actor, ip: req.ip, device: device(req) })));
}));
r.post("/finalize", handle(async (req, res) => {
  const { date } = parse(gate.finalizeBody, req.body);
  res.json(await inTenant(req, (q) => gate.finalizeDay(q, date, { actor: req.actor })));
}));
r.put("/day-mode", handle(async (req, res) => {
  const b = parse(gate.dayModeBody, req.body);
  res.json(await inTenant(req, (q) => gate.setDayMode(q, b)));
}));

// قوائم التصفية: المراحل والصفوف والشعب والبوابات
r.get("/filters", handle(async (req, res) => res.json(await inTenant(req, async (q) => ({
  stages: await q("SELECT id, name FROM stages ORDER BY sort_order, id"),
  grades: await q("SELECT id, stage_id, name FROM grades ORDER BY sort_order, id"),
  classes: await q("SELECT id, grade_id, name FROM classes ORDER BY sort_order, id"),
  gates: await q("SELECT id, name FROM gates ORDER BY id"),
})))));
r.get("/records", handle(async (req, res) => {
  const b = parse(gate.recordsQuery, req.query);
  res.json(await inTenant(req, (q) => gate.records(q, b)));
}));
// أوقات خاصة لكل مرحلة
r.get("/stage-hours", handle(async (req, res) => res.json(await inTenant(req, gate.listStageHours))));
r.put("/stage-hours", handle(async (req, res) => {
  const b = parse(gate.stageHoursBody, req.body);
  res.json(await inTenant(req, (q) => gate.setStageHours(q, b)));
}));
r.delete("/stage-hours/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => gate.clearStageHours(q, id)));
}));

/* ---------- المسح المشبوه وسجل التعديلات ---------- */
r.get("/suspicious", handle(async (req, res) => {
  const { date } = parse(dateQ, req.query);
  res.json(await inTenant(req, (q) => gate.suspiciousList(q, date)));
}));
r.post("/suspicious/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { state } = parse(z.object({ state: z.enum(["dismissed", "confirmed"]) }), req.body);
  res.json(await inTenant(req, (q) => gate.reviewSuspicious(q, id, state, { actor: req.actor })));
}));
r.get("/audit", handle(async (req, res) => {
  const b = parse(z.object({ student_id: t.id.optional(), date: t.date.optional() }), req.query);
  res.json(await inTenant(req, (q) => q(
    `SELECT a.id, a.day, a.actor, a.old_status, a.new_status, a.old_source, a.new_source, a.reason, a.device, host(a.ip) AS ip, a.at,
            s.full_name AS name, c.name AS class_name
       FROM attendance_audit a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
      WHERE ($1::bigint IS NULL OR a.student_id = $1) AND ($2::date IS NULL OR a.day = $2)
      ORDER BY a.id DESC LIMIT 300`, [b.student_id ?? null, b.date ?? null])));
}));

/* ---------- البوابات ---------- */
r.get("/gates", handle(async (req, res) => res.json(await inTenant(req, gate.listGates))));
r.post("/gates", handle(async (req, res) => {
  const b = parse(gate.gateBody, req.body);
  res.json(await inTenant(req, (q) => gate.saveGate(q, null, b)));
}));
r.patch("/gates/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(gate.gateBody, req.body);
  res.json(await inTenant(req, (q) => gate.saveGate(q, id, b)));
}));
r.delete("/gates/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => gate.deleteGate(q, id)));
}));

/* ---------- أجهزة الحراس ---------- */
r.get("/devices", handle(async (req, res) => res.json(await inTenant(req, gate.listDevices))));
// جهاز جديد ← رابط لمرة واحدة يُرسل للحارس (واتساب أو QR)، صالح 24 ساعة، ثم تُطلب الموافقة
r.post("/devices", handle(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60), gate_id: t.id.optional() }), req.body);
  res.json(await inTenant(req, async (q) => {
    const gateId = b.gate_id ?? await gate.defaultGate(q);
    const d = await gate.createDevice(q, { name: b.name, gate_id: gateId }, { actor: req.actor });
    const link = pairLink(req, d);
    return { id: d.id, link, qr: qrDataUrl(link), hours: gate.PAIR_HOURS };
  }));
}));
// رمز ربط: يُظهره المدير، وأي جوال يكتبه في صفحة البوابة يصير جهاز بوابة
const joinLink = (req, code) => `${baseUrl(req)}/${req.tenantId}/gate#j=${code}`;
const withJoinLink = (req, c) => ({ ...c, link: c.code ? joinLink(req, c.code) : null, qr: c.code ? qrDataUrl(joinLink(req, c.code)) : null,
  page: `${baseUrl(req)}/${req.tenantId}/gate` });
r.get("/join-codes", handle(async (req, res) => {
  res.json((await inTenant(req, gate.listJoinCodes)).map((c) => withJoinLink(req, c)));
}));
r.post("/join-codes", handle(async (req, res) => {
  const b = parse(gate.joinCodeBody, req.body);
  res.json(await inTenant(req, async (q) => {
    const c = await gate.createJoinCode(q, { ...b, gate_id: b.gate_id ?? await gate.defaultGate(q) }, { actor: req.actor });
    return withJoinLink(req, { ...c, used_count: 0, devices: [] });
  }));
}));
r.post("/join-codes/:id/revoke", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => gate.revokeJoinCode(q, id)));
}));
r.patch("/devices/:id", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const b = parse(gate.deviceBody, req.body);
  res.json(await inTenant(req, (q) => gate.updateDevice(q, id, b)));
}));
r.post("/devices/:id/link", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, async (q) => {
    const link = pairLink(req, await gate.rePair(q, id));
    return { link, qr: qrDataUrl(link), hours: gate.PAIR_HOURS };
  }));
}));
r.post("/devices/:id/:action(approve|disable|enable|revoke)", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  res.json(await inTenant(req, (q) => gate.setDeviceState(q, id, req.params.action, { actor: req.actor })));
}));

/* ---------- بطاقات الحضور ---------- */
r.get("/cards", handle(async (req, res) => {
  const b = parse(z.object({ class_id: t.id.optional(), student_id: t.id.optional() }), req.query);
  if (!b.class_id && !b.student_id) throw badRequest("اختر الشعبة أو الطالب");
  res.json(await inTenant(req, async (q) => {
    const students = await q(
      `SELECT s.id, s.full_name AS name, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.status = 'active' AND s.archived_at IS NULL AND ($1::bigint IS NULL OR s.class_id = $1) AND ($2::bigint IS NULL OR s.id = $2)
        ORDER BY s.full_name`, [b.class_id ?? null, b.student_id ?? null]);
    const tokens = await gate.cardTokens(q, students.map((s) => s.id), { actor: req.actor });
    const [school] = await q("SELECT name FROM tenants WHERE id = app_tenant()");
    return { school: school?.name || "", cards: students.map((s) => {
      const tk = tokens.get(Number(s.id));
      const qr = gate.cardUrl(baseUrl(req), req.tenantId, tk.token);
      return { ...s, version: tk.version, qr, qr_img: qrDataUrl(qr) };
    }) };
  }));
}));
r.post("/students/:id/token/reissue", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { reason } = parse(reasonBody, req.body);
  res.json(await inTenant(req, async (q) => {
    const { version } = await gate.issueToken(q, id, { actor: req.actor, reason: reason || "إعادة إصدار من الإدارة" });
    return { ok: true, version };
  }));
}));
r.post("/students/:id/token/disable", handle(async (req, res) => {
  const { id } = parse(idP, req.params);
  const { reason } = parse(reasonBody, req.body);
  res.json(await inTenant(req, (q) => gate.disableToken(q, id, { actor: req.actor, reason: reason || "بطاقة مفقودة" })));
}));

export default r;
