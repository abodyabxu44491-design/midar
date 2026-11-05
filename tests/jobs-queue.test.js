/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Queued long jobs (Workers): a job is claimed once and never run twice, even when the queue delivers it again.
// An import run twice would create every student twice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, endPool, readySchool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";
import { runQueuedJob } from "../src/core/jobs.js";

let srv, A;
before(async () => { srv = await startServer(); A = await readySchool(srv.base, { prefix: "jq", students: 0 }); });
after(async () => { await srv.close(); await endPool(); });

async function queuedImport(names) {
  const [tenant] = await transaction({ tenantId: A.id }, (q) => q("SELECT id, max_students FROM tenants WHERE id = $1", [A.id]));
  const input = { tenantId: A.id, actor: "اختبار", ip: "127.0.0.1", tenant, gradeMap: {}, includeDuplicates: false,
    rows: names.map((n) => ({ "اسم الطالب": n, "الصف": "الأول", "الشعبة": "أ" })) };
  const [job] = await transaction({ tenantId: A.id }, (q) => q(
    `INSERT INTO jobs (tenant_id, kind, total, owner_key, created_by, input) VALUES ($1, 'import_students', $2, 'user:1', 'اختبار', $3) RETURNING id`,
    [A.id, names.length, input]));
  return job.id;
}
const count = async (name) => (await transaction({ tenantId: A.id }, (q) => q("SELECT count(*)::int AS n FROM students WHERE full_name = $1", [name])))[0].n;
const status = async (id) => (await transaction({ tenantId: A.id }, (q) => q("SELECT status, error, input IS NULL AS cleared FROM jobs WHERE id = $1", [id])))[0];

test("رسالة مكررة من الطابور لا تشغّل الاستيراد مرتين", async () => {
  const id = await queuedImport(["طالب الطابور الأول"]);
  assert.equal((await runQueuedJob(id)).ran, true);
  assert.equal((await runQueuedJob(id)).ran, false, "التسليم الثاني لا يشغّلها");
  assert.equal(await count("طالب الطابور الأول"), 1);
  const s = await status(id);
  assert.equal(s.status, "done");
  assert.equal(s.cleared, true, "بيانات الإدخال تُحذف بعد الانتهاء");
});

test("عملية بدأت ثم انقطع العامل: التسليم التالي يوقفها ولا يعيدها", async () => {
  const id = await queuedImport(["طالب العامل المنقطع"]);
  await transaction({ tenantId: A.id }, (q) => q("UPDATE jobs SET claimed_at = now() WHERE id = $1", [id]));   // a worker took it, then died
  assert.equal((await runQueuedJob(id)).ran, false);
  const s = await status(id);
  assert.equal(s.status, "failed");
  assert.match(s.error, /تحقق من البيانات/);
  assert.equal(await count("طالب العامل المنقطع"), 0, "لم يُستورد شيء في التسليم الثاني");
});
