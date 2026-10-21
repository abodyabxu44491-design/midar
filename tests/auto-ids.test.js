/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";
import { usernameFromName } from "../src/core/auto-ids.js";

let srv, A;
before(async () => {
  srv = await startServer();
  A = await readySchool(srv.base, { prefix: "ai", students: 1 });
});
after(async () => { await srv.close(); await endPool(); });

test("اسم المستخدم من اسم المعلم: بلا لقب، الاسم الأول والأخير بحروف إنجليزية", () => {
  assert.equal(usernameFromName("أ. خالد ناجي الحكيمي"), "khaled.alhkimi");
  assert.equal(usernameFromName("فاطمة عبد الله"), "fatima.abdullah");
  assert.equal(usernameFromName("محمد"), "mohammed");
  assert.match(usernameFromName("سلوى المقطري"), /^[a-z]+\.al[a-z]+$/);
  assert.equal(usernameFromName("ـــ"), "teacher", "اسم لا يعطي حروفًا يرجع لاسم عام");
});

test("إضافة معلم بلا اسم مستخدم ولا رقم وظيفي: يُنشآن تلقائيًا ولا يتكرران", async () => {
  const s = (await A.admin.get(`/api/admin/teachers/suggest?name=${encodeURIComponent("أ. خالد ناجي الحكيمي")}`)).data;
  assert.equal(s.username, "khaled.alhkimi");
  assert.match(s.employee_no, /^\d+$/);
  const one = await A.admin.post("/api/admin/teachers", { name: "أ. خالد ناجي الحكيمي", username: "" });
  assert.equal(one.status, 201, JSON.stringify(one.data));
  const two = await A.admin.post("/api/admin/teachers", { name: "خالد سعيد الحكيمي" });
  assert.equal(two.status, 201, JSON.stringify(two.data));
  const list = (await A.admin.get("/api/admin/teachers/")).data;
  const a = list.find((t) => t.name === "أ. خالد ناجي الحكيمي"), b = list.find((t) => t.name === "خالد سعيد الحكيمي");
  assert.equal(a.username, "khaled.alhkimi");
  assert.equal(b.username, "khaled.alhkimi2", "الاسم المكرر يأخذ رقمًا");
  assert.equal(a.employee_no, s.employee_no);
  assert.equal(Number(b.employee_no), Number(a.employee_no) + 1);
  assert.equal((await A.admin.get(`/api/admin/teachers/suggest?name=${encodeURIComponent("خالد الحكيمي")}`)).data.username, "khaled.alhkimi3");
});

test("طالب بلا رقم يأخذ رقم المدرسة التالي، وتجديد رمز الدخول يعمل", async () => {
  const add = (name) => A.admin.post("/api/admin/students", { name, class_id: A.c1.id });
  const x = await add("طالب الرقم الأول"), y = await add("طالب الرقم الثاني");
  assert.equal(x.status, 201, JSON.stringify(x.data));
  assert.match(x.data.student_no, /^\d{8}$/);
  assert.equal(Number(y.data.student_no), Number(x.data.student_no) + 1);
  const r = await A.admin.post(`/api/admin/students/${x.data.id}/regenerate-key`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.access_key);
});
