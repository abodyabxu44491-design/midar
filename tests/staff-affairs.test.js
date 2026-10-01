// شؤون الموظفين: الحضور والحضور الذاتي، الإجازات وخصم الراتب، حصص الانتظار، تحضير الدروس، التقويم
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool, uid } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B, t2, t2c, staffT1, staffT2;
const day = (n = 0) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });
// يوم دراسي سابق (الأحد إلى الخميس)
const lastSchoolDay = () => { for (let i = 1; i < 8; i++) { const d = day(-i); if (new Date(`${d}T00:00:00Z`).getUTCDay() <= 4) return d; } };

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "sa", students: 1 });
  B = await readySchool(srv.base, { prefix: "sb", students: 1 });
  const r = await A.admin.post("/api/admin/teachers", { name: "أ. ناصر يحيى", username: `t2${uid()}`.slice(0, 18), load: [{ class_id: A.c2.id, subject_id: A.math.id }] });
  t2 = r.data;
  t2c = client(srv.base);
  await t2c.post("/api/staff/login", { school: A.id, username: r.data.credentials.username, password: r.data.credentials.password });
  await transaction({ tenantId: A.id }, (q) => q("UPDATE users SET must_change_password = false"));
  const st = await transaction({ tenantId: A.id }, (q) => q("SELECT id, teacher_id FROM staff ORDER BY id"));
  staffT1 = st.find((s) => Number(s.teacher_id) === Number(A.teacherId)).id;
  staffT2 = st.find((s) => Number(s.teacher_id) === Number(t2.id)).id;
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("حضور الموظفين: لوحة اليوم، التسجيل، والمستقبل مرفوض، والتقرير", async () => {
  const b = (await A.admin.get("/api/admin/staff-affairs/attendance")).data;
  assert.ok(b.staff.length >= 2);
  const d = lastSchoolDay();
  assert.equal((await A.admin.post("/api/admin/staff-affairs/attendance", { day: d, entries: [{ staff_id: staffT1, status: "absent" }, { staff_id: staffT2, status: "late", check_in: "07:40" }] })).status, 200);
  const after = (await A.admin.get(`/api/admin/staff-affairs/attendance?day=${d}`)).data.staff;
  assert.equal(after.find((s) => s.staff_id === staffT2).late_min, 40);
  assert.equal((await A.admin.post("/api/admin/staff-affairs/attendance", { day: day(3), entries: [{ staff_id: staffT1, status: "present" }] })).status, 400);
  const rep = (await A.admin.get(`/api/admin/staff-affairs/attendance/report?from=${d}&to=${d}`)).data;
  assert.equal(rep.find((x) => x.staff_id === staffT1).absent, 1);
});

test("المعلم يسجل حضوره وانصرافه مرة واحدة، والإدارة توقف ذلك", async () => {
  const i = await A.teacher.post("/api/teacher/me-staff/check-in", {});
  assert.equal(i.status, 200, JSON.stringify(i.data));
  assert.ok(["present", "late"].includes(i.data.status));
  assert.equal((await A.teacher.post("/api/teacher/me-staff/check-in", {})).status, 409);
  assert.equal((await A.teacher.post("/api/teacher/me-staff/check-out", {})).status, 200);
  const me = (await A.teacher.get("/api/teacher/me-staff")).data;
  assert.ok(me.today.check_in && me.today.check_out);
  await A.admin.put("/api/admin/communication/features/staff", { self_checkin: false });
  assert.equal((await t2c.post("/api/teacher/me-staff/check-in", {})).status, 403);
  await A.admin.put("/api/admin/communication/features/staff", { self_checkin: true });
});

test("الإجازات: طلب المعلم، التداخل مرفوض، الاعتماد يسجل أيام الإجازة ويُشعر المعلم، والإلغاء", async () => {
  const from = day(10), to = day(14);
  const r = await t2c.post("/api/teacher/me-staff/leaves", { kind: "sick", from_day: from, to_day: to, reason: "عملية" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await t2c.post("/api/teacher/me-staff/leaves", { kind: "annual", from_day: day(12), to_day: day(13) })).status, 409);
  const pending = (await A.admin.get("/api/admin/staff-affairs/attendance/leaves?status=pending")).data;
  assert.ok(pending.some((l) => l.id === r.data.id));
  assert.equal((await A.admin.post(`/api/admin/staff-affairs/attendance/leaves/${r.data.id}/decide`, { approve: true })).status, 200);
  assert.equal((await A.admin.post(`/api/admin/staff-affairs/attendance/leaves/${r.data.id}/decide`, { approve: false })).status, 409);
  const days = await transaction({ tenantId: A.id }, (q) => q("SELECT count(*)::int AS n FROM staff_attendance WHERE staff_id = $1 AND status = 'leave'", [staffT2]));
  assert.ok(days[0].n >= 2 && days[0].n <= 5, "أيام الدراسة فقط");
  const inbox = (await t2c.get("/api/teacher/notifications")).data;
  assert.ok(inbox.items.some((n) => n.kind === "leave" && /اعتُمدت/.test(n.title)));
  const c = await t2c.post("/api/teacher/me-staff/leaves", { kind: "emergency", from_day: day(20), to_day: day(20) });
  assert.equal((await t2c.post(`/api/teacher/me-staff/leaves/${c.data.id}/cancel`, {})).status, 200);
  assert.equal((await A.teacher.post(`/api/teacher/me-staff/leaves/${r.data.id}/cancel`, {})).status, 404, "لا يلغي طلب غيره");
});

