// العمليات الخلفية: الاستيراد يعمل في الخلفية ويظهر تقدمه، والنتيجة لصاحبها فقط وفي مدرسته فقط،
// وكلمات المرور المؤقتة لا تُحفظ في القاعدة، ولا تعمل عمليتان من النوع نفسه معًا، والفشل يظهر برسالة واضحة.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner;
const A = {}, B = {};

async function school(o) {
  o.id = `jb-${uid()}`.slice(0, 28);
  const r = await owner.post("/api/owner/tenants", { id: o.id, name: `مدرسة ${o.id}`, max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  o.admin = client(srv.base);
  assert.equal((await o.admin.post("/api/staff/login", { school: o.id, username: "admin", password: r.data.credentials.password })).status, 200);
  await transaction({ tenantId: o.id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
}
async function waitJob(c, url) {
  for (let i = 0; i < 300; i++) {
    const res = await c.get(url);
    if (res.status !== 200 || res.data.status !== "running") return res;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("job timeout");
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await school(A); await school(B);
});
after(async () => { await srv.close(); await endPool(); });

test("استيراد المعلمين في الخلفية: التقدم، وكلمات المرور لصاحب العملية مرة واحدة ولا تُحفظ", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ employee_no: `77${i}`, name: `معلم تجربة ${i + 1}` }));
  const start = await A.admin.post("/api/admin/import/teachers/commit", { rows });
  assert.equal(start.status, 202, JSON.stringify(start.data));
  const url = `/api/admin/jobs/${start.data.id}`;

  // مدرسة أخرى لا ترى العملية (عزل المدارس)
  assert.equal((await B.admin.get(url)).status, 404);

  const done = await waitJob(A.admin, url);
  assert.equal(done.data.status, "done", JSON.stringify(done.data));
  assert.equal(done.data.done, done.data.total);
  assert.equal(done.data.summary.created, 6);
  assert.equal(done.data.secret.credentials.length, 6);
  const pw = done.data.secret.credentials[0].password;

  const row = await transaction({ tenantId: A.id }, async (q) => (await q("SELECT * FROM jobs WHERE id = $1", [start.data.id]))[0]);
  assert.ok(!JSON.stringify(row).includes(pw), "لا كلمة مرور في jobs");
  assert.equal((await A.admin.get(url)).data.secret, undefined, "تُسلَّم مرة واحدة");

  // الحسابات أُنشئت فعلًا وتعمل بكلمة المرور المسلَّمة
  const t = client(srv.base);
  assert.equal((await t.post("/api/staff/login", { school: A.id, username: done.data.secret.credentials[0].username, password: pw })).status, 200);
});

test("استيراد الطلاب في الخلفية ينجح، والفشل يعود برسالة واضحة دون أن يكتب شيئًا", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ "اسم الطالب": `طالب تجربة ${i + 1}`, "رقم الطالب": `S${i + 100}` }));
  const start = await A.admin.post("/api/admin/import/students/commit", { rows });
  assert.equal(start.status, 202);
  const done = await waitJob(A.admin, `/api/admin/jobs/${start.data.id}`);
  assert.equal(done.data.status, "done", JSON.stringify(done.data));
  assert.equal(done.data.summary.created, 12);

  // تجاوز حد الباقة (50): تفشل العملية كاملة برسالة الخادم، ولا يُضاف أي طالب
  const many = Array.from({ length: 60 }, (_, i) => ({ "اسم الطالب": `طالب زائد ${i + 1}` }));
  const before = await transaction({ tenantId: A.id }, async (q) => (await q("SELECT count(*)::int AS n FROM students"))[0].n);
  const f = await A.admin.post("/api/admin/import/students/commit", { rows: many });
  const failed = await waitJob(A.admin, `/api/admin/jobs/${f.data.id}`);
  assert.equal(failed.data.status, "failed");
  assert.match(failed.data.error, /حد الباقة/);
  const after = await transaction({ tenantId: A.id }, async (q) => (await q("SELECT count(*)::int AS n FROM students"))[0].n);
  assert.equal(after, before);
});

test("لا تعمل عمليتان من النوع نفسه للمدرسة نفسها معًا", async () => {
  await transaction({ tenantId: B.id }, (q) => q(
    "INSERT INTO jobs (tenant_id, kind, owner_key, created_by) VALUES (app_tenant(), 'import_students', 'user:0', 'اختبار')"));
  const r = await B.admin.post("/api/admin/import/students/commit", { rows: [{ "اسم الطالب": "طالب" }] });
  assert.equal(r.status, 409);
  // نوع آخر مسموح
  const t = await B.admin.post("/api/admin/import/teachers/commit", { rows: [{ employee_no: "555", name: "معلم" }] });
  assert.equal(t.status, 202);
  await waitJob(B.admin, `/api/admin/jobs/${t.data.id}`);
});
