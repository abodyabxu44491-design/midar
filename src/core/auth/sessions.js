/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { env } from "../../config/env.js";
import { transaction } from "../db/pool.js";
import { newToken, sha256 } from "./codes.js";

const prefix = () => (env.COOKIE_SECURE ? "__Secure-" : "");

const REMEMBER_DAYS = 30;
const REMEMBER_HOURS = REMEMBER_DAYS * 24;
const REMEMBER_IDLE_MIN = REMEMBER_DAYS * 24 * 60;

export const SESSION = {
  owner:      { cookie: "midar_o", path: "/api/owner",      idleMin: 30,  maxHours: 8 },
  admin:      { cookie: "midar_a", path: "/api/admin",      idleMin: 120, maxHours: 12 },
  teacher:    { cookie: "midar_t", path: "/api/teacher",    idleMin: 180, maxHours: 12 },
  accountant: { cookie: "midar_f", path: "/api/accountant", idleMin: 120, maxHours: 12 },
  parent:     { cookie: "midar_p", path: "/api/public",     idleMin: 30 * 24 * 60, maxHours: 30 * 24 },
};

const SINGLE = "__session";
const TAG = { owner: "o", admin: "a", teacher: "t", accountant: "f", parent: "p" };
const single = () => env.SESSION_COOKIE_MODE === "single";

function readSingle(req) {
  const out = {};
  for (const part of String(req.cookies?.[SINGLE] || "").split("|")) {
    const [tag, token] = part.split(".");
    if (tag && token) out[tag] = token;
  }
  return out;
}
function writeSingle(req, res, values, maxAgeMs = 12 * 3600_000) {
  const value = Object.entries(values).filter(([, v]) => v).map(([k, v]) => `${k}.${v}`).join("|");
  const opts = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "strict", path: "/" };
  if (value) res.cookie(SINGLE, value, { ...opts, maxAge: maxAgeMs });
  else res.clearCookie(SINGLE, opts);
  req.cookies[SINGLE] = value;
}
function tokenOf(req, kind) {
  return single() ? readSingle(req)[TAG[kind]] : req.cookies?.[prefix() + SESSION[kind].cookie];
}

export async function createSession(res, kind, { userId = null, parentId = null, tenantId = null, ip, userAgent, remember = false }, q) {
  const cfg = SESSION[kind];
  const token = newToken();
  const maxHours = remember ? REMEMBER_HOURS : cfg.maxHours;
  const idleMinutes = remember ? REMEMBER_IDLE_MIN : null;
  await q(
    `INSERT INTO sessions (token_hash, kind, user_id, tenant_id, ip, user_agent, expires_at, idle_minutes, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7), $8, $9)`,
    [sha256(token), kind, userId, tenantId, ip || null, String(userAgent || "").slice(0, 200), maxHours, idleMinutes, parentId],
  );
  if (single()) {
    const req = res.req;
    writeSingle(req, res, { ...readSingle(req), [TAG[kind]]: token }, maxHours * 3600_000);
  } else {
    res.cookie(prefix() + cfg.cookie, token, {
      httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "strict", path: cfg.path,
      ...(remember || kind === "owner" ? { maxAge: maxHours * 3600_000 } : {}),
    });
  }
}

export function currentSessionHash(req, kind) {
  const token = tokenOf(req, kind);
  return token && token.length <= 100 ? sha256(token) : null;
}

export async function readSession(req, kind) {
  const cfg = SESSION[kind];
  const token = tokenOf(req, kind);
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  return transaction({ sessionHash: hash }, (q) => sessionRow(q, hash, kind));
}

export async function sessionRow(q, hash, kind) {
  const [s] = await q(
    `WITH s AS (
       SELECT user_id, parent_id, tenant_id, last_seen_at FROM sessions
        WHERE token_hash = $1 AND kind = $2 AND expires_at > now()
          AND last_seen_at > now() - make_interval(mins => COALESCE(idle_minutes, $3))
     ), touch AS (
       UPDATE sessions SET last_seen_at = now(),
              -- «ابقني مسجلًا»: الجلسة تمتد مع الاستخدام، ولا تنتهي إلا بتسجيل الخروج أو 30 يومًا بلا استخدام
              expires_at = CASE WHEN idle_minutes IS NOT NULL THEN GREATEST(expires_at, now() + make_interval(mins => idle_minutes)) ELSE expires_at END
        WHERE token_hash = $1 AND EXISTS (SELECT 1 FROM s) AND last_seen_at < now() - interval '60 seconds'
     )
     SELECT user_id, parent_id, tenant_id FROM s`,
    [hash, kind, SESSION[kind].idleMin]);
  return s || null;
}
export const sessionHashOf = (req, kind) => {
  const token = tokenOf(req, kind);
  return token && token.length <= 100 ? sha256(token) : null;
};

export async function destroySession(req, res, kind) {
  const cfg = SESSION[kind];
  const token = tokenOf(req, kind);
  if (token) {
    const hash = sha256(token);
    await transaction({ sessionHash: hash }, (q) => q("DELETE FROM sessions WHERE token_hash = $1", [hash]));
  }
  if (single()) writeSingle(req, res, { ...readSingle(req), [TAG[kind]]: null });
  else res.clearCookie(prefix() + cfg.cookie, { path: cfg.path, secure: env.COOKIE_SECURE, httpOnly: true, sameSite: "strict" });
}

export async function purgeExpiredSessions() {
  await transaction({ platform: true, actor: "النظام" }, async (q) => {
    await q("DELETE FROM sync_changes WHERE changed_at < now() - interval '30 days'");
    await q("DELETE FROM sync_operations WHERE status IN ('applied', 'rejected', 'resolved') AND received_at < now() - interval '90 days'");
    await q(`DELETE FROM sessions WHERE expires_at < now()
               OR last_seen_at < now() - make_interval(mins => COALESCE(idle_minutes, 24 * 60))`);
    await q("DELETE FROM security_events WHERE created_at < now() - interval '90 days'");
    await q("DELETE FROM rate_limits WHERE reset_at < now()");
  });
}

export async function runMaintenance() {
  await purgeExpiredSessions();
  const suspended = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT * FROM suspend_expired_tenants()"));
  if (suspended.length) console.log("[صيانة] أُوقفت مدارس منتهية الاشتراك:", suspended.map((t) => t.tenant_id).join(", "));
  return suspended;
}
