/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionOrIp } from "../src/core/rate-limit.js";

// A school where every device leaves through one address: each signed-in user keeps their own allowance.
test("حد الطلبات: كل جلسة لها حصتها حتى لو كانت المدرسة كلها على عنوان واحد", () => {
  const ip = "203.0.113.7";
  const req = (cookie) => ({ ip, headers: cookie ? { cookie } : {} });
  const keys = new Set(Array.from({ length: 40 }, (_, i) => sessionOrIp(req(`midar_t=${"t".repeat(30)}${i}`))));
  assert.equal(keys.size, 40, "40 معلمًا على عنوان واحد = 40 حصة منفصلة");
  assert.ok([...keys].every((k) => k.startsWith("s:") && !k.includes(ip)), "المفتاح لا يكشف قيمة الجلسة ولا العنوان");
  assert.equal(sessionOrIp(req(`theme=dark; __Secure-midar_a=${"a".repeat(40)}`)).startsWith("s:"), true, "اسم الكوكي الآمن");
  assert.equal(sessionOrIp(req()), `ip:${ip}`, "بلا جلسة: على العنوان");
  assert.equal(sessionOrIp(req("midar_t=short")), `ip:${ip}`, "قيمة غير صالحة لا تُعامل كجلسة");
});
