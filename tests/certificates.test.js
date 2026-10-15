/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool, uid } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B, issued, exam;
const key = () => ({ class_id: A.c1.id, scope: "term" });
const results = (c = A.admin) => c.get(`/api/admin/certificates/results?class_id=${A.c1.id}&scope=term`);

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "ce", students: 3 });
  B = await readySchool(srv.base, { prefix: "cb", students: 1 });
  const e = await A.teacher.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "النهائي", max_score: 20 });
  exam = e.data.id;
  const [s1, s2] = A.students;
  await A.teacher.put(`/api/teacher/exams/${exam}/scores`, { scores: { [s1.id]: 18, [s2.id]: 6 } });
  assert.equal((await A.teacher.post(`/api/teacher/exams/${exam}/submit`, {})).data.status, "published", "المعلم يعتمد وتُنشر مباشرة");
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
  assert.equal(p.data.status, "none", "لم تُعدّ النتائج بعد");
});

test("لا إصدار قبل الاعتماد، والفحص يحدد الطالب والمادة والسبب", async () => {
  assert.equal((await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term" })).status, 409, "لا شهادات بلا نتائج معتمدة");
  const r = (await results()).data;
  assert.equal(r.status, "none");
  const missing = r.errors.find((e) => e.student === A.students[2].name);
  assert.equal(missing.subject, "الرياضيات");
  assert.match(missing.reason, /لا توجد درجة في «النهائي»/);
  assert.ok(r.errors.some((e) => e.subject && e.subject !== "الرياضيات" && /لا توجد درجات منشورة/.test(e.reason)), "مادة بلا درجات منشورة");
  assert.ok(r.warnings.some((w) => /رقم تعريفي/.test(w.reason)));
  assert.equal(r.can_approve, true);
});

test("دورة الاعتماد: إرسال ← إعادة بسبب ← إرسال ← اعتماد (يرفض الناقص بلا سبب) ← إصدار برقم تسلسلي", async () => {
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", key())).status, 409, "الاعتماد بعد الإرسال للمراجعة");
  assert.equal((await A.admin.post("/api/admin/certificates/results/submit", key())).status, 200);
  assert.equal((await A.admin.post("/api/admin/certificates/results/return", { ...key(), reason: "" })).status, 400, "سبب الإعادة مطلوب");
  assert.equal((await A.admin.post("/api/admin/certificates/results/return", { ...key(), reason: "راجع درجة الطالب الثالث" })).status, 200);
  assert.equal((await results()).data.status, "returned");
  assert.equal((await results()).data.batch.return_reason, "راجع درجة الطالب الثالث");
  assert.equal((await A.admin.post("/api/admin/certificates/results/submit", key())).status, 200);
  const bad = await A.admin.post("/api/admin/certificates/results/approve", key());
  assert.equal(bad.status, 400, "نتائج ناقصة لا تُعتمد إلا باستثناء");
  assert.ok(bad.data.details?.errors?.length || bad.data.errors?.length || /ملاحظة/.test(bad.data.error));
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", { ...key(), allow_incomplete: true })).status, 400, "الاستثناء يحتاج سببًا");
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", { ...key(), allow_incomplete: true, reason: "المواد الأخرى تُرصد لاحقًا" })).status, 200);
  const r = (await results()).data;
  assert.equal(r.status, "approved");
  assert.equal(r.ready, true);
  assert.deepEqual(r.events.map((e) => e.action), ["created", "submitted", "returned", "submitted", "approved"]);
  assert.ok(r.events.every((e) => e.actor), "كل خطوة باسم من نفذها");

  const out = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term" });
  assert.equal(out.status, 201, JSON.stringify(out.data));
  assert.equal(out.data.issued, 2, "الطالب بلا درجات لا تصدر له شهادة");
  const list = (await A.admin.get(`/api/admin/certificates?class_id=${A.c1.id}`)).data;
  issued = list.find((c) => c.student_id === A.students[0].id);
  assert.match(issued.code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.match(issued.serial, /^\d{4}-\d{6}$/);
  assert.equal(issued.status, "issued");
  const serials = list.map((c) => c.serial);
  assert.equal(new Set(serials).size, serials.length, "لا تكرار في الأرقام");
  assert.equal((await results()).data.certificates_issued, 2);
});

test("التحقق العام: الحالة والرقم بلا بيانات خاصة، والطباعة تحمل الرقم والاعتماد الداخلي", async () => {
  const v = await client(srv.base).get(`/api/public/verify/${issued.code}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.student, A.students[0].name);
  assert.equal(v.data.status, "issued");
  assert.equal(v.data.serial, issued.serial);
  assert.equal(v.data.result, "ناجح");
  assert.equal(Object.keys(v.data).sort().join(","), "class_name,issued_at,percent,replaced_on,result,revoked,school,serial,status,student,title", "التحقق لا يكشف بيانات أخرى");
  assert.equal((await client(srv.base).get("/api/public/verify/AAAAAAAAAA")).status, 404);
  assert.equal((await fetch(`${srv.base}/verify/${issued.code}`)).status, 200);
  const pr = await A.admin.post("/api/admin/certificates/print", { ids: [issued.id] });
  assert.ok(pr.data[0].verify_url.endsWith(`/verify/${issued.code}`));
  assert.match(pr.data[0].qr, /^data:image\/svg\+xml;base64,/);
  assert.equal(pr.data[0].serial, issued.serial);
  assert.ok(pr.data[0].data.approval.by && pr.data[0].data.approval.at, "بيانات الاعتماد الداخلي محفوظة في الشهادة");
  const h = (await A.admin.get(`/api/admin/certificates/${issued.id}/history`)).data;
  assert.deepEqual(h.map((x) => x.action), ["issued", "printed"]);
});

test("الشهادة الصادرة لا تُعدَّل ولا تُحذف حتى من قاعدة البيانات", async () => {
  await assert.rejects(transaction({ tenantId: A.id }, (q) => q("UPDATE certificates SET title = 'معدلة' WHERE id = $1", [issued.id])), /لا يمكن تعديل شهادة صادرة/);
  await assert.rejects(transaction({ tenantId: A.id }, (q) => q("DELETE FROM certificates WHERE id = $1", [issued.id])), /permission denied/);
  await assert.rejects(transaction({ tenantId: A.id }, (q) => q("UPDATE certificate_events SET actor = 'x'")), /permission denied/);
});

test("تعديل درجة بعد الاعتماد يعيد النتائج للمراجعة ويمنع الإصدار حتى يُعاد الاعتماد", async () => {
  // The teacher corrects a published grade directly; the approved results go back to review.
  assert.equal((await A.teacher.put(`/api/teacher/exams/${exam}/scores`, { scores: { [A.students[0].id]: 19 } })).status, 200);
  const r = (await results()).data;
  assert.equal(r.status, "review");
  assert.equal(r.events.at(-1).action, "changed");
  assert.equal((await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term" })).status, 409);
  assert.equal((await client(srv.base).get(`/api/public/verify/${issued.code}`)).data.status, "issued", "الشهادات الصادرة تبقى كما هي");
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", { ...key(), allow_incomplete: true, reason: "اعتماد بعد التصحيح" })).status, 200);
  assert.equal((await results()).data.ready, true);
});

test("إلغاء وإصدار بديلة: القديمة «مستبدلة» ومربوطة بالجديدة، والإلغاء اليدوي يظهر في التحقق", async () => {
  const rep = await A.admin.post(`/api/admin/certificates/${issued.id}/replace`, { reason: "تصحيح الدرجة" });
  assert.equal(rep.status, 201, JSON.stringify(rep.data));
  const old = (await client(srv.base).get(`/api/public/verify/${issued.code}`)).data;
  assert.equal(old.status, "replaced");
  assert.equal(old.revoked, true);
  assert.ok(old.replaced_on);
  const list = (await A.admin.get(`/api/admin/certificates?student_id=${A.students[0].id}`)).data;
  const fresh = list.find((c) => c.status === "issued");
  const prev = list.find((c) => c.id === issued.id);
  assert.equal(prev.replaced_by, fresh.id);
  assert.equal(prev.replaced_by_serial, fresh.serial);
  assert.equal(prev.revoke_reason, "تصحيح الدرجة");
  assert.notEqual(fresh.serial, issued.serial);
  assert.equal((await A.admin.post(`/api/admin/certificates/${issued.id}/revoke`, { reason: "مرة ثانية" })).status, 404, "المستبدلة لا تُلغى");
  assert.equal((await A.admin.post(`/api/admin/certificates/${fresh.id}/revoke`, { reason: "خطأ في الاسم" })).status, 200);
  const v = (await client(srv.base).get(`/api/public/verify/${fresh.code}`)).data;
  assert.equal(v.status, "revoked");
  assert.deepEqual((await A.admin.get(`/api/admin/certificates/${fresh.id}/history`)).data.map((x) => x.action), ["issued", "revoked"]);
});

test("الصلاحيات: إداري المدرسة يُعدّ ويرسل، ولا يعتمد ولا يُصدر ولا يلغي", async () => {
  const username = `dep-${uid()}`.slice(0, 20).toLowerCase();
  const pw = (await A.admin.post("/api/admin/users/admins", { name: "وكيل شؤون الطلاب", username, admin_scope: "school" })).data.credentials.password;
  const d = client(srv.base);
  assert.equal((await d.post("/api/staff/login", { school: A.id, username, password: pw })).status, 200);
  await transaction({ tenantId: A.id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = $1", [username]));
  assert.equal((await results(d)).data.can_approve, false);
  assert.equal((await d.post("/api/admin/certificates/results/reopen", { ...key(), reason: "تجربة" })).status, 403);
  assert.equal((await d.post("/api/admin/certificates/results/approve", { ...key(), allow_incomplete: true, reason: "تجربة" })).status, 403);
  assert.equal((await d.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term" })).status, 403);
  assert.equal((await d.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term", dry_run: true })).status, 200, "المعاينة مسموحة");
  assert.equal((await d.post("/api/admin/certificates/custom", { student_id: A.students[2].id, title: "شهادة تقدير", body: "للتميز" })).status, 403);
  const any = (await A.admin.get("/api/admin/certificates")).data.find((c) => c.status === "issued");
  assert.equal((await d.post(`/api/admin/certificates/${any.id}/revoke`, { reason: "عبث" })).status, 403);
});

test("ولي الأمر: يرى شهادات ابنه السارية ويطبعها، ولا يطبع شهادة طالب آخر", async () => {
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

test("شهادة مخصصة واستبدالها، والإعدادات (حد النجاح والموقّع)، والإيقاف، والعزل", async () => {
  const [, , s3] = A.students;
  const c = await A.admin.post("/api/admin/certificates/custom", { student_id: s3.id, title: "شهادة تقدير", body: "لتفوقه في مسابقة القرآن الكريم" });
  assert.equal(c.status, 201);
  assert.match(c.data.serial, /^\d{4}-\d{6}$/);
  const pr = (await A.admin.post("/api/admin/certificates/print", { ids: [c.data.id] })).data[0];
  assert.equal(pr.data.body, "لتفوقه في مسابقة القرآن الكريم");
  const rep = await A.admin.post(`/api/admin/certificates/${c.data.id}/replace`, { reason: "تصحيح النص", body: "لتفوقه في مسابقة حفظ القرآن الكريم" });
  assert.equal(rep.status, 201);
  assert.equal((await A.admin.post("/api/admin/certificates/print", { ids: rep.data.ids })).data[0].data.body, "لتفوقه في مسابقة حفظ القرآن الكريم");
  await A.admin.put("/api/admin/communication/features/certificates", { pass_mark: 25, signer_name: "أ. عبدالله سالم" });
  const p = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term", dry_run: true });
  assert.equal(p.data.students.find((x) => x.id === A.students[1].id).result, "ناجح", "6/20 = 30% ناجح بحد 25");
  assert.equal((await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "term" })).status, 409, "تغيّر حد النجاح يغيّر النتائج المعتمدة فتعود للمراجعة");
  assert.equal((await results()).data.status, "review");
  assert.equal((await A.admin.put("/api/admin/communication/features/certificates", { pass_mark: 150 })).status, 400);
  assert.equal((await B.admin.post("/api/admin/certificates/print", { ids: [c.data.id] })).data.length, 0);
  assert.equal((await B.admin.post(`/api/admin/certificates/${c.data.id}/revoke`, { reason: "عبث" })).status, 404);
  assert.equal((await B.admin.post("/api/admin/certificates/custom", { student_id: s3.id, title: "x شهادة", body: "نص تجريبي" })).status, 404);
  assert.equal((await B.admin.get(`/api/admin/certificates/results?class_id=${A.c1.id}&scope=term`)).status, 404, "لا اطلاع على نتائج مدرسة أخرى");
  await A.admin.put("/api/admin/settings/modules", { certificates: false });
  assert.equal((await A.admin.get("/api/admin/certificates")).status, 404);
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s3))).data.features.certificates, undefined);
  await A.admin.put("/api/admin/settings/modules", { certificates: true });
});

test("نتائج العام الدراسي منفصلة عن الفصل، والاعتماد يتم مرة لكل نطاق", async () => {
  const k = { class_id: A.c1.id, scope: "year" };
  assert.equal((await A.admin.post("/api/admin/certificates/results/submit", k)).status, 200);
  assert.equal((await A.admin.post("/api/admin/certificates/results/approve", { ...k, allow_incomplete: true, reason: "نهاية العام" })).status, 200);
  const y = await A.admin.post("/api/admin/certificates/issue", { class_id: A.c1.id, kind: "year" });
  assert.equal(y.status, 201, JSON.stringify(y.data));
  assert.equal((await results()).data.status, "review", "نتيجة الفصل لم تتأثر باعتماد العام");
});
