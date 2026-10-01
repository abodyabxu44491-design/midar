// الرسائل النصية من لوحة المالك: ضبط المزوّد، ورصيد كل مدرسة، والسجل، ورسالة تجريبية
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, badRequest, notFound } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { sealSecret, credentialsEnabled } from "../../core/auth/secret-box.js";
import { loadGateway, smsSegments } from "../shared/notify.service.js";
import { sendRaw } from "../shared/notify.service.js";

const r = Router();
const platform = (req, fn) => transaction({ platform: true, actor: req.actor || "مالك المنصة", ip: req.ip }, fn);

r.get("/", handle(async (req, res) => {
  res.json(await platform(req, async (q) => {
    const [g] = await q("SELECT enabled, provider_name, url, method, content_type, body_template, sender, success_match, headers_sealed IS NOT NULL AS has_headers, updated_at FROM sms_gateway WHERE id = 1");
    return {
      gateway: g,
      can_store_secret: credentialsEnabled(),
      balances: await q(
        `SELECT t.id, t.name, COALESCE(sum(l.delta), 0)::int AS balance,
                (SELECT count(*) FROM sms_messages m WHERE m.tenant_id = t.id AND m.status = 'sent' AND m.created_at > now() - interval '30 days')::int AS sent_30d
           FROM tenants t LEFT JOIN sms_ledger l ON l.tenant_id = t.id
          WHERE t.status <> 'archived' GROUP BY t.id ORDER BY t.name`),
      recent: await q(
        `SELECT m.id, m.tenant_id, m.to_phone, m.kind, m.segments, m.status, m.error, m.created_at
           FROM sms_messages m ORDER BY m.id DESC LIMIT 100`),
    };
  }));
}));

const gatewaySchema = z.object({
  enabled: z.boolean(),
  provider_name: z.string().trim().max(60),
  url: z.string().trim().max(500).refine((v) => v === "" || /^https:\/\//.test(v), "رابط المزوّد يجب أن يبدأ بـ https://"),
  method: z.enum(["GET", "POST"]),
  content_type: z.enum(["json", "form"]),
  body_template: z.string().max(2000),
  sender: z.string().trim().max(20),
  success_match: z.string().max(100),
  // الترويسات (فيها المفتاح السري) ككائن JSON. فارغ = إبقاء الحالية، "-" = حذفها
  headers: z.string().max(3000).optional(),
}).partial();

r.put("/gateway", handle(async (req, res) => {
  const b = parse(gatewaySchema, req.body);
  let sealed;
  if (b.headers === "-") sealed = null;
  else if (b.headers && b.headers.trim()) {
    let obj;
    try { obj = JSON.parse(b.headers); } catch { throw badRequest("الترويسات يجب أن تكون JSON صحيحًا، مثل {\"Authorization\": \"Bearer ...\"}"); }
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Object.values(obj).every((v) => typeof v === "string")) throw badRequest("الترويسات: أسماء وقيم نصية فقط");
    if (!credentialsEnabled()) throw badRequest("لا يمكن حفظ المفتاح السري: مفتاح التشفير غير مضبوط على الخادم");
    sealed = sealSecret(JSON.stringify(obj), "sms-gateway");
  }
  const sets = [], vals = [];
  for (const k of ["enabled", "provider_name", "url", "method", "content_type", "body_template", "sender", "success_match"]) {
    if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${k} = $${vals.length}`); }
  }
  if (sealed !== undefined) { vals.push(sealed); sets.push(`headers_sealed = $${vals.length}`); }
  if (!sets.length) return res.json({ ok: true });
  await platform(req, async (q) => {
    const [cur] = await q("SELECT url FROM sms_gateway WHERE id = 1");
    if ((b.enabled ?? false) && !(b.url ?? cur.url)) throw badRequest("أدخل رابط المزوّد قبل التفعيل");
    await q(`UPDATE sms_gateway SET ${sets.join(", ")}, updated_at = now() WHERE id = 1`, vals);
  });
  res.json({ ok: true });
}));

r.post("/credits", handle(async (req, res) => {
  const b = parse(z.object({ tenant_id: z.string().max(30), delta: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, "أدخل عددًا"),
    reason: z.string().trim().min(2, "اكتب السبب").max(120) }), req.body);
  res.json(await platform(req, async (q) => {
    const [t] = await q("SELECT id FROM tenants WHERE id = $1", [b.tenant_id]);
    if (!t) throw notFound("المدرسة غير موجودة");
    await q("INSERT INTO sms_ledger (tenant_id, delta, reason, created_by) VALUES ($1, $2, $3, $4)", [b.tenant_id, b.delta, b.reason, req.actor || "مالك المنصة"]);
    const [{ n }] = await q("SELECT COALESCE(sum(delta), 0)::int AS n FROM sms_ledger WHERE tenant_id = $1", [b.tenant_id]);
    return { balance: n };
  }));
}));

r.post("/test", handle(async (req, res) => {
  const b = parse(z.object({ to: z.string().regex(/^[0-9]{8,15}$/, "الرقم دوليًا بلا + (مثل 967771234567)"), message: z.string().trim().min(2).max(300) }), req.body);
  const g = await loadGateway();
  if (!g) throw badRequest("فعّل المزوّد وأدخل رابطه أولًا");
  try {
    await sendRaw(g, { to: b.to, message: b.message });
    res.json({ ok: true, segments: smsSegments(b.message) });
  } catch (e) { throw badRequest(`فشل الإرسال: ${e.message}`); }
}));

export default r;
