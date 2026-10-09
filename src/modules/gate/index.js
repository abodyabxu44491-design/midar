// واجهة أجهزة البوابة: /api/gate/<المدرسة>/...
// لا جلسة مستخدم: الجهاز يُعرَّف بمعرّفه وسره (من الترويسة)، والمدرسة من الرابط فقط، وكل شيء داخل عزل المدرسة (RLS).
//   POST /pair     فتح رابط الإدارة لأول مرة ← الجهاز بانتظار الموافقة ويأخذ سره
//   POST /join     ربط أي جوال برمز الربط (6 أرقام) الذي تُظهره الإدارة ← مفعّل فورًا أو بانتظار الموافقة
//   POST /status   نبض: الحالة، ووقت الخادم، ونافذة اليوم، والعداد
//   POST /scan     مسح بطاقة (مباشر)
//   POST /events   دفعة مسحات حُفظت على الجهاز أثناء انقطاع الاتصال
import { Router } from "express";
import { AppError, handle, forbidden } from "../../core/http/errors.js";
import { parse } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { inSchool } from "../public/context.js";
import * as gate from "../shared/gate.service.js";

const r = Router({ mergeParams: true });
const ACTOR = "جهاز البوابة";
const creds = (req) => [req.get("x-gate-device"), req.get("x-gate-secret")];
const recordedBy = (d) => `${d.gate_name} — ${d.name}`;

r.post("/:school/pair", limits.gatePair, handle(async (req, res) => {
  const b = parse(gate.pairBody, req.body);
  res.json(await inSchool(req, ACTOR, (q) => gate.pair(q, b, { ip: req.ip })));
}));

r.post("/:school/join", limits.gatePair, handle(async (req, res) => {
  const b = parse(gate.joinBody, req.body);
  const out = await inSchool(req, ACTOR, (q) => gate.joinWithCode(q, b, { ip: req.ip }));
  if (out.error) throw new AppError(out.status || 401, out.error, "denied");
  res.json(out);
}));

r.post("/:school/status", handle(async (req, res) => {
  const b = parse(gate.heartbeatBody, req.body || {});
  res.json(await inSchool(req, ACTOR, async (q) => gate.heartbeat(q, await gate.authDevice(q, ...creds(req)), b, { ip: req.ip })));
}));

r.post("/:school/scan", handle(async (req, res) => {
  const ev = parse(gate.scanBody, req.body);
  res.json(await inSchool(req, ACTOR, async (q, tenant) => {
    const d = await gate.authDevice(q, ...creds(req));
    if (d.status !== "active") throw forbidden(d.status === "pending" ? "الجهاز بانتظار موافقة الإدارة" : "الجهاز موقوف من الإدارة");
    return gate.processScan(q, d, ev, { school: tenant.id, actor: recordedBy(d), ip: req.ip });
  }));
}));

// قائمة الجهاز: بصمات الرموز والاسم والشعبة فقط (ليعرف الطالب ويقرر وهو بلا اتصال)
r.post("/:school/roster", handle(async (req, res) => {
  res.json(await inSchool(req, ACTOR, async (q) => {
    const d = await gate.authDevice(q, ...creds(req));
    if (d.status !== "active") throw forbidden("الجهاز غير مفعّل");
    return gate.roster(q);
  }));
}));

// كل حدث في معاملة مستقلة: فشل حدث لا يُسقط الدفعة، وهوية الحدث تمنع تكراره عند إعادة الإرسال
r.post("/:school/events", handle(async (req, res) => {
  const { events } = parse(gate.batchBody, req.body);
  const results = [];
  for (const ev of events) {
    try {
      results.push(await inSchool(req, ACTOR, async (q, tenant) => {
        const d = await gate.authDevice(q, ...creds(req));
        if (d.status !== "active") throw forbidden("الجهاز غير مفعّل");
        return gate.processScan(q, d, ev, { school: tenant.id, actor: recordedBy(d), ip: req.ip });
      }));
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
      results.push({ event_id: ev.event_id, error: e.message, retry: !e.status || e.status >= 500 });
    }
  }
  res.json({ results });
}));

export default r;
