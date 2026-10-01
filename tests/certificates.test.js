// الشهادات: النتيجة من الدرجات المنشورة، الإصدار والاستبدال، التحقق العام برمز QR، الإلغاء، وطباعة ولي الأمر، والعزل
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, A, B, issued;

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "ce", students: 3 });
  B = await readySchool(srv.base, { prefix: "cb", students: 1 });
  // اختبار منشور: الأول 18/20 ناجح، الثاني 6/20 دور ثانٍ، الثالث بلا درجة
  const e = await A.teacher.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "النهائي", max_score: 20 });
  const [s1, s2] = A.students;
  await A.teacher.put(`/api/teacher/exams/${e.data.id}/scores`, { scores: { [s1.id]: 18, [s2.id]: 6 } });
  await A.teacher.post(`/api/teacher/exams/${e.data.id}/submit`, {});
  assert.equal((await A.admin.post(`/api/admin/exams/${e.data.id}/status`, { status: "published" })).status, 200);
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("المعاينة تحسب النتيجة من الدرجات المنشورة وحد النجاح", async () => {
  const p = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term", dry_run: true });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const [s1, s2, s3] = A.students;
  const by = Object.fromEntries(p.data.students.map((s) => [s.id, s]));
  assert.equal(by[s1.id].result, "ناجح");
  assert.equal(by[s1.id].percent, 90);
  assert.match(by[s2.id].result, /دور ثانٍ في: الرياضيات/);
  assert.equal(by[s3.id].subjects, 0);
});

test("الإصدار: شهادة لكل طالب له درجات، برمز تحقق عام يعمل بلا دخول", async () => {
  const r = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term" });
  assert.equal(r.status, 201);
  assert.equal(r.data.issued, 2, "الطالب بلا درجات لا تصدر له شهادة");
  const list = (await A.admin.get(`/api/admin/certificates?class_id=${A.c1.id}`)).data;
  issued = list.find((c) => c.student_id === A.students[0].id);
  assert.match(issued.code, /^[A-HJ-NP-Z2-9]{10}$/);
  const v = await client(srv.base).get(`/api/public/verify/${issued.code}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.student, A.students[0].name);
  assert.equal(v.data.revoked, false);
  assert.equal(v.data.result, "ناجح");
  assert.equal(Object.keys(v.data).sort().join(","), "class_name,issued_at,percent,result,revoked,school,student,title", "التحقق لا يكشف بيانات أخرى");
  assert.equal((await client(srv.base).get("/api/public/verify/AAAAAAAAAA")).status, 404);
  // صفحة التحقق نفسها
  const page = await fetch(`${srv.base}/verify/${issued.code}`);
  assert.equal(page.status, 200);
  // الطباعة فيها رابط التحقق وصورة QR
  const pr = await A.admin.post("/api/admin/certificates/print", { ids: [issued.id] });
  assert.ok(pr.data[0].verify_url.endsWith(`/verify/${issued.code}`));
  assert.match(pr.data[0].qr, /^data:image\/svg\+xml;base64,/);
  assert.equal(pr.data[0].data.subjects[0].subject, "الرياضيات");
});

test("إعادة الإصدار تلغي السابقة، والإلغاء اليدوي يظهر في التحقق", async () => {
  await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term", student_ids: [A.students[0].id] });
  const old = await client(srv.base).get(`/api/public/verify/${issued.code}`);
  assert.equal(old.data.revoked, true, "القديمة أُلغيت");
  const cur = (await A.admin.get(`/api/admin/certificates?student_id=${A.students[0].id}`)).data.find((c) => !c.revoked_at);
  assert.equal((await A.admin.post(`/api/admin/certificates/${cur.id}/revoke`, { reason: "خطأ في الاسم" })).status, 200);
  assert.equal((await client(srv.base).get(`/api/public/verify/${cur.code}`)).data.revoked, true);
});

test("ولي الأمر: يرى شهادات ابنه ويطبعها، ولا يطبع شهادة طالب آخر", async () => {
  const [, s2] = A.students;
  const p = (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s2))).data;
  assert.equal(p.features.certificates.length, 1);
  const id = p.features.certificates[0].id;
  const ok = await client(srv.base).post(`/api/public/${A.id}/student/certificates/print`, { ...A.parent(s2), id });
  assert.equal(ok.status, 200);
  assert.ok(ok.data[0].qr);
  const s1Cert = (await A.admin.get(`/api/admin/certificates?student_id=${A.students[0].id}`)).data[0];
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student/certificates/print`, { ...A.parent(s2), id: s1Cert.id })).status, 404);
  const inbox = (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s2))).data;
  assert.ok(inbox.items.some((n) => n.kind === "certificate"));
});

test("شهادة مخصصة، والإعدادات (حد النجاح والموقّع)، والإيقاف، والعزل", async () => {
  const [, , s3] = A.students;
  const c = await A.admin.post("/api/admin/certificates/custom", { student_id: s3.id, title: "شهادة تقدير", body: "لتفوقه في مسابقة القرآن الكريم" });
  assert.equal(c.status, 201);
  const pr = (await A.admin.post("/api/admin/certificates/print", { ids: [c.data.id] })).data[0];
  assert.equal(pr.data.body, "لتفوقه في مسابقة القرآن الكريم");
  await A.admin.put("/api/admin/communication/features/certificates", { pass_mark: 25, signer_name: "أ. عبدالله سالم" });
  const p = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term", dry_run: true });
  assert.equal(p.data.students.find((x) => x.id === A.students[1].id).result, "ناجح", "6/20 = 30% ناجح بحد 25");
  assert.equal((await A.admin.put("/api/admin/communication/features/certificates", { pass_mark: 150 })).status, 400);
  // العزل
  assert.equal((await B.admin.post("/api/admin/certificates/print", { ids: [c.data.id] })).data.length, 0);
  assert.equal((await B.admin.post(`/api/admin/certificates/${c.data.id}/revoke`, { reason: "عبث" })).status, 404);
  assert.equal((await B.admin.post("/api/admin/certificates/custom", { student_id: s3.id, title: "x شهادة", body: "نص تجريبي" })).status, 404);
  // الإيقاف
  await A.admin.put("/api/admin/settings/modules", { certificates: false });
  assert.equal((await A.admin.get("/api/admin/certificates")).status, 404);
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s3))).data.features.certificates, undefined);
  await A.admin.put("/api/admin/settings/modules", { certificates: true });
});
