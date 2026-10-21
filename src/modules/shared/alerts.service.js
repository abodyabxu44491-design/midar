/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Emails new high-severity security alerts to OWNER_ALERT_EMAIL (when set and the mail gateway is ready), so the
// owner learns of a new-device sign-in, a burst of failed sign-ins or a large deletion without opening the panel.
import { transaction } from "../../core/db/pool.js";
import { env } from "../../config/env.js";
import { sendMail, noticeMail, mailReady } from "./mail.service.js";

export async function dispatchAlertEmails() {
  if (!env.OWNER_ALERT_EMAIL || !(await mailReady())) return 0;
  const rows = await transaction({ platform: true, actor: "النظام" }, (q) => q(
    `UPDATE security_alerts a SET emailed_at = now()
       FROM (SELECT id FROM security_alerts WHERE severity = 'high' AND emailed_at IS NULL
              AND created_at > now() - interval '1 day' ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED) x
      WHERE a.id = x.id
      RETURNING a.title, a.detail, a.tenant_id, a.created_at`));
  for (const a of rows) {
    await sendMail(noticeMail({ to: env.OWNER_ALERT_EMAIL, title: `تنبيه أمني: ${a.title}`,
      lines: [a.detail, a.tenant_id ? `المدرسة: ${a.tenant_id}` : null, `الوقت: ${new Date(a.created_at).toISOString()}`,
        "راجع «الأمان» في لوحة المالك."].filter(Boolean) })).catch((e) => console.error("[تنبيه أمني]", e.message));
  }
  return rows.length;
}
