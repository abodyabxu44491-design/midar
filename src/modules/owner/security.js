/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The owner's security page: the second factor's state, the owner's own sessions and devices (with "end every
// other session"), and the security alerts raised across the platform.
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { sessionHashOf } from "../../core/auth/sessions.js";
import { logEvent } from "../../core/audit.js";
import { env } from "../../config/env.js";
import { ownerMfa } from "./auth.js";

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
    return { mfa: mfa ? { source: mfa.source, enrolled_at: mfa.enrolled_at || null } : null, sessions, devices, alerts, unseen };
  });
  res.json({ ...out, ip_allowlist: env.ownerIps.length > 0, alert_email: Boolean(env.OWNER_ALERT_EMAIL) });
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
