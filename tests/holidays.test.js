/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool, client } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, A, B, day;
// A recent school day (Sunday to Wednesday), so attendance can be recorded on it before the holiday.
function schoolDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (![0, 1, 2, 3].includes(d.getDay())) d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}
const H = "/api/admin/academic/holidays";
before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "hl", students: 3 });
  B = await readySchool(srv.base, { prefix: "hm", students: 1 });
  day = schoolDay();
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

const rows = async (S) => (await S.admin.get(`/api/admin/attendance?class_id=${S.c1.id}&date=${day}`)).data;
const statusOf = (list, id) => (Array.isArray(list) ? list : list.students || list.rows || []).find((r) => Number(r.id ?? r.student_id) === Number(id))?.status ?? null;

test("إجازة مفاجئة بعد تسجيل الحضور: لا يُحسب حضور ولا غياب، ويُمنع التسجيل، ويصل إشعار", async () => {
  const [s1, s2, s3] = A.students;
  const rec = await A.admin.post("/api/admin/attendance", { date: day, entries: [
    { student_id: s1.id, status: "present" }, { student_id: s2.id, status: "absent" }, { student_id: s3.id, status: "late" }] });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  assert.equal((await B.admin.post("/api/admin/attendance", { date: day, entries: [{ student_id: B.students[0].id, status: "absent" }] })).status, 200);
  const impact = (await A.admin.get(`${H}/impact?from=${day}&to=${day}`)).data;
  assert.deepEqual([impact.records, impact.days, impact.absent], [3, 1, 1]);

  const r = await A.admin.post(H, { name: "تعليق الدراسة لظروف جوية", kind: "emergency", start_date: day, end_date: day, notes: "أمطار غزيرة", notify: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  A.holiday = r.data.id;
  assert.equal(r.data.set_aside, 3);
  const after = await rows(A);
  for (const s of A.students) assert.equal(statusOf(after, s.id), null, "اليوم إجازة: لا حاضر ولا غائب");
  assert.equal(statusOf(await rows(B), B.students[0].id), "absent", "مدرسة أخرى لم تتأثر");

  const mark = await A.teacher.post("/api/teacher/attendance", { date: day, entries: [{ student_id: s1.id, status: "present" }] });
  assert.equal(mark.status, 400);
  assert.match(mark.data.error, /إجازة/);
  const parent = (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(s2))).data;
  assert.ok(!(parent.attendance || []).some((a) => a.day === day), "لا يظهر غياب ذلك اليوم لولي الأمر");
  const inbox = await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(s2));
  assert.ok(JSON.stringify(inbox.data).includes("تعليق الدراسة لظروف جوية"), "وصل إشعار الإجازة لولي الأمر");
  const staff = (await A.teacher.get("/api/teacher/notifications")).data;
  assert.ok(JSON.stringify(staff).includes("تعليق الدراسة لظروف جوية"), "ووصل للمعلم");
});

test("تقصير الإجازة أو حذفها يعيد سجلات الحضور كما كانت", async () => {
  const [s1, s2, s3] = A.students;
  const next = new Date(`${day}T12:00:00`); next.setDate(next.getDate() + 1);
  const moved = await A.admin.put(`${H}/${A.holiday}`, { name: "تعليق الدراسة", kind: "emergency", start_date: next.toLocaleDateString("en-CA"), end_date: next.toLocaleDateString("en-CA") });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.restored, 3);
  const back = await rows(A);
  assert.deepEqual([statusOf(back, s1.id), statusOf(back, s2.id), statusOf(back, s3.id)], ["present", "absent", "late"]);
  // Back on the day, then deleted: the records return again.
  assert.equal((await A.admin.put(`${H}/${A.holiday}`, { name: "تعليق الدراسة", kind: "emergency", start_date: day, end_date: day })).data.set_aside, 3);
  const del = await A.admin.del(`${H}/${A.holiday}`);
  assert.equal(del.data.restored, 3);
  assert.equal(statusOf(await rows(A), s2.id), "absent");
  // A holiday that does not affect attendance (shown in the calendar only) leaves the records alone.
  const show = await A.admin.post(H, { name: "مناسبة", kind: "school", start_date: day, end_date: day, affects_attendance: false });
  assert.equal(show.data.set_aside, 0);
  assert.equal(statusOf(await rows(A), s1.id), "present");
  await A.admin.del(`${H}/${show.data.id}`);
});

test("الصلاحيات: المعلم وولي الأمر لا يعلنان إجازة، ولا أثر لمدرسة على أخرى", async () => {
  assert.ok([401, 403].includes((await A.teacher.post(H, { name: "إجازة", kind: "emergency", start_date: day, end_date: day })).status));
  assert.ok([401, 403].includes((await client(srv.base).post(H, { name: "إجازة", kind: "emergency", start_date: day, end_date: day })).status));
  const b = await B.admin.post(H, { name: "إجازة ب", kind: "emergency", start_date: day, end_date: day });
  assert.equal(b.data.set_aside, 1);
  assert.equal(statusOf(await rows(A), A.students[0].id), "present", "إجازة مدرسة ب لا تمس سجلات أ");
});
