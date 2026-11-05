/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The database is billed by the time it is awake (Neon free tier: 100 compute-hours a month). Visitors and search
// engines opening the public site must neither query it nor switch the background work to full pace.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, endPool } from "./helpers.js";
import { idleMs } from "../src/core/activity.js";
import { clearSiteCache } from "../src/modules/shared/plans-public.service.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await endPool(); });

const queriesOf = (res) => Number((res.headers.get("server-timing") || "").match(/desc="(\d+) queries/)?.[1] ?? NaN);

test("زيارات الصفحة الرئيسية وبيانات الموقع لا تستعلم من قاعدة البيانات بعد أول تحميل", async () => {
  clearSiteCache();
  await fetch(`${srv.base}/api/site`);   // first load fills the cache
  for (let i = 0; i < 10; i++) {
    for (const path of ["/", "/api/site"]) {
      const res = await fetch(`${srv.base}${path}`);
      assert.equal(res.status, 200);
      await res.arrayBuffer();
      assert.equal(queriesOf(res), 0, `${path}: لا استعلامات`);
    }
  }
});

test("زيارة الموقع العام لا تُعدّ استخدامًا للمنصة (لا تشغّل المهام الخلفية بكامل سرعتها)", async () => {
  await new Promise((r) => setTimeout(r, 30));
  const before = idleMs();
  for (const path of ["/api/site", "/api/version", "/api/analytics-config", "/"]) await (await fetch(`${srv.base}${path}`)).arrayBuffer();
  assert.ok(idleMs() >= before, "لم يُسجل نشاط");
  await (await fetch(`${srv.base}/api/admin/me`)).arrayBuffer();   // a real use of the platform (even unauthenticated)
  assert.ok(idleMs() < before, "الاستخدام الحقيقي يُسجل");
});

test("تعديل المالك يمسح ذاكرة الموقع فيظهر التغيير فورًا", async () => {
  await fetch(`${srv.base}/api/site`);
  clearSiteCache();   // what every owner change does (owner/index.js)
  const res = await fetch(`${srv.base}/api/site`);
  await res.arrayBuffer();
  assert.ok(queriesOf(res) > 0, "بعد التعديل تُقرأ البيانات من جديد");
});
