// التواصل: قواعد الإشعارات، والرسائل النصية (الرصيد والسجل والإرسال اليدوي)، وإعدادات الأقسام الجديدة
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { EVENTS, getRules, updateRules, rulesSchema, smsBalance, smsSegments, sendManualSms, pushPublicKey, notify, loadGateway } from "../shared/notify.service.js";
import { getFeatureSettings, updateFeatureSettings, SECTIONS } from "../shared/feature-settings.service.js";

const r = Router();

/* ---------- قواعد الإشعارات ---------- */
r.get("/notify", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    events: Object.entries(EVENTS).map(([key, e]) => ({ key, name: e.name, audience: e.audience })),
    rules: await getRules(q),
    push_ready: Boolean(pushPublicKey()),
    sms_ready: Boolean(await loadGateway()),
    modules: { notifications: Boolean(req.modules?.notifications), sms: Boolean(req.modules?.sms) },
    devices: (await q(`SELECT count(*) FILTER (WHERE student_id IS NOT NULL)::int AS parents,
                              count(*) FILTER (WHERE user_id IS NOT NULL)::int AS staff FROM push_subscriptions`))[0],
  })));
}));
r.put("/notify", handle(async (req, res) => {
  const b = parse(rulesSchema, req.body);
  res.json(await inTenant(req, (q) => updateRules(q, b)));
}));
// إشعار تجريبي لأجهزة المدير نفسه
r.post("/notify/test", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => notify(q, { event: "leave", users: [req.user.id], title: "إشعار تجريبي من مدار", body: "وصلك هذا الإشعار، فالإشعارات تعمل على هذا الجهاز." })));
}));

/* ---------- الرسائل النصية ---------- */
r.get("/sms", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    enabled: Boolean(req.modules?.sms),
    ready: Boolean(await loadGateway()),
    balance: await smsBalance(q),
    messages: await q(`SELECT m.id, m.to_phone, m.body, m.kind, m.segments, m.status, m.error, m.created_by, m.created_at, s.full_name AS student
                         FROM sms_messages m LEFT JOIN students s ON s.id = m.student_id ORDER BY m.id DESC LIMIT 200`),
    ledger: await q("SELECT delta, reason, created_by, created_at FROM sms_ledger WHERE tenant_id = app_tenant() AND message_id IS NULL ORDER BY id DESC LIMIT 50"),
  })));
}));

const sendSchema = z.object({
  target: z.enum(["all", "grade", "class", "students"]),
  grade_id: t.optId, class_id: t.optId,
  student_ids: z.array(t.id).max(2000).optional(),
  message: z.string().trim().min(2, "اكتب نص الرسالة").max(600),
  dry_run: z.boolean().default(false),
});
r.post("/sms/send", handle(async (req, res) => {
  if (!req.modules?.sms) throw badRequest("قسم الرسائل النصية موقوف");
  const b = parse(sendSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    const rows = await q(
      `SELECT s.id FROM students s LEFT JOIN classes c ON c.id = s.class_id
        WHERE s.archived_at IS NULL AND s.guardian_phone IS NOT NULL
          AND ($1 = 'all' OR ($1 = 'grade' AND c.grade_id = $2) OR ($1 = 'class' AND s.class_id = $3) OR ($1 = 'students' AND s.id = ANY($4)))`,
      [b.target, b.grade_id ?? null, b.class_id ?? null, b.student_ids?.length ? b.student_ids : [0]]);
    const phones = (await q("SELECT count(DISTINCT guardian_phone)::int AS n FROM students WHERE id = ANY($1)", [rows.map((x) => x.id)]))[0].n;
    const segments = smsSegments(b.message);
    const balance = await smsBalance(q);
    const cost = phones * segments;
    if (b.dry_run) return { recipients: phones, segments, cost, balance };
    if (!phones) throw badRequest("لا يوجد أولياء أمور بأرقام في هذا الاختيار");
    if (cost > balance) throw badRequest(`الرصيد لا يكفي: تحتاج ${cost} رسالة والرصيد ${balance}`);
    if (!(await loadGateway())) throw badRequest("مزوّد الرسائل غير مهيأ بعد. تواصل مع إدارة المنصة.");
    const sent = await sendManualSms(q, rows.map((x) => x.id), b.message);
    return { queued: sent, segments, cost: sent * segments };
  }));
}));

/* ---------- إعدادات الأقسام الجديدة ---------- */
r.get("/features", handle(async (req, res) => res.json(await inTenant(req, getFeatureSettings))));
r.put("/features/:section", handle(async (req, res) => {
  const section = parse(z.enum(Object.keys(SECTIONS)), req.params.section);
  res.json(await inTenant(req, (q) => updateFeatureSettings(q, section, req.body || {})));
}));

export default r;
