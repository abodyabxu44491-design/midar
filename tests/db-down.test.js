/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// When the database cannot be reached the user gets a clear "back soon", and background work lets an idle database sleep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorHandler, isDatabaseDown } from "../src/core/http/errors.js";
import { gated, markActive } from "../src/core/activity.js";

const respond = (err) => {
  const out = {};
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  errorHandler(err, { method: "POST", originalUrl: "/api/x" }, res, () => {});
  return out;
};

test("قاعدة البيانات غير متاحة: رسالة واضحة 503 بدل خطأ في الخادم", () => {
  const quota = Object.assign(new Error("ERROR:  Your account or project has exceeded the quota. Upgrade your plan to increase limits."), { code: "XX000" });
  for (const e of [quota, Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
    new Error("timeout exceeded when trying to connect"), Object.assign(new Error("terminating connection"), { code: "57P01" })]) {
    assert.ok(isDatabaseDown(e), e.message);
    const r = respond(e);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "unavailable");
    assert.match(r.body.error, /متوقفة مؤقتًا/);
  }
  assert.equal(isDatabaseDown(Object.assign(new Error("duplicate"), { code: "23505" })), false);
  assert.equal(respond(new Error("boom")).status, 500, "الأخطاء الأخرى كما هي");
});

test("العمل الخلفي: كل دورة أثناء الاستخدام، ونادرًا عند الخمول", async () => {
  let runs = 0;
  const tick = gated(() => { runs++; }, { activeWithinMs: 50, idleEveryMs: 10_000 });
  markActive();
  tick(); tick();
  assert.equal(runs, 2, "أثناء الاستخدام يعمل كل مرة");
  await new Promise((r) => setTimeout(r, 80));
  tick(); tick(); tick();
  assert.equal(runs, 2, "عند الخمول لا يعمل قبل مرور المدة");
  markActive();
  tick();
  assert.equal(runs, 3);
});
