/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { endPool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";
import { dbUsage, checkDbUsage, setUsageFetch, setUsageConfig, usageConfigured } from "../src/modules/shared/db-usage.service.js";

after(async () => { setUsageFetch(null); setUsageConfig(null); await endPool(); });

const DAY = 86400_000;
const project = (over = {}) => ({ project: {
  compute_time_seconds: 72 * 3600, synthetic_storage_size: 0.1 * 1024 ** 3, data_transfer_bytes: 1 * 1024 ** 3,
  consumption_period_start: new Date(Date.now() - 20 * DAY).toISOString(), consumption_period_end: new Date(Date.now() + 10 * DAY).toISOString(), ...over } });
const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

test("استهلاك قاعدة البيانات: الأرقام من Neon مقابل حدود الخطة، والوتيرة حتى آخر الشهر", async () => {
  setUsageConfig(null);
  assert.equal(usageConfigured(), false);
  assert.deepEqual(await dbUsage(), { configured: false });
  setUsageConfig({ key: "napi_test_key_1234567890", project: "proj-test", cuHours: 100, storageGb: 0.5, transferGb: 5 });
  let asked = null;
  setUsageFetch(async (url, opts) => { asked = { url, auth: opts.headers.Authorization }; return reply(200, project())(); });
  const u = await dbUsage();
  assert.equal(asked.url, "https://console.neon.tech/api/v2/projects/proj-test");
  assert.equal(asked.auth, "Bearer napi_test_key_1234567890");
  const by = Object.fromEntries(u.items.map((x) => [x.key, x]));
  assert.equal(by.compute.pct, 72);
  assert.ok(by.compute.projected > 100, "بهذه الوتيرة يتجاوز الحد قبل نهاية الشهر");
  assert.equal(by.storage.pct, 20);
  assert.equal(by.transfer.pct, 20);
  setUsageFetch(reply(401, {}));
  const bad = await dbUsage({ fresh: true });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /مفتاح Neon/);
});

test("التنبيه: مرة واحدة لكل حد ونسبة في الشهر، ويصل كتنبيه مهم للمالك", async () => {
  await transaction({ platform: true }, (q) => q("UPDATE security_alerts SET kind = kind || ':old' WHERE kind LIKE 'db_usage:%' AND kind NOT LIKE '%:old'"));
  setUsageConfig({ key: "napi_test_key_1234567890", project: "proj-test", cuHours: 100, storageGb: 0.5, transferGb: 5 });
  setUsageFetch(reply(200, project()));
  const first = await checkDbUsage();
  assert.equal(first.length, 1, JSON.stringify(first));
  assert.match(first[0], /^db_usage:compute:\d{4}-\d{2}:70$/);
  assert.deepEqual(await checkDbUsage(), [], "لا يتكرر");
  setUsageFetch(reply(200, project({ compute_time_seconds: 96 * 3600 })));
  await dbUsage({ fresh: true });
  const later = await checkDbUsage();
  assert.equal(later.length, 1);
  assert.match(later[0], /:95$/);
  const [a] = await transaction({ platform: true }, (q) => q("SELECT severity, title FROM security_alerts WHERE kind = $1", [later[0]]));
  assert.equal(a.severity, "high");
  assert.match(a.title, /96%/);
});
