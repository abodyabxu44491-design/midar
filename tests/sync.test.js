// اختبارات المزامنة (سيناريوهات القبول في وثيقة المعمارية، جانب الخادم):
// عدم التكرار، التعارض بدل الكتابة الصامتة، نفس قواعد العمل، النطاق والعزل، التغييرات منذ آخر نقطة، وإيقاف الأجهزة
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner;
const s = {};
const DEVICE = crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const op = (type, payload, base_version = 0, extra = {}) => ({ operation_id: crypto.randomUUID(), type, payload, base_version, client_time: new Date().toISOString(), ...extra });
const push = (c, operations, device_id = DEVICE) => c.post("/api/teacher/sync/push", { device_id, operations });

async function school(name) {
  const id = `sync-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, max_students: 100 });
  const admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  return { id, admin };
}
async function teacher(sc, load) {
  const u = `t${uid()}`;
  const r = await sc.admin.post("/api/admin/teachers", { name: `معلم ${u}`, username: u, load });
  const c = client(srv.base);
  assert.equal((await c.post("/api/staff/login", { school: sc.id, username: u, password: r.data.credentials.password })).status, 200);
  return c;
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  s.A = await school("مدرسة المزامنة");
  s.B = await school("مدرسة أخرى");
  s.c1 = (await s.A.admin.post("/api/admin/structure/classes", { name: "فصل المعلم" })).data.id;
  s.c2 = (await s.A.admin.post("/api/admin/structure/classes", { name: "فصل آخر" })).data.id;
  s.sub = (await s.A.admin.post("/api/admin/structure/subjects", { name: "العلوم" })).data.id;
  const add = async (sc, name, class_id) => { const r = await sc.admin.post("/api/admin/students", { name, class_id }); return r.data.student ?? r.data; };
  s.st1 = await add(s.A, "طالب أول", s.c1);
  s.st2 = await add(s.A, "طالب ثان", s.c1);
  s.other = await add(s.A, "طالب في فصل آخر", s.c2);
  const bc = (await s.B.admin.post("/api/admin/structure/classes", { name: "فصل ب" })).data.id;
  s.foreign = await add(s.B, "طالب مدرسة أخرى", bc);
  s.t = await teacher(s.A, [{ class_id: s.c1, subject_id: s.sub }]);
  s.t2 = await teacher(s.A, [{ class_id: s.c2, subject_id: s.sub }]);
  const ex = await s.t.post("/api/teacher/exams", { class_id: s.c1, subject_id: s.sub, title: "اختبار المزامنة", max_score: 20 });
  assert.equal(ex.status, 201, JSON.stringify(ex.data));
  s.exam = ex.data.id;
});

after(async () => { await srv.close(); await endPool(); });

test("اللقطة الأولى: نطاق المعلم فقط وبأقل الحقول", async () => {
  const b = await s.t.get("/api/teacher/sync/bootstrap");
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.deepEqual(b.data.students.map((x) => x.name).sort(), ["طالب أول", "طالب ثان"]);
  assert.deepEqual(Object.keys(b.data.students[0]).sort(), ["class_id", "id", "name"], "لا جوالات ولا معرفات سرية على الجهاز");
  assert.ok(b.data.exams.some((e) => e.id === s.exam));
  assert.equal(typeof b.data.cursor, "number");
  s.cursor = b.data.cursor;
});

test("عملية حضور بدون اتصال تُطبَّق مرة واحدة فقط مهما أُعيد إرسالها", async () => {
  const o = op("attendance.mark", { student_id: s.st1.id, day: today, status: "absent" }, 0, { client_seq: 1 });
  const r1 = await push(s.t, [o]);
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.results[0].status, "applied");
  const r2 = await push(s.t, [o]);
  assert.equal(r2.data.results[0].status, "applied");
  assert.equal(r2.data.results[0].duplicate, true, "إعادة الإرسال لا تكرر الأثر");
  const rows = await transaction({ tenantId: s.A.id }, (q) => q("SELECT status, version FROM attendance WHERE student_id = $1 AND day = $2", [s.st1.id, today]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, 1, "لم يُطبَّق مرتين");
  s.attVersion = r1.data.results[0].version;
});

test("تعديل على نسخة قديمة: تعارض يُراجَع بدل الكتابة الصامتة، ثم حله", async () => {
  // الإدارة غيّرت الحالة بعد أن رآها الجهاز
  assert.equal((await s.A.admin.post("/api/admin/attendance", { date: today, reason: "تصحيح من الإدارة", entries: [{ student_id: s.st1.id, status: "late" }] })).status, 200);
  const stale = op("attendance.mark", { student_id: s.st1.id, day: today, status: "present" }, s.attVersion);
  const r = await push(s.t, [stale]);
  assert.equal(r.data.results[0].status, "conflict");
  assert.deepEqual(r.data.results[0].server.status, "late");
  assert.deepEqual(r.data.results[0].local.status, "present");
  const [row] = await transaction({ tenantId: s.A.id }, (q) => q("SELECT status FROM attendance WHERE student_id = $1 AND day = $2", [s.st1.id, today]));
  assert.equal(row.status, "late", "القيمة الأحدث لم تُكتب فوقها");

  const adminList = await s.A.admin.get("/api/admin/sync/conflicts");
  assert.ok(adminList.data.some((c) => c.operation_id === stale.operation_id), "التعارض يظهر للإدارة");
  assert.equal((await s.t2.post(`/api/teacher/sync/conflicts/${stale.operation_id}/resolve`, { choice: "local" })).status, 404, "تعارض معلم آخر");
  const res = await s.t.post(`/api/teacher/sync/conflicts/${stale.operation_id}/resolve`, { choice: "local" });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [after] = await transaction({ tenantId: s.A.id }, (q) => q("SELECT status FROM attendance WHERE student_id = $1 AND day = $2", [s.st1.id, today]));
  assert.equal(after.status, "present", "حل المعلم لصالح قيمة جهازه");
  assert.equal((await s.t.get("/api/teacher/sync/conflicts")).data.length, 0);
});

test("الدرجات: تعارض على نسخة قديمة، ونفس قواعد الشاشة (العظمى، القفل بعد الإرسال)", async () => {
  const a = await push(s.t, [op("score.set", { exam_id: s.exam, student_id: s.st2.id, score: 15 }, 0)]);
  assert.equal(a.data.results[0].status, "applied");
  const v = a.data.results[0].version;
  // جهاز آخر (أو الشاشة) عدّل الدرجة
  assert.equal((await s.t.put(`/api/teacher/exams/${s.exam}/scores`, { scores: { [s.st2.id]: 18 } })).status, 200);
  const c = await push(s.t, [op("score.set", { exam_id: s.exam, student_id: s.st2.id, score: 12 }, v)]);
  assert.equal(c.data.results[0].status, "conflict");
  assert.equal(c.data.results[0].server.score, 18);
  assert.equal(c.data.results[0].local.score, 12);
  const over = await push(s.t, [op("score.set", { exam_id: s.exam, student_id: s.st1.id, score: 25 }, 0)]);
  assert.equal(over.data.results[0].status, "rejected");
  assert.match(over.data.results[0].error, /العظمى/);
  assert.equal((await s.t.post(`/api/teacher/exams/${s.exam}/submit`)).status, 200);
  const locked = await push(s.t, [op("score.set", { exam_id: s.exam, student_id: s.st1.id, score: 10 }, 0)]);
  assert.equal(locked.data.results[0].status, "rejected", "الاختبار المُرسل للاعتماد مقفل حتى بدون اتصال");
});

test("الصلاحيات والعزل: لا فصل غير مسند، ولا طالب مدرسة أخرى، وفشل عملية لا يلغي غيرها", async () => {
  const r = await push(s.t, [
    op("attendance.mark", { student_id: s.other.id, day: today, status: "absent" }, 0, { client_seq: 1 }),
    op("attendance.mark", { student_id: s.foreign.id, day: today, status: "absent" }, 0, { client_seq: 2 }),
    op("attendance.mark", { student_id: s.st2.id, day: today, status: "present" }, 0, { client_seq: 3 }),
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.results.map((x) => x.status), ["rejected", "rejected", "applied"]);
  const [foreign] = await transaction({ tenantId: s.B.id }, (q) => q("SELECT count(*)::int AS n FROM attendance WHERE student_id = $1", [s.foreign.id]));
  assert.equal(foreign.n, 0);
  const reused = await push(s.t2, [{ ...op("attendance.mark", { student_id: s.other.id, day: today, status: "late" }), operation_id: r.data.results[2].operation_id }], crypto.randomUUID());
  assert.equal((await push(s.t2, [op("attendance.mark", { student_id: s.other.id, day: today, status: "late" })])).status, 403, "جهاز مسجل لمستخدم آخر");
  assert.equal(reused.data.results[0].status, "rejected", "لا يُعاد استخدام هوية عملية مستخدم آخر");
});

test("التغييرات منذ آخر نقطة: ما يخص فصول المعلم فقط، والمؤشر يتقدم، وإعادة اللقطة عند مؤشر قديم", async () => {
  await s.A.admin.post("/api/admin/attendance", { date: today, entries: [{ student_id: s.other.id, status: "excused" }] });
  const ch = await s.t.get(`/api/teacher/sync/changes?since=${s.cursor}`);
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  assert.ok(ch.data.attendance.some((a) => a.student_id === s.st1.id && a.status === "present"));
  assert.ok(!ch.data.attendance.some((a) => a.student_id === s.other.id), "لا تغييرات فصول الآخرين");
  assert.ok(ch.data.cursor > s.cursor);
  const again = await s.t.get(`/api/teacher/sync/changes?since=${ch.data.cursor}`);
  assert.equal(again.data.attendance.length, 0, "لا شيء جديد");
  // تغييرات قديمة حُذفت من السجل: الجهاز يُطلب منه إعادة اللقطة
  await transaction({ platform: true }, (q) => q("DELETE FROM sync_changes WHERE tenant_id = $1 AND seq <= $2", [s.A.id, ch.data.cursor]));
  await s.A.admin.post("/api/admin/attendance", { date: today, reason: "x", entries: [{ student_id: s.st2.id, status: "late" }] });
  const old = await s.t.get(`/api/teacher/sync/changes?since=1`);
  assert.equal(old.data.reset, true);
});

test("إيقاف جهاز يمنعه من المزامنة", async () => {
  const devices = await s.A.admin.get("/api/admin/sync/devices");
  assert.ok(devices.data.some((d) => d.device_id === DEVICE));
  assert.equal((await s.A.admin.post(`/api/admin/sync/devices/${DEVICE}/revoke`, {})).status, 200);
  const r = await push(s.t, [op("attendance.mark", { student_id: s.st2.id, day: today, status: "present" })]);
  assert.equal(r.status, 403);
  const other = await push(s.t, [op("attendance.mark", { student_id: s.st2.id, day: today, status: "late" })], crypto.randomUUID());
  assert.equal(other.status, 200, "جهاز آخر غير موقوف يعمل");
  const st = await s.A.admin.get("/api/admin/sync/stats");
  assert.ok(st.data.applied >= 3 && st.data.conflicts >= 1);
});
