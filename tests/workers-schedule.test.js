/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Background work on Workers (workers/schedule.js): the same policy as the Node timers — everything while the platform
// is in use, and one shared window every two hours while it is idle, so the database can sleep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueJobs } from "../workers/schedule.js";

const at = (iso) => Date.parse(iso);
const ALL = ["deliveries", "ownerPush", "gate", "alertEmails", "maintenance", "reminders", "dbUsage"];

test("أثناء الاستخدام: الإشعارات والبوابة والتنبيهات كل خمس دقائق", () => {
  const now = at("2026-11-05T08:25:00Z");
  assert.deepEqual(dueJobs(now, now - 60_000), ["deliveries", "ownerPush", "gate", "alertEmails"]);
});

test("أثناء الاستخدام: الصيانة والتذكيرات أول كل ساعة، والاستهلاك كل ثلاث ساعات", () => {
  const nine = at("2026-11-05T09:00:00Z"), ten = at("2026-11-05T10:00:00Z");
  assert.deepEqual(dueJobs(nine, nine - 1000), ALL);
  assert.ok(!dueJobs(ten, ten - 1000).includes("dbUsage"));
  assert.ok(dueJobs(ten, ten - 1000).includes("maintenance"));
});

test("بلا استخدام: لا شيء، إلا نافذة واحدة مشتركة كل ساعتين تشمل كل المهام", () => {
  const quiet = at("2026-11-05T01:35:00Z");
  assert.deepEqual(dueJobs(quiet, quiet - 3 * 60 * 60_000), []);
  assert.deepEqual(dueJobs(quiet, null), []);
  assert.deepEqual(dueJobs(at("2026-11-05T03:00:00Z"), null), []);
  assert.deepEqual(dueJobs(at("2026-11-05T02:00:00Z"), null), ALL);
  // At most 12 wakes of the database per idle day.
  let wakes = 0;
  for (let m = 0; m < 24 * 60; m += 5) if (dueJobs(at("2026-11-05T00:00:00Z") + m * 60_000, null).length) wakes++;
  assert.equal(wakes, 12);
});

test("آخر نشاط قبل 14 دقيقة يُعد استخدامًا، وقبل 16 لا", () => {
  const now = at("2026-11-05T08:25:00Z");
  assert.ok(dueJobs(now, now - 14 * 60_000).length > 0);
  assert.deepEqual(dueJobs(now, now - 16 * 60_000), []);
});
