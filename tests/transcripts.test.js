/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool, uid } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

const T = "/api/admin/certificates/transcripts";
let srv, A, B, deputy, exam, first;
const key = () => ({ class_id: A.c1.id, scope: "term" });
const preview = (c = A.admin, extra = {}) => c.post(`${T}/preview`, { ...key(), ...extra });

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "tr", students: 3 });
  B = await readySchool(srv.base, { prefix: "tx", students: 1 });
  const e = await A.teacher.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "النهائي", max_score: 20 });
  exam = e.data.id;
  const [s1, s2] = A.students;
  await A.teacher.put(`/api/teacher/exams/${exam}/scores`, { scores: { [s1.id]: 18, [s2.id]: 6 } });
  await A.teacher.post(`/api/teacher/exams/${exam}/submit`, {});
  assert.equal((await A.admin.post(`/api/admin/exams/${exam}/status`, { status: "published" })).status, 200);
  const username = `trd-${uid()}`;
  const pw = (await A.admin.post("/api/admin/users/admins", { name: "وكيل الشؤون", username, admin_scope: "school" })).data.credentials.password;
  deputy = client(srv.base);
  assert.equal((await deputy.post("/api/staff/login", { school: A.id, username, password: pw })).status, 200);
  await transaction({ tenantId: A.id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = $1", [username]));
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("الكشف يُعرض من الدرجات الحالية كمسودة، ولا يصدر رسميًا قبل الاعتماد", async () => {
  const p = await preview();
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.status, "none");
  assert.equal(p.data.ready, false);
  assert.equal(p.data.can_issue, true);
  const [s1, s2, s3] = A.students;
  const by = Object.fromEntries(p.data.students.map((s) => [s.id, s]));
  assert.equal(by[s1.id].percent, 90);
  assert.equal(by[s3.id].subjects, 0);
  assert.equal(by[s1.id].issued, null);
  assert.equal(p.data.transcripts.length, 2, "من لا درجات له لا كشف له");
  const t1 = p.data.transcripts.find((x) => x.student.name === s1.name);
  assert.equal(t1.subjects[0].subject, "الرياضيات");
  assert.equal(t1.subjects[0].passed, true);
  assert.equal(p.data.transcripts.find((x) => x.student.name === s2.name).subjects[0].passed, false);
  assert.match(t1.result, /ناجح/);
  assert.deepEqual(Object.values(t1.options), [true, true, true, true, true, true]);
  const one = await preview(A.admin, { student_ids: [s2.id], notes: { [s2.id]: "يحتاج متابعة في الرياضيات" } });
  assert.equal(one.data.transcripts.length, 1);
  assert.equal(one.data.transcripts[0].note, "يحتاج متابعة في الرياضيات");
  assert.equal((await A.admin.post(`${T}/issue`, key())).status, 409, "لا كشف رسمي قبل اعتماد النتائج");
});

test("إصدار رسمي من النتائج المعتمدة: رقم ورمز تحقق وملاحظة، ويظهر لولي الأمر", async () => {
  assert.equal((await A.admin.post("/api/admin/certificates/results/submit", key())).status, 200);
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", { ...key(), allow_incomplete: true, reason: "مادة واحدة في هذا الاختبار" })).status, 200);
  assert.equal((await preview()).data.ready, true);
  const [s1, s2] = A.students;
  const r = await A.admin.post(`${T}/issue`, { ...key(), notes: { [s1.id]: "متفوق ومنضبط" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.issued, 2);
  assert.equal(r.data.new_versions, 0);
  const pr = (await A.admin.post("/api/admin/certificates/print", { ids: r.data.ids })).data;
  first = pr.find((x) => x.data.student.name === s1.name);
  assert.equal(first.kind, "transcript");
  assert.match(first.serial, /^\d{4}-\d{6}$/);
  assert.match(first.qr, /^data:image\/svg\+xml;base64,/);
  assert.equal(first.data.version, 1);
  assert.equal(first.data.note, "متفوق ومنضبط");
  assert.ok(first.data.approval.at && first.data.approval.by);
  assert.equal(pr.find((x) => x.data.student.name === s2.name).data.note, null);
  const v = (await client(srv.base).get(`/api/public/verify/${first.code}`)).data;
  assert.equal(v.status, "issued");
  assert.match(v.title, /^كشف درجات /);
  assert.equal(v.student, s1.name);
  const by = Object.fromEntries((await preview()).data.students.map((s) => [s.id, s]));
  assert.equal(by[s1.id].issued.version, 1);
  assert.equal(by[s1.id].issued.serial, first.serial);
  const parent = (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s1))).data;
  const mine = parent.features.certificates.find((c) => c.id === first.id);
  assert.ok(mine, "ولي الأمر يرى الكشف");
  const pp = await client(srv.base).post(`/api/public/${A.id}/student/certificates/print`, { ...A.parent(s1), id: first.id });
  assert.equal(pp.status, 200);
  assert.equal(pp.data[0].kind, "transcript");
  assert.equal(pp.data[0].data.subjects[0].score, 18);
});

test("تصحيح بعد الإصدار: نسخة جديدة برقم جديد، والسابقة «مستبدلة» في السجل والتحقق", async () => {
  const [s1] = A.students;
  // A grade change sends the approved results back to review; no transcript is issued until approval again.
  assert.equal((await A.admin.post(`/api/admin/exams/${exam}/status`, { status: "draft" })).status, 200);
  await A.teacher.put(`/api/teacher/exams/${exam}/scores`, { scores: { [s1.id]: 19 } });
  assert.equal((await A.admin.post(`/api/admin/exams/${exam}/status`, { status: "published" })).status, 200);
  assert.equal((await A.admin.post(`${T}/issue`, { ...key(), student_ids: [s1.id] })).status, 409);
  assert.equal((await client(srv.base).get(`/api/public/verify/${first.code}`)).data.status, "issued", "الكشف الصادر لا يتغير وحده");
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", { ...key(), allow_incomplete: true, reason: "اعتماد بعد تصحيح الدرجة" })).status, 200);
  const r = await A.admin.post(`${T}/issue`, { ...key(), student_ids: [s1.id], reason: "تصحيح درجة الرياضيات" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual([r.data.issued, r.data.new_versions], [1, 1]);
  const now = (await A.admin.post("/api/admin/certificates/print", { ids: r.data.ids })).data[0];
  assert.equal(now.data.version, 2);
  assert.equal(now.data.subjects[0].score, 19);
  assert.notEqual(now.serial, first.serial);
  const old = (await client(srv.base).get(`/api/public/verify/${first.code}`)).data;
  assert.equal(old.status, "replaced");
  const oldPrint = (await A.admin.post("/api/admin/certificates/print", { ids: [first.id] })).data[0];
  assert.equal(oldPrint.data.subjects[0].score, 18, "النسخة السابقة محفوظة كما صدرت");
  assert.equal(oldPrint.status, "replaced");
  const h = (await A.admin.get(`/api/admin/certificates/${first.id}/history`)).data.map((x) => x.action);
  assert.ok(h.includes("replaced"));
  assert.equal((await A.admin.post(`/api/admin/certificates/${now.id}/replace`, { reason: "تجربة" })).status, 400, "النسخ الجديدة من صفحة كشف الدرجات");
  const list = (await A.admin.get(`/api/admin/certificates?student_id=${s1.id}`)).data.filter((c) => c.kind === "transcript");
  assert.deepEqual(list.map((c) => c.status).sort(), ["issued", "replaced"]);
});

test("ما يظهر في الكشف يُضبط من الإعدادات، والكشوف الصادرة تبقى كما صدرت", async () => {
  assert.equal((await A.admin.put("/api/admin/communication/features/certificates", { tr_percent: false, tr_guardian_sign: false })).status, 200);
  const o = (await preview()).data.options;
  assert.equal(o.tr_percent, false);
  assert.equal(o.tr_guardian_sign, false);
  assert.equal(o.tr_grade, true);
  assert.equal((await A.admin.post("/api/admin/certificates/print", { ids: [first.id] })).data[0].data.options.tr_percent, true);
  assert.equal((await A.admin.put("/api/admin/communication/features/certificates", { tr_percent: "x" })).status, 400);
  await A.admin.put("/api/admin/communication/features/certificates", { tr_percent: true, tr_guardian_sign: true });
});

test("Excel لنتائج الشعبة، وطباعة كل كشوف الصف الرسمية", async () => {
  const qs = new URLSearchParams({ class_id: String(A.c1.id), scope: "term" });
  const res = await fetch(`${srv.base}${T}/export.xlsx?${qs}`, { headers: { Cookie: A.admin.cookie() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /spreadsheetml/);
  assert.match(decodeURIComponent(res.headers.get("content-disposition")), /نتائج-/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const [cls] = await transaction({ tenantId: A.id }, (q) => q("SELECT grade_id FROM classes WHERE id = $1", [A.c1.id]));
  const ids = await A.admin.get(`${T}/issued?grade_id=${cls.grade_id}&scope=term`);
  assert.equal(ids.status, 200, JSON.stringify(ids.data));
  assert.equal(ids.data.length, 2, "الساري فقط: كشفان");
  assert.equal((await A.admin.get(`${T}/issued?scope=term`)).status, 400);
});

test("الصلاحيات والعزل", async () => {
  const d = await preview(deputy);
  assert.equal(d.status, 200);
  assert.equal(d.data.can_issue, false);
  assert.equal((await deputy.post(`${T}/issue`, key())).status, 403);
  const qs = new URLSearchParams({ class_id: String(A.c1.id), scope: "term" });
  assert.equal((await fetch(`${srv.base}${T}/export.xlsx?${qs}`, { headers: { Cookie: deputy.cookie() } })).status, 200);
  assert.ok([401, 403].includes((await A.teacher.post(`${T}/preview`, key())).status));
  assert.ok([401, 403].includes((await client(srv.base).post(`${T}/preview`, key())).status));
  assert.equal((await preview(B.admin)).status, 404, "لا اطلاع على شعبة مدرسة أخرى");
  assert.equal((await B.admin.post(`${T}/issue`, key())).status, 404);
  assert.equal((await fetch(`${srv.base}${T}/export.xlsx?${qs}`, { headers: { Cookie: B.admin.cookie() } })).status, 404);
  assert.equal((await B.admin.post("/api/admin/certificates/print", { ids: [first.id] })).data.length, 0);
  const [s2] = [A.students[1]];
  const own = (await A.admin.get(`/api/admin/certificates?student_id=${A.students[0].id}`)).data.find((c) => c.kind === "transcript" && c.status === "issued");
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student/certificates/print`, { ...A.parent(s2), id: own.id })).status, 404, "ولي أمر طالب آخر لا يطبع الكشف");
});
