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
import { sendPush, vapidKeys } from "./notify.service.js";

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

// Phone notifications to the owner's devices: each new high-severity security alert and each new request (trial,
// subscription, contact), once. Runs every minute; a device that the push service reports as gone is removed.
const KIND = { trial: "طلب تجربة جديد", subscription: "طلب اشتراك جديد", contact: "رسالة تواصل جديدة", renewal: "طلب تجديد جديد", upgrade: "طلب ترقية باقة", feature: "طلب إضافة ميزة" };
export async function dispatchOwnerPush() {
  if (!vapidKeys()) return 0;
  const { subs, items } = await transaction({ platform: true, actor: "النظام" }, async (q) => {
    const subs = await q("SELECT id, endpoint, p256dh, auth FROM owner_push_subscriptions WHERE failures < 5");
    const [cur] = await q("SELECT last_alert_id, last_lead_id FROM owner_push_cursor WHERE id = 1 FOR UPDATE SKIP LOCKED");
    if (!cur) return { subs: [], items: [] };
    const alerts = await q(
      `SELECT id, title, detail FROM security_alerts WHERE id > $1 AND severity = 'high' ORDER BY id LIMIT 10`, [cur.last_alert_id]);
    const leads = await q(`SELECT id, kind, school_name FROM leads WHERE id > $1 ORDER BY id LIMIT 10`, [cur.last_lead_id]);
    const [{ a, l }] = await q("SELECT COALESCE((SELECT max(id) FROM security_alerts), 0) AS a, COALESCE((SELECT max(id) FROM leads), 0) AS l");
    await q("UPDATE owner_push_cursor SET last_alert_id = $1, last_lead_id = $2 WHERE id = 1", [a, l]);
    const base = env.OWNER_PATH;
    return { subs, items: [
      ...alerts.map((x) => ({ title: `تنبيه أمني: ${x.title}`, body: x.detail || "", url: `${base}/#/security`, tag: `alert-${x.id}`, priority: 1 })),
      ...leads.map((x) => ({ title: KIND[x.kind] || "طلب جديد", body: x.school_name || "", url: `${base}/#/requests`, tag: `lead-${x.id}`, priority: 2 })),
    ] };
  });
  return deliverOwner(subs, items);
}

async function deliverOwner(subs, items) {
  if (!subs.length || !items.length) return 0;
  let sent = 0;
  const gone = [], failed = [];
  for (const sub of subs) {
    for (const item of items) {
      try { await sendPush(sub, item); sent++; } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { gone.push(sub.id); break; }
        failed.push(sub.id);
        console.error("[إشعار المالك]", e.statusCode || "", e.message);
      }
    }
  }
  await transaction({ platform: true, actor: "النظام" }, async (q) => {
    if (gone.length) await q("DELETE FROM owner_push_subscriptions WHERE id = ANY($1::bigint[])", [gone]);
    if (failed.length) await q("UPDATE owner_push_subscriptions SET failures = failures + 1 WHERE id = ANY($1::bigint[])", [[...new Set(failed)]]);
    await q("UPDATE owner_push_subscriptions SET last_sent_at = now(), failures = 0 WHERE NOT (id = ANY($1::bigint[]))", [[...gone, ...failed]]);
  });
  return sent;
}

// Right after a request or an alert is saved: send at once instead of waiting for the minute timer (on a host that
// sleeps when idle, the request that wakes it is the moment to send). Several triggers close together send once.
let kick = null;
export function kickOwnerPush() {
  if (kick) return;
  kick = setTimeout(() => { kick = null; dispatchOwnerPush().catch((e) => console.error("[إشعار المالك]", e.message)); }, 1500);
  kick.unref?.();
}

// «Send a test»: one notification to every owner device now; returns how many devices got it.
export async function testOwnerPush() {
  if (!vapidKeys()) return { devices: 0, sent: 0 };
  const subs = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT id, endpoint, p256dh, auth FROM owner_push_subscriptions"));
  const sent = await deliverOwner(subs, [{ title: "إشعار تجريبي من مدار", body: "الإشعارات تعمل على هذا الجهاز.", url: `${env.OWNER_PATH}/#/security`, tag: "owner-test", priority: 1 }]);
  return { devices: subs.length, sent };
}

// A one-off notification to the owner's devices for things that are not leads or alerts (a manager's password request).
export function pushOwner(item) {
  setTimeout(async () => {
    try {
      if (!vapidKeys()) return;
      const subs = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT id, endpoint, p256dh, auth FROM owner_push_subscriptions WHERE failures < 5"));
      await deliverOwner(subs, [{ priority: 2, ...item, url: item.url ? `${env.OWNER_PATH}/${item.url}` : `${env.OWNER_PATH}/` }]);
    } catch (e) { console.error("[إشعار المالك]", e.message); }
  }, 500).unref?.();
}