test("الرواتب: الغياب والإجازة بدون راتب تُخصم تلقائيًا عند إنشاء المسير", async () => {
  await A.admin.patch(`/api/admin/ledger/staff/${staffT1}/salary`, { base_salary: 26000, allowance: 0 });
  const r = await A.admin.post("/api/admin/ledger/payroll", { period: lastSchoolDay() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const items = (await A.admin.get(`/api/admin/ledger/payroll/${r.data.id}/items`)).data;
  const it = (items.items || items).find((x) => Number(x.staff_id) === Number(staffT1));
  assert.equal(Number(it.deductions), 1000, "يوم غياب = 26000 ÷ 26");
  assert.match(it.note, /غياب 1 يوم/);
});

test("حصص الانتظار: حصص الغائب، والمقترحون الفارغون، ومنع التعارض، وإشعار البديل", async () => {
  // حصة للمعلم الأول يوم الأحد الحصة 1، وللثاني الحصة 2
  await A.admin.put("/api/admin/timetable/slot", { class_id: A.c1.id, day: 0, period: 1, subject_id: A.math.id, teacher_id: A.teacherId });
  await A.admin.put("/api/admin/timetable/slot", { class_id: A.c2.id, day: 0, period: 2, subject_id: A.math.id, teacher_id: t2.id });
  let sunday = day(1); for (let i = 1; i < 8; i++) { sunday = day(i); if (new Date(`${sunday}T00:00:00Z`).getUTCDay() === 0) break; }
  await A.admin.post("/api/admin/staff-affairs/attendance/leaves", { staff_id: staffT1, kind: "official", from_day: sunday, to_day: sunday });
  const n = (await A.admin.get(`/api/admin/staff-affairs/substitutes?day=${sunday}`)).data;
  assert.equal(n.absent.length, 1);
  const slot = n.slots[0];
  assert.equal(slot.period, 1);
  assert.ok(slot.candidates.some((c) => c.id === t2.id), "المعلم الثاني فارغ في الحصة الأولى");
  assert.equal((await A.admin.post("/api/admin/staff-affairs/substitutes", { day: sunday, slot_id: slot.slot_id, substitute_teacher_id: t2.id })).status, 200);
  const mine = (await t2c.get("/api/teacher/me-staff")).data.substitutions;
  assert.ok(mine.some((x) => x.period === 1));
  assert.ok((await t2c.get("/api/teacher/notifications")).data.items.some((x) => x.kind === "substitute"));
  // البديل لا يُعيَّن لحصة يدرّس فيها
  const slot2 = (await transaction({ tenantId: A.id }, (q) => q("SELECT id FROM timetable_slots WHERE period = 2 AND day = 0")))[0];
  await A.admin.post("/api/admin/staff-affairs/attendance/leaves", { staff_id: staffT2, kind: "official", from_day: sunday, to_day: sunday }).catch(() => {});
  assert.equal((await A.admin.post("/api/admin/staff-affairs/substitutes", { day: sunday, slot_id: slot2.id, substitute_teacher_id: t2.id })).status, 400, "معلم الحصة نفسه");
});

test("تحضير الدروس: المعلم يكتب ويرسل لمادته فقط، والمدير يعيد ثم يعتمد، والمعتمد لا يُعدّل", async () => {
  const week = day(0);
  const body = { class_id: A.c1.id, subject_id: A.math.id, week_start: week, topic: "جمع الأعداد", objectives: "أن يجمع الطالب عددين", submit: true };
  assert.equal((await A.teacher.post("/api/teacher/lesson-plans", { ...body, class_id: (await A.admin.get("/api/admin/structure/classes")).data.find((c) => c.name === "الثاني - أ").id })).status, 403);
  const r = await A.teacher.post("/api/teacher/lesson-plans", body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await A.teacher.post("/api/teacher/lesson-plans", body)).status, 409, "تحضير واحد للأسبوع");
  const cov = (await A.admin.get(`/api/admin/staff-affairs/lesson-plans/coverage?week=${week}`)).data;
  assert.ok(cov.rows.some((x) => x.plan_id === r.data.id && x.status === "submitted"));
  assert.ok(cov.rows.some((x) => !x.plan_id), "الشعبة الثانية لم تُحضّر");
  assert.equal((await A.admin.post(`/api/admin/staff-affairs/lesson-plans/${r.data.id}/review`, { approve: false })).status, 400, "الإعادة تحتاج ملاحظة");
  await A.admin.post(`/api/admin/staff-affairs/lesson-plans/${r.data.id}/review`, { approve: false, note: "أضف نشاطًا جماعيًا" });
  assert.equal((await A.teacher.get("/api/teacher/lesson-plans")).data[0].status, "returned");
  assert.equal((await A.teacher.put(`/api/teacher/lesson-plans/${r.data.id}`, { ...body, activities: "عمل في مجموعات" })).status, 200);
  await A.admin.post(`/api/admin/staff-affairs/lesson-plans/${r.data.id}/review`, { approve: true });
  assert.equal((await A.teacher.put(`/api/teacher/lesson-plans/${r.data.id}`, body)).status, 409);
  assert.equal((await t2c.put(`/api/teacher/lesson-plans/${r.data.id}`, { ...body, class_id: A.c2.id })).status, 404, "لا يعدّل تحضير غيره");
});

test("التقويم: الفعاليات مع الإجازات والاختبارات، وما يراه ولي الأمر حسب الجمهور والشعبة", async () => {
  const from = day(0), to = day(30);
  await A.admin.post("/api/admin/calendar", { title: "يوم مفتوح لأولياء الأمور", kind: "meeting", starts_on: day(5), audience: "parents", notify: true });
  await A.admin.post("/api/admin/calendar", { title: "اجتماع المعلمين", kind: "meeting", starts_on: day(6), audience: "staff" });
  await A.admin.post("/api/admin/calendar", { title: "رحلة الصف الثاني", kind: "trip", starts_on: day(7), audience: "all", class_id: A.c2.id });
  await A.admin.post("/api/admin/academic/holidays", { name: "إجازة قصيرة", start_date: day(8), end_date: day(9) }).catch(() => {});
  const all = (await A.admin.get(`/api/admin/calendar?from=${from}&to=${to}`)).data;
  assert.ok(all.length >= 3);
  const parent = (await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(A.students[0]))).data.features.calendar;
  assert.ok(parent.some((e) => e.title === "يوم مفتوح لأولياء الأمور"));
  assert.ok(!parent.some((e) => e.title === "اجتماع المعلمين"), "لا يرى فعاليات المنسوبين");
  assert.ok(!parent.some((e) => e.title === "رحلة الصف الثاني"), "لا يرى فعاليات شعبة أخرى");
  const teacher = (await A.teacher.get(`/api/teacher/calendar?from=${from}&to=${to}`)).data;
  assert.ok(teacher.some((e) => e.title === "اجتماع المعلمين") && !teacher.some((e) => e.title === "يوم مفتوح لأولياء الأمور"));
  assert.ok((await client(srv.base).post(`/api/public/${A.id}/student/inbox`, A.parent(A.students[0]))).data.items.some((n) => n.kind === "calendar"));
});

test("العزل والإيقاف", async () => {
  assert.equal((await B.admin.post(`/api/admin/staff-affairs/attendance`, { day: lastSchoolDay(), entries: [{ staff_id: staffT1, status: "absent" }] })).status, 404);
  assert.equal((await B.admin.get(`/api/admin/staff-affairs/lesson-plans`)).data.length, 0);
  assert.equal((await B.admin.get(`/api/admin/calendar?from=${day(0)}&to=${day(30)}`)).data.filter((e) => e.type === "event").length, 0);
  await A.admin.put("/api/admin/settings/modules", { staff_attendance: false, lesson_plans: false, calendar: false, substitutes: false });
  assert.equal((await A.admin.get("/api/admin/staff-affairs/attendance")).status, 404);
  assert.equal((await A.teacher.get("/api/teacher/me-staff")).status, 404);
  assert.equal((await A.teacher.get("/api/teacher/lesson-plans")).status, 404);
  assert.equal((await A.admin.get("/api/admin/staff-affairs/substitutes")).status, 404);
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student`, A.parent(A.students[0]))).data.features.calendar, undefined);
  await A.admin.put("/api/admin/settings/modules", { staff_attendance: true, lesson_plans: true, calendar: true, substitutes: true });
});
