/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Background work on Workers. On Node it runs on timers in src/server.js; Workers have no long-lived process, so one
// Cron Trigger fires every five minutes (wrangler.jsonc) and this decides what is due.
//
// Same policy as src/core/activity.js: every background job wakes the database, so while nobody uses the platform
// everything runs together once every two hours and the database can sleep in between. "In use" is read from KV,
// where requests record their time at most once every five minutes per instance (recordActivity below).
export const ACTIVE_WITHIN_MS = 15 * 60_000;
const ACTIVITY_KEY = "last-activity";
const RECORD_EVERY_MS = 5 * 60_000;

// Pure: which jobs are due at `when`, given the last recorded activity. Tested in tests/workers-schedule.test.js.
export function dueJobs(when, lastActivity) {
  const d = new Date(when);
  const minute = d.getUTCMinutes(), hour = d.getUTCHours();
  const topOfHour = minute < 5;                       // the tick that falls in the first five minutes of the hour
  const active = lastActivity != null && when - lastActivity < ACTIVE_WITHIN_MS;
  if (!active) {
    // Idle: one shared window every two hours for everything.
    return topOfHour && hour % 2 === 0 ? ["deliveries", "ownerPush", "gate", "alertEmails", "maintenance", "reminders", "dbUsage"] : [];
  }
  const jobs = ["deliveries", "ownerPush", "gate", "alertEmails"];
  if (topOfHour) jobs.push("maintenance", "reminders");
  if (topOfHour && hour % 3 === 0) jobs.push("dbUsage");
  return jobs;
}

export async function runScheduled(when, env) {
  const raw = await env.STATE?.get(ACTIVITY_KEY).catch(() => null);
  // Test runs only (NODE_ENV=test): SCHEDULE_FORCE_ALL=1 runs every job on any tick, since the local runtime cannot set
  // the tick time. Ignored in production.
  const forced = env.NODE_ENV === "test" && env.SCHEDULE_FORCE_ALL === "1";
  const due = forced ? dueJobs(Date.UTC(2026, 0, 1, 0, 0), null) : dueJobs(when, raw ? Number(raw) : null);
  if (!due.length) return { due };
  // Loaded only when something is due, so an idle tick does not even load the database modules.
  const [{ processDeliveries }, alerts, { runGateTick }, { runMaintenance }, { runReminders }, { checkDbUsage }] = await Promise.all([
    import("../src/modules/shared/notify.service.js"), import("../src/modules/shared/alerts.service.js"),
    import("../src/modules/shared/gate.service.js"), import("../src/core/auth/sessions.js"),
    import("../src/modules/shared/reminders.service.js"), import("../src/modules/shared/db-usage.service.js")]);
  const jobs = {
    deliveries: processDeliveries, ownerPush: alerts.dispatchOwnerPush, gate: runGateTick, alertEmails: alerts.dispatchAlertEmails,
    maintenance: runMaintenance, reminders: runReminders, dbUsage: checkDbUsage,
  };
  const results = {};
  for (const name of due) {
    const t = Date.now();
    try { await jobs[name](); results[name] = { ok: true, ms: Date.now() - t }; }
    catch (e) { results[name] = { ok: false, ms: Date.now() - t, error: String(e?.message || e).slice(0, 200) }; console.error(`[مهمة مجدولة ${name}]`, e?.message || e); }
  }
  console.log(JSON.stringify({ scheduled: new Date(when).toISOString(), results }));
  return { due, results };
}

// Called on every request (through src/core/activity.js); writes to KV at most once per five minutes per instance.
let lastRecorded = 0;
export function recordActivity(env, waitUntil) {
  const now = Date.now();
  if (!env.STATE || now - lastRecorded < RECORD_EVERY_MS) return;
  lastRecorded = now;
  waitUntil(env.STATE.put(ACTIVITY_KEY, String(now)).catch(() => { lastRecorded = 0; }));
}
