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

test("قاعدة البيانات غير متاحة: رسالة الصيانة 503 بدل خطأ في الخادم", () => {
  const quota = Object.assign(new Error("ERROR:  Your account or project has exceeded the quota. Upgrade your plan to increase limits."), { code: "XX000" });
  for (const e of [quota, Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
    new Error("timeout exceeded when trying to connect"), Object.assign(new Error("terminating connection"), { code: "57P01" })]) {
    assert.ok(isDatabaseDown(e), e.message);
    const r = respond(e);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "unavailable");
    assert.match(r.body.error, /وضع الصيانة/);
  }
  assert.equal(isDatabaseDown(Object.assign(new Error("duplicate"), { code: "23505" })), false);
  const other = respond(new Error("boom"));
  assert.equal(other.status, 500);
  assert.match(other.body.error, /وضع الصيانة/, "أي خطأ آخر في الخادم يظهر كصيانة");
  assert.ok(other.body.ref, "المرجع يبقى للدعم");
});

test("العمل الخلفي: كل دورة أثناء الاستخدام، وعند الخمول كل الأعمال في نافذة واحدة مشتركة", async () => {
  let a = 0, b = 0, c = 0;
  const jobA = gated(() => { a++; }, { activeWithinMs: 50 });
  const jobB = gated(() => { b++; }, { activeWithinMs: 50 });
  const hourly = gated(() => { c++; }, { activeWithinMs: 50, activeEveryMs: 60 * 60_000 });
  markActive();
  jobA(); jobA(); hourly(); hourly();
  assert.equal(a, 2, "أثناء الاستخدام يعمل كل مرة");
  assert.equal(c, 1, "والعمل الساعي مرة في الساعة");
  await new Promise((r) => setTimeout(r, 80));
  for (let i = 0; i < 5; i++) { jobA(); jobB(); hourly(); }
  assert.deepEqual([a, b, c], [3, 1, 2], "عند الخمول: كل عمل مرة واحدة في النافذة المشتركة، فتستيقظ القاعدة مرة واحدة");
  markActive();
  jobA();
  assert.equal(a, 4);
});
