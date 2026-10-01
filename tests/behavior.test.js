// السلوك والانضباط: البنود، والتسجيل الجماعي، والدرجة، وصلاحيات المعلم، وما يراه ولي الأمر، والإيقاف، والعزل
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, A, B, other;
const profile = (S, s) => client(srv.base).post(`/api/public/${S.id}/student`, S.parent(s));

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "bh", students: 3 });
  B = await readySchool(srv.base, { prefix: "bb", students: 1 });
  // طالب في شعبة لا يدرّسها المعلم
  const classes = (await A.admin.get("/api/admin/structure/classes")).data;
  const c3 = classes.find((c) => c.name === "الثاني - أ");
  other = (await A.admin.post("/api/admin/students", { name: "طالب من الثاني", class_id: c3.id })).data;
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("بنود افتتاحية جاهزة، وتسجيل إنجاز لطالبين معًا يرفع درجتيهما ويصل لولي الأمر", async () => {
  const cats = (await A.admin.get("/api/admin/behavior/categories")).data;
  assert.ok(cats.length >= 10);
  const plus = cats.find((c) => c.name === "مشاركة متميزة");
  const [s1, s2] = A.students;
  const r = await A.admin.post("/api/admin/behavior", { student_ids: [s1.id, s2.id], category_id: plus.id, note: "حل المسألة أمام الفصل" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.created, 2);
  const p = (await profile(A, s1)).data;
  assert.equal(p.features.behavior.score, 100 + plus.points);
  assert.equal(p.features.behavior.records[0].note, "حل المسألة أمام الفصل");
  const inbox = (await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s1))).data;
  assert.ok(inbox.items.some((n) => n.kind === "behavior" && /إنجاز/.test(n.title)));
  const sum = (await A.admin.get(`/api/admin/behavior/summary?class_id=${A.c1.id}`)).data;
  assert.equal(sum.students.find((x) => x.id === s1.id).score, 105);
});

test("المعلم: يسجّل لطلاب فصوله فقط، ويحذف ما سجله هو فقط", async () => {
  const cats = (await A.teacher.get("/api/teacher/behavior/categories")).data;
  const minus = cats.find((c) => c.name === "عدم أداء الواجب");
  const [, , s3] = A.students;
  const ok = await A.teacher.post("/api/teacher/behavior", { student_ids: [s3.id], category_id: minus.id });
  assert.equal(ok.status, 201);
  assert.equal((await A.teacher.post("/api/teacher/behavior", { student_ids: [other.id], category_id: minus.id })).status, 403);
  assert.equal((await A.teacher.get(`/api/teacher/behavior/student/${other.id}`)).status, 403);
  // سجل الإدارة لا يحذفه المعلم
  const adminRec = (await A.admin.get("/api/admin/behavior")).data.find((x) => x.recorded_by.includes("إدارة"));
  assert.equal((await A.teacher.del(`/api/teacher/behavior/${adminRec.id}`)).status, 403);
  assert.equal((await A.teacher.del(`/api/teacher/behavior/${ok.data.ids[0]}`)).status, 200);
  // المعلم لا يعدّل البنود
  assert.equal((await A.teacher.post("/api/teacher/behavior/categories", { name: "بند", kind: "positive", points: 2 })).status, 404);
  // الإدارة توقف تسجيل المعلم
  await A.admin.put("/api/admin/communication/features/behavior", { teacher_can_record: false });
  assert.equal((await A.teacher.post("/api/teacher/behavior", { student_ids: [s3.id], category_id: minus.id })).status, 403);
  await A.admin.put("/api/admin/communication/features/behavior", { teacher_can_record: true });
});

test("بند مستخدم لا يُحذف بل يُوقف، وبند جديد بنقاط مخصصة، والتاريخ المستقبلي مرفوض", async () => {
  const cats = (await A.admin.get("/api/admin/behavior/categories")).data;
  const used = cats.find((c) => c.name === "مشاركة متميزة");
  assert.deepEqual((await A.admin.del(`/api/admin/behavior/categories/${used.id}`)).data, { deactivated: true });
  const add = await A.admin.post("/api/admin/behavior/categories", { name: "قيادة الطابور الصباحي", kind: "positive", points: 7 });
  assert.equal(add.status, 201);
  assert.equal((await A.admin.post("/api/admin/behavior/categories", { name: "قيادة الطابور الصباحي", kind: "positive", points: 7 })).status, 409);
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  assert.equal((await A.admin.post("/api/admin/behavior", { student_ids: [A.students[0].id], category_id: add.data.id, day: future })).status, 400);
  // بند غير مسجل بكتابة يدوية
  const manual = await A.admin.post("/api/admin/behavior", { student_ids: [A.students[0].id], kind: "negative", points: 4, title: "تأخر عن الحصة" });
  assert.equal(manual.status, 201);
});

test("الدرجة الأساسية من الإعدادات، وإخفاء السلوك عن ولي الأمر، وإيقاف القسم", async () => {
  const [s1] = A.students;
  await A.admin.put("/api/admin/communication/features/behavior", { base_score: 50 });
  const p = (await profile(A, s1)).data;
  assert.equal(p.features.behavior.base_score, 50);
  await A.admin.put("/api/admin/communication/features/behavior", { show_parent: false, base_score: 100 });
  assert.equal((await profile(A, s1)).data.features.behavior, undefined, "مخفي عن ولي الأمر");
  const adminView = (await A.admin.get(`/api/admin/students/${s1.id}/profile`)).data;
  assert.ok(adminView.features.behavior, "الإدارة تراه دائمًا");
  await A.admin.put("/api/admin/communication/features/behavior", { show_parent: true });
  await A.admin.put("/api/admin/settings/modules", { behavior: false });
  assert.equal((await A.admin.get("/api/admin/behavior/categories")).status, 404);
  assert.equal((await A.teacher.get("/api/teacher/behavior/categories")).status, 404);
  assert.equal((await profile(A, s1)).data.features.behavior, undefined);
  await A.admin.put("/api/admin/settings/modules", { behavior: true });
});

test("العزل: مدرسة لا ترى سلوك أخرى ولا تحذفه ولا تسجّل لطلابها", async () => {
  const rec = (await A.admin.get("/api/admin/behavior")).data[0];
  assert.equal((await B.admin.del(`/api/admin/behavior/${rec.id}`)).status, 404);
  assert.equal((await B.admin.get("/api/admin/behavior")).data.length, 0);
  const bCats = (await B.admin.get("/api/admin/behavior/categories")).data;
  assert.equal((await B.admin.post("/api/admin/behavior", { student_ids: [A.students[0].id], category_id: bCats[0].id })).status, 404);
  const aCats = (await A.admin.get("/api/admin/behavior/categories")).data;
  assert.equal((await B.admin.post("/api/admin/behavior", { student_ids: [B.students[0].id], category_id: aCats[1].id })).status, 404);
});
