/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool, client } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, A, B;
const day = new Date().toISOString().slice(0, 10);
const T = "/api/admin/communication/features/teachers";
before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "tc", students: 2 });
  B = await readySchool(srv.base, { prefix: "td", students: 1 });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("المعلم يعرف طريقة عمل مدرسته: اعتماد الدرجات ومن يسجل الحضور والأقسام", async () => {
  const me = (await A.teacher.get("/api/teacher/me")).data;
  assert.deepEqual(me.prefs, { teacher_publishes: true, attendance_by: "teacher", hidden: [] });
  assert.equal((await A.admin.put(T, { attendance_by: "office" })).status, 400);
  assert.equal((await A.admin.put(T, { hidden: ["home"] })).status, 400, "الرئيسية لا تُخفى");
});

test("حضور واحد: إذا كانت الإدارة أو البوابة تسجله، المعلم يطّلع فقط", async () => {
  const s = A.students[0];
  const mark = () => A.teacher.post("/api/teacher/attendance", { date: day, entries: [{ student_id: s.id, status: "present" }] });
  assert.equal((await mark()).status, 200);
  for (const by of ["admin", "gate"]) {
    assert.equal((await A.admin.put(T, { attendance_by: by })).status, 200);
    const r = await mark();
    assert.equal(r.status, 403);
    assert.match(r.data.error, by === "gate" ? /بوابة/ : /الإدارة/);
    assert.equal((await A.teacher.get(`/api/teacher/attendance?class_id=${A.c1.id}&date=${day}`)).status, 200, "يبقى الاطلاع متاحًا");
    assert.equal((await A.teacher.get("/api/teacher/me")).data.prefs.attendance_by, by);
  }
  { const ad = await A.admin.post("/api/admin/attendance", { date: day, reason: "تصحيح من الإدارة", entries: [{ student_id: s.id, status: "absent" }] }); assert.equal(ad.status, 200, JSON.stringify(ad.data)); }
  assert.equal((await B.teacher.post("/api/teacher/attendance", { date: day, entries: [{ student_id: B.students[0].id, status: "present" }] })).status, 200, "إعداد مدرسة لا يمس أخرى");
  await A.admin.put(T, { attendance_by: "teacher" });
  assert.equal((await A.teacher.post("/api/teacher/attendance", { date: day, entries: [{ student_id: A.students[1].id, status: "present" }] })).status, 200);
});

test("أقسام المعلم: قائمة للمدرسة كلها، وقائمة خاصة لمعلم بعينه، والعودة لقائمة المدرسة", async () => {
  assert.equal((await A.admin.put(T, { hidden: ["lessons", "surveys"] })).status, 200);
  assert.deepEqual((await A.teacher.get("/api/teacher/me")).data.prefs.hidden, ["lessons", "surveys"]);
  const url = `/api/admin/teachers/${A.teacherId}/sections`;
  const g = (await A.admin.get(url)).data;
  assert.equal(g.own, null);
  assert.deepEqual(g.school, ["lessons", "surveys"]);
  assert.ok(g.all.includes("exams") && !g.all.includes("home"));
  assert.equal((await A.admin.put(url, { hidden: ["papers", "behavior", "papers"] })).status, 200);
  assert.deepEqual((await A.teacher.get("/api/teacher/me")).data.prefs.hidden, ["papers", "behavior"], "قائمته الخاصة بدل قائمة المدرسة");
  assert.equal((await A.admin.put(url, { hidden: ["account"] })).status, 400);
  assert.equal((await B.admin.put(url, { hidden: [] })).status, 404, "لا تعديل لمعلم مدرسة أخرى");
  assert.equal((await A.admin.put(url, { hidden: null })).status, 200);
  assert.deepEqual((await A.teacher.get("/api/teacher/me")).data.prefs.hidden, ["lessons", "surveys"]);
  assert.ok([401, 403].includes((await A.teacher.put(url, { hidden: [] })).status), "المعلم لا يغيّر أقسامه بنفسه");
  await A.admin.put(T, { hidden: [] });
});

test("المعلم يعتمد فتُنشر لأولياء الأمور، ويصحح بعدها، والإدارة تراجع وتعدل", async () => {
  const [s1, s2] = A.students;
  const e = (await A.teacher.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "شهري", max_score: 10 })).data;
  await A.teacher.put(`/api/teacher/exams/${e.id}/scores`, { scores: { [s1.id]: 8, [s2.id]: 6 } });
  const pub = async () => (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s1))).data.grades;
  assert.equal((await pub()).length, 0, "لا تظهر قبل الاعتماد");
  assert.equal((await A.teacher.post(`/api/teacher/exams/${e.id}/submit`, {})).data.status, "published");
  assert.equal((await pub())[0].score, 8, "تظهر فور اعتماد المعلم");
  assert.equal((await A.teacher.put(`/api/teacher/exams/${e.id}/scores`, { scores: { [s1.id]: 9 } })).status, 200);
  assert.equal((await pub())[0].score, 9, "تصحيح المعلم يظهر مباشرة");
  assert.equal((await A.admin.put(`/api/admin/exams/${e.id}/scores`, { scores: { [s2.id]: 7 } })).status, 200);
  const sheet = (await A.admin.get(`/api/admin/exams/${e.id}/scores`)).data;
  assert.equal(sheet.find((r) => r.id === s2.id).score, 7);
  assert.equal((await A.teacher.put(`/api/admin/exams/${e.id}/scores`, { scores: { [s2.id]: 1 } })).status >= 401, true, "المعلم لا يستخدم مسار الإدارة");
  assert.equal((await B.teacher.put(`/api/teacher/exams/${e.id}/scores`, { scores: { [s2.id]: 1 } })).status >= 403, true);
});
