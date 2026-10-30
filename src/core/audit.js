/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
export async function logEvent(q, { tenantId = null, actor, action }) {
  await q(
    "INSERT INTO audit_log (tenant_id, actor, action, ip) VALUES ($1, $2, $3, NULLIF(current_setting('app.ip', true), '')::inet)",
    [tenantId, actor, action],
  );
}

export async function securityEvent(q, { kind, subject = null, tenantId = null, ip = null }) {
  await q("INSERT INTO security_events (kind, subject, tenant_id, ip) VALUES ($1, $2, $3, $4)", [kind, subject, tenantId, ip || null]);
}

export async function recentFailures(q, kind, subject, minutes) {
  const [r] = await q(
    "SELECT count(*)::int AS n FROM security_events WHERE kind = $1 AND subject = $2 AND created_at > now() - make_interval(mins => $3)",
    [kind, subject, minutes],
  );
  return r.n;
}

export async function clearLoginFailures(q, tenantId, username) {
  await q("DELETE FROM security_events WHERE kind = 'staff_login_failed' AND starts_with(subject, $1)", [`${tenantId}:${username}:`]);
  await q("DELETE FROM security_events WHERE kind = 'staff_login_failed_all' AND subject = $1", [`${tenantId}:${username}`]);
}

// Raises a security alert for the platform owner. Works inside any transaction (a school's included): the database
// function stores it without giving the caller read access, and folds a repeat of the same alert within 10 minutes.
export async function raiseAlert(q, { kind, severity = "medium", title, detail = null, tenantId = null }) {
  await q("SELECT raise_security_alert($1, $2, $3, $4, $5)", [kind, severity, title, detail, tenantId]);
  // A high alert reaches the owner's phone right away (after this transaction commits).
  if (severity === "high") import("../modules/shared/alerts.service.js").then((m) => m.kickOwnerPush()).catch(() => {});
}
