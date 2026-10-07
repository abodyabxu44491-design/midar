// التواصل: قواعد الإشعارات، والرسائل النصية (بوابة المدرسة أو رصيد المنصة)، وقائمة واتساب المجانية، وإعدادات الأقسام الجديدة
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, badRequest, notFound } from "../../core/http/errors.js";
import { credentialsEnabled } from "../../core/auth/secret-box.js";
import { logEvent } from "../../core/audit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { EVENTS, CATEGORIES, getRules, updateRules, rulesSchema, getQuiet, setQuiet, quietSchema, deliveryStats, MAX_ATTEMPTS, smsBalance, smsSegments, sendManualSms, pushPublicKey, notify, loadGateway,
  loadSchoolGateway, sealSchoolHeaders, ANDROID_PRESET, sendRaw, queueWhatsApp } from "../shared/notify.service.js";
import { getFeatureSettings, updateFeatureSettings, SECTIONS } from "../shared/feature-settings.service.js";

const r = Router();

/* ---------- قواعد الإشعارات ---------- */
r.get("/notify", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    events: Object.entries(EVENTS).map(([key, e]) => ({ key, name: e.name, audience: e.audience, category: e.category,
      category_name: CATEGORIES[e.category], priority: e.priority, opt_in: Boolean(e.optIn) })),
    rules: await getRules(q),
    quiet: await getQuiet(q),
    push_ready: Boolean(pushPublicKey()),
    sms_ready: Boolean(await loadSchoolGateway(q)) || Boolean(await loadGateway()),
    modules: { notifications: Boolean(req.modules?.notifications), sms: Boolean(req.modules?.sms), whatsapp: Boolean(req.modules?.messaging) },
    devices: (await q(`SELECT count(*) FILTER (WHERE student_id IS NOT NULL)::int AS parents,
                              count(*) FILTER (WHERE user_id IS NOT NULL)::int AS staff FROM push_subscriptions`))[0],
  })));
}));
r.put("/notify", handle(async (req, res) => {
  const b = parse(rulesSchema, req.body);
  res.json(await inTenant(req, (q) => updateRules(q, b)));
}));
// ساعات الهدوء: الإشعارات غير العاجلة خلالها تُؤجَّل لنهايتها، والعاجلة (كالغياب) تصل فورًا
r.put("/notify/quiet", handle(async (req, res) => {
  const b = parse(quietSchema, req.body);
  res.json(await inTenant(req, (q) => setQuiet(q, b)));
}));

// سجل الإشعارات للتشخيص: ماذا أُرسل، ولمن، وهل وصل لمزوّد الإشعارات، وسبب الفشل
r.get("/notify/log", handle(async (req, res) => {
  const kind = req.query.kind && EVENTS[req.query.kind] ? req.query.kind : null;
  const status = ["sent", "failed", "pending", "retrying", "skipped", "none"].includes(req.query.status) ? req.query.status : null;
  res.json(await inTenant(req, async (q) => ({
    stats: (await q(
      `SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status IN ('pending', 'processing', 'retrying'))::int AS waiting,
              count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              round(avg(EXTRACT(epoch FROM sent_at - created_at)) FILTER (WHERE status = 'sent'))::int AS avg_seconds
         FROM notification_deliveries WHERE tenant_id = app_tenant() AND created_at > now() - interval '24 hours'`))[0],
    totals: (await q(`SELECT count(*)::int AS notifications, count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read
                        FROM notifications WHERE created_at > now() - interval '24 hours'`))[0],
    worker: { ...deliveryStats, max_attempts: MAX_ATTEMPTS },
    items: await q(
      `SELECT n.id, n.kind, n.category, n.priority, n.title, n.body, n.created_at, n.updated_at, n.read_at, n.repeats, n.created_by,
              COALESCE(s.full_name, u.full_name) AS recipient, CASE WHEN n.student_id IS NOT NULL THEN 'parent' ELSE 'staff' END AS audience,
              COALESCE(json_agg(json_build_object('device', d.device, 'status', d.status, 'attempts', d.attempts, 'error', d.error,
                'sent_at', d.sent_at, 'next_attempt_at', d.next_attempt_at, 'provider_status', d.provider_status) ORDER BY d.id)
                FILTER (WHERE d.id IS NOT NULL), '[]') AS deliveries
         FROM notifications n
         LEFT JOIN students s ON s.id = n.student_id LEFT JOIN users u ON u.id = n.user_id
         LEFT JOIN notification_deliveries d ON d.notification_id = n.id
        WHERE ($1::text IS NULL OR n.kind = $1)
        GROUP BY n.id, s.full_name, u.full_name
       HAVING $2::text IS NULL OR ($2 = 'none' AND count(d.id) = 0) OR bool_or(d.status = $2) OR ($2 = 'pending' AND bool_or(d.status = 'processing'))
        ORDER BY n.id DESC LIMIT 150`, [kind, status]),
  })));
}));

