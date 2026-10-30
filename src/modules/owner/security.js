/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's security page: the second factor's state, the owner's own sessions and devices (with "end every
// other session"), and the security alerts raised across the platform.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle, unauthorized } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { sessionHashOf } from "../../core/auth/sessions.js";
import { logEvent } from "../../core/audit.js";
import { env } from "../../config/env.js";
import { ownerMfa } from "./auth.js";
import { checkOwnerFactor, newRecoveryCodes, recoveryLeft } from "../../core/auth/owner-mfa.js";
import { pushPublicKey } from "../shared/notify.service.js";
import { keySource, effectiveKey } from "../../core/auth/secret-box.js";
import { testOwnerPush } from "../shared/alerts.service.js";
import { dbUsage } from "../shared/db-usage.service.js";
import { subscriptionSchema } from "../shared/notifications.routes.js";

const r = Router();
const platform = (req) => ({ actor: req.actor, ip: req.ip, platform: true });

r.get("/", handle(async (req, res) => {
  const current = sessionHashOf(req, "owner");
  const out = await transaction(platform(req), async (q) => {
    const mfa = await ownerMfa(q);
    const sessions = await q(
      `SELECT token_hash = $1 AS current, host(ip) AS ip, user_agent, created_at, last_seen_at, expires_at
         FROM sessions WHERE kind = 'owner' AND expires_at > now() ORDER BY last_seen_at DESC`, [current]);
    const devices = await q("SELECT label, ip, first_seen_at, last_seen_at FROM owner_devices ORDER BY last_seen_at DESC LIMIT 20");
    const alerts = await q(
      `SELECT a.id, a.created_at, a.severity, a.kind, a.title, a.detail, a.tenant_id, t.name AS school, a.seen_at
         FROM security_alerts a LEFT JOIN tenants t ON t.id = a.tenant_id ORDER BY a.id DESC LIMIT 200`);
    const [{ unseen }] = await q("SELECT count(*)::int AS unseen FROM security_alerts WHERE seen_at IS NULL AND severity <> 'info'");
    const [{ n: pushDevices }] = await q("SELECT count(*)::int AS n FROM owner_push_subscriptions");
    return { mfa: mfa ? { source: mfa.source, enrolled_at: mfa.enrolled_at || null } : null, recovery_left: await recoveryLeft(q), sessions, devices, alerts, unseen,
      push: { key: pushPublicKey(), devices: pushDevices } };
  });
  res.json({ ...out, ip_allowlist: env.ownerIps.length > 0, alert_email: Boolean(env.OWNER_ALERT_EMAIL),
    key_source: keySource(), vapid_pinned: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY), db_usage: await dbUsage() });
}));

r.get("/badge", handle(async (req, res) => {
  const [b] = await transaction(platform(req), (q) => q(
    `SELECT count(*)::int AS unseen, max(id) FILTER (WHERE severity = 'high') AS latest_high
       FROM security_alerts WHERE seen_at IS NULL AND severity <> 'info'`));
  res.json(b);
}));

r.post("/alerts/seen", handle(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).max(500).optional() }), req.body);
  const n = await transaction(platform(req), async (q) => (ids?.length
    ? await q("UPDATE security_alerts SET seen_at = now() WHERE seen_at IS NULL AND id = ANY($1::bigint[]) RETURNING 1", [ids])
    : await q("UPDATE security_alerts SET seen_at = now() WHERE seen_at IS NULL RETURNING 1")).length);
  res.json({ seen: n });
}));

// A new set of backup codes; confirmed with the current code from the app (or an unused backup code).
r.post("/recovery-codes", handle(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().max(20) }), req.body);
  const codes = await transaction(platform(req), async (q) => {
    if (!(await checkOwnerFactor(q, await ownerMfa(q), code, req.ip))) throw unauthorized("الرمز غير صحيح. اكتب الرقم الظاهر الآن في تطبيق المصادقة.");
    await logEvent(q, { actor: req.actor, action: "إنشاء رموز احتياطية جديدة للوحة المالك" });
    return newRecoveryCodes(q);
  });
  res.json({ recovery_codes: codes });
}));

// The encryption key in effect, shown once to the owner (with the authenticator code) to pin it as CREDENTIAL_KEY.
// Pinning the same value changes nothing for users: push keys and saved credentials stay valid.
r.post("/credential-key", handle(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().max(20) }), req.body);
  const key = await transaction(platform(req), async (q) => {
    if (!(await checkOwnerFactor(q, await ownerMfa(q), code, req.ip))) throw unauthorized("الرمز غير صحيح. اكتب الرقم الظاهر الآن في تطبيق المصادقة.");
    await logEvent(q, { actor: req.actor, action: "عرض مفتاح التشفير لتثبيته في إعدادات الخادم" });
    return effectiveKey();
  });
  res.json({ source: keySource(), key });
}));

// Phone notifications on this device for the owner (security alerts and new requests).
r.get("/push", handle(async (req, res) => res.json({ key: pushPublicKey() })));
r.post("/push", handle(async (req, res) => {
  const sub = parse(subscriptionSchema, req.body);
  await transaction(platform(req), (q) => q(
    `INSERT INTO owner_push_subscriptions (endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(req.get("user-agent") || "").slice(0, 300) || null]));
  res.json({ ok: true });
}));
r.post("/db-usage", handle(async (req, res) => res.json(await dbUsage({ fresh: true }))));
r.post("/push/test", handle(async (req, res) => res.json(await testOwnerPush())));
r.post("/push/remove", handle(async (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
  await transaction(platform(req), (q) => q("DELETE FROM owner_push_subscriptions WHERE endpoint = $1", [endpoint]));
  res.json({ ok: true });
}));

// Ends every owner session except this one (a lost phone, a shared computer, a suspicion).
r.post("/sessions/end-others", handle(async (req, res) => {
  const current = sessionHashOf(req, "owner");
  const ended = await transaction(platform(req), async (q) => {
    const rows = await q("DELETE FROM sessions WHERE kind = 'owner' AND token_hash <> $1 RETURNING 1", [current]);
    await logEvent(q, { actor: req.actor, action: `إنهاء جلسات المالك الأخرى (${rows.length})` });
    return rows.length;
  });
  res.json({ ended });
}));

export default r;
