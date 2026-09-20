// تسجيل الأحداث التي لا تمر عبر تعديل جدول (دخول، خروج، محاولات فاشلة)
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

// فك قفل الدخول لحساب (عند إعادة تعيين كلمة المرور): يمسح عدّادات المحاولات الخاطئة لكل العناوين
export async function clearLoginFailures(q, tenantId, username) {
  await q("DELETE FROM security_events WHERE kind = 'staff_login_failed' AND starts_with(subject, $1)", [`${tenantId}:${username}:`]);
  await q("DELETE FROM security_events WHERE kind = 'staff_login_failed_all' AND subject = $1", [`${tenantId}:${username}`]);
}