// إشعار تجريبي لأجهزة المدير نفسه
r.post("/notify/test", handle(async (req, res) => {
  res.json(await inTenant(req, (q) => notify(q, { event: "system", users: [req.user.id], dedupKey: `test-${Date.now()}`, title: "إشعار تجريبي من مدار", body: "وصلك هذا الإشعار، فالإشعارات تعمل على هذا الجهاز." })));
}));

/* ---------- الرسائل النصية ---------- */
r.get("/sms", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => ({
    enabled: Boolean(req.modules?.sms),
    own: Boolean(await loadSchoolGateway(q)),
    ready: Boolean(await loadSchoolGateway(q)) || Boolean(await loadGateway()),
    balance: await smsBalance(q),
    messages: await q(`SELECT m.id, m.to_phone, m.body, m.kind, m.segments, m.status, m.error, m.created_by, m.created_at, m.via, s.full_name AS student
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
    const own = Boolean(await loadSchoolGateway(q));
    const balance = await smsBalance(q);
    const cost = own ? 0 : phones * segments;
    if (b.dry_run) return { recipients: phones, segments, cost, balance, own };
    if (!phones) throw badRequest("لا يوجد أولياء أمور بأرقام في هذا الاختيار");
    if (!own && cost > balance) throw badRequest(`الرصيد لا يكفي: تحتاج ${cost} رسالة والرصيد ${balance}`);
    if (!own && !(await loadGateway())) throw badRequest("لا توجد بوابة رسائل. اربط جوال المدرسة من «بوابة المدرسة» لترسل مجانًا من شريحتها.");
    const sent = await sendManualSms(q, rows.map((x) => x.id), b.message);
    return { queued: sent, segments, cost: own ? 0 : sent * segments, own };
  }));
}));


/* ---------- بوابة المدرسة الخاصة: جوال أندرويد بشريحة المدرسة (أو أي مزوّد للمدرسة) ---------- */
const smsOn = (req) => { if (!req.modules?.sms) throw badRequest("قسم الرسائل النصية موقوف"); };
r.get("/sms/gateway", handle(async (req, res) => {
  smsOn(req);
  const [g] = await inTenant(req, (q) => q(`SELECT enabled, preset, url, method, content_type, body_template, sender, success_match,
                                                    headers_sealed IS NOT NULL AS has_auth, updated_at FROM school_sms_gateway WHERE tenant_id = app_tenant()`));
  res.json({ gateway: g || { enabled: false, preset: "android", has_auth: false }, android: ANDROID_PRESET, can_store: credentialsEnabled() });
}));
const gwSchema = z.object({
  enabled: z.boolean(),
  preset: z.enum(["android", "custom"]),
  // android: اسم المستخدم وكلمة المرور من التطبيق
  username: z.string().trim().max(120).optional(), password: z.string().max(200).optional(),
  // custom
  url: z.string().trim().max(500).refine((v) => v === "" || /^https:\/\//.test(v), "رابط البوابة يجب أن يبدأ بـ https://").optional(),
  method: z.enum(["GET", "POST"]).optional(), content_type: z.enum(["json", "form"]).optional(),
  body_template: z.string().max(2000).optional(), sender: z.string().trim().max(20).optional(), success_match: z.string().max(100).optional(),
  headers: z.string().max(3000).optional(),   // custom: ترويسات JSON (فارغ = إبقاء الحالية، "-" = حذفها)
});
r.put("/sms/gateway", handle(async (req, res) => {
  smsOn(req);
  const b = parse(gwSchema, req.body);
  let sealed;
  if (b.preset === "android" && (b.username || b.password)) {
    if (!b.username || !b.password) throw badRequest("أدخل اسم المستخدم وكلمة المرور كما تظهر في تطبيق البوابة");
    sealed = { Authorization: `Basic ${Buffer.from(`${b.username}:${b.password}`).toString("base64")}` };
  } else if (b.preset === "custom" && b.headers === "-") sealed = null;
  else if (b.preset === "custom" && b.headers?.trim()) {
    try { sealed = JSON.parse(b.headers); } catch { throw badRequest("الترويسات يجب أن تكون JSON صحيحًا"); }
    if (!sealed || typeof sealed !== "object" || Array.isArray(sealed) || !Object.values(sealed).every((v) => typeof v === "string")) throw badRequest("الترويسات: أسماء وقيم نصية فقط");
  }
  if (sealed && !credentialsEnabled()) throw badRequest("لا يمكن حفظ بيانات الدخول: مفتاح التشفير غير مضبوط على الخادم");
  const cfg = b.preset === "android" ? { ...ANDROID_PRESET, sender: "" }
    : { url: b.url ?? "", method: b.method ?? "POST", content_type: b.content_type ?? "json", body_template: b.body_template ?? "", sender: b.sender ?? "", success_match: b.success_match ?? "" };
  res.json(await inTenant(req, async (q) => {
    const [cur] = await q("SELECT headers_sealed FROM school_sms_gateway WHERE tenant_id = app_tenant()");
    const headers = sealed === undefined ? cur?.headers_sealed ?? null : sealed === null ? null : sealSchoolHeaders(req.tenant.id, sealed);
    if (b.enabled && !cfg.url) throw badRequest("أدخل رابط البوابة قبل التفعيل");
    if (b.enabled && b.preset === "android" && !headers) throw badRequest("أدخل اسم المستخدم وكلمة المرور من تطبيق البوابة");
    await q(`INSERT INTO school_sms_gateway (tenant_id, enabled, preset, url, method, content_type, body_template, sender, success_match, headers_sealed)
             VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (tenant_id) DO UPDATE SET enabled = $1, preset = $2, url = $3, method = $4, content_type = $5, body_template = $6,
               sender = $7, success_match = $8, headers_sealed = $9, updated_at = now()`,
      [b.enabled, b.preset, cfg.url, cfg.method, cfg.content_type, cfg.body_template, cfg.sender, cfg.success_match, headers]);
    await logEvent(q, { tenantId: req.tenant.id, actor: req.actor, action: `${b.enabled ? "تفعيل" : "حفظ"} بوابة الرسائل الخاصة بالمدرسة (${b.preset === "android" ? "جوال أندرويد" : "مزوّد مخصص"})` });
    return { ok: true };
  }));
}));
r.post("/sms/gateway/test", handle(async (req, res) => {
  smsOn(req);
  const b = parse(z.object({ to: z.string().regex(/^[0-9]{8,15}$/, "الرقم دوليًا بلا + (مثل 967771234567)"), message: z.string().trim().min(2).max(300) }), req.body);
  const g = await inTenant(req, loadSchoolGateway);
  if (!g) throw badRequest("فعّل بوابة المدرسة واحفظها أولًا");
  try { await sendRaw(g, { to: b.to, message: b.message }); } catch (e) { throw badRequest(`فشل الإرسال: ${e.message}`); }
  res.json({ ok: true, segments: smsSegments(b.message) });
}));

/* ---------- قائمة واتساب: رسائل جاهزة تُرسل من جوال الإداري واحدة تلو الأخرى (مجانًا) ---------- */
const waOn = (req) => { if (!req.modules?.messaging) throw badRequest("قسم رسائل واتساب موقوف"); };
r.get("/wa", handle(async (req, res) => {
  waOn(req);
  res.json(await inTenant(req, async (q) => ({
    pending: await q(`SELECT w.id, w.phone, w.body, w.kind, w.created_at, s.full_name AS student, c.name AS class_name
                        FROM wa_outbox w LEFT JOIN students s ON s.id = w.student_id LEFT JOIN classes c ON c.id = s.class_id
                       WHERE w.status = 'pending' ORDER BY w.id LIMIT 2000`),
    counts: (await q(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
                             count(*) FILTER (WHERE status = 'sent' AND done_at > now() - interval '7 days')::int AS sent_7d FROM wa_outbox`))[0],
  })));
}));
const composeSchema = z.object({
  target: z.enum(["all", "class", "students", "absent_today", "overdue"]),
  class_id: t.optId,
  student_ids: z.array(t.id).max(2000).optional(),
  message: z.string().trim().min(2, "اكتب نص الرسالة").max(1200),
});
r.post("/wa/compose", handle(async (req, res) => {
  waOn(req);
  const b = parse(composeSchema, req.body);
  if (b.target === "class" && !b.class_id) throw badRequest("اختر الشعبة");
  res.json(await inTenant(req, async (q) => {
    const rows = await q(
      `SELECT s.id FROM students s
        WHERE s.archived_at IS NULL AND s.guardian_phone IS NOT NULL
          AND ($1 = 'all' OR ($1 = 'class' AND s.class_id = $2) OR ($1 = 'students' AND s.id = ANY($3))
               OR ($1 = 'absent_today' AND EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.day = CURRENT_DATE AND a.status = 'absent'))
               OR ($1 = 'overdue' AND EXISTS (SELECT 1 FROM invoices i WHERE i.student_id = s.id AND i.status = 'open' AND i.due_date < CURRENT_DATE
                                                 AND i.amount > invoice_net_paid(i.id))))`,
      [b.target, b.class_id ?? null, b.student_ids?.length ? b.student_ids : [0]]);
    if (!rows.length) throw badRequest("لا يوجد أولياء أمور بأرقام في هذا الاختيار");
    const ids = rows.map((x) => x.id);
    const owed = new Map((await q(`SELECT student_id, SUM(amount - invoice_net_paid(id)) AS rem FROM invoices WHERE status = 'open' AND student_id = ANY($1) GROUP BY student_id`, [ids]))
      .map((x) => [Number(x.student_id), Math.max(0, Number(x.rem))]));
    const [{ currency }] = await q("SELECT currency FROM tenants WHERE id = app_tenant()");
    const fill = (s) => b.message.replace(/\{(الطالب|الفصل|المبلغ|التاريخ)\}/g, (_, k) => ({
      "الطالب": s.full_name, "الفصل": s.class_name || "", "التاريخ": new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Aden" }),
      "المبلغ": `${(owed.get(Number(s.id)) || 0).toLocaleString("en-US")} ${currency || ""}`.trim() }[k]));
    const added = await queueWhatsApp(q, ids, b.message, "manual", { perStudent: fill });
    return { added };
  }));
}));
r.post("/wa/:id/done", handle(async (req, res) => {
  waOn(req);
  const id = parse(t.id, req.params.id);
  const { status } = parse(z.object({ status: z.enum(["sent", "skipped", "pending"]) }), req.body);
  const [row] = await inTenant(req, (q) => q(`UPDATE wa_outbox SET status = $2, done_by = CASE WHEN $2 = 'pending' THEN NULL ELSE $3 END,
                                                     done_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END WHERE id = $1 RETURNING id`, [id, status, req.actor]));
  if (!row) throw notFound("الرسالة غير موجودة");
  res.json({ ok: true });
}));
r.post("/wa/clear", handle(async (req, res) => {
  waOn(req);
  const { scope } = parse(z.object({ scope: z.enum(["pending", "done"]) }), req.body);
  const rows = await inTenant(req, (q) => q(scope === "pending" ? "DELETE FROM wa_outbox WHERE status = 'pending' RETURNING id" : "DELETE FROM wa_outbox WHERE status <> 'pending' RETURNING id"));
  res.json({ removed: rows.length });
}));

/* ---------- إعدادات الأقسام الجديدة ---------- */
r.get("/features", handle(async (req, res) => res.json(await inTenant(req, getFeatureSettings))));
r.put("/features/:section", handle(async (req, res) => {
  const section = parse(z.enum(Object.keys(SECTIONS)), req.params.section);
  res.json(await inTenant(req, (q) => updateFeatureSettings(q, section, req.body || {})));
}));

export default r;
