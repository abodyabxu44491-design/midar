// الحضور المربوط: سبب الغياب يظهر لولي الأمر، عذر ولي الأمر وقبوله، متابعة اليوم والتقارير،
// حد تنبيه الغياب، وتنبيهات الطالب من الإدارة والمعلم مع تأكيد اطلاع ولي الأمر
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";

let srv, admin, teacher, school, code;
const s = {};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA"); };

before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  const totp = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: totp })).status, 200);
  school = `af-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: school, name: "مدرسة المتابعة", max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  code = r.data.credentials.directory_code;
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school, username: "admin", password: r.data.credentials.password })).status, 200);
  s.cls = (await admin.post("/api/admin/structure/classes", { name: "الأول - أ" })).data.id;
  s.other = (await admin.post("/api/admin/structure/classes", { name: "الأول - ب" })).data.id;
  const sub = (await admin.post("/api/admin/structure/subjects", { name: "العلوم" })).data.id;
  const st = await admin.post("/api/admin/students", { name: "طالب المتابعة", class_id: s.cls, guardian_phone: "0500000009" });
  s.student = st.data.id ?? st.data[0]?.id; s.key = st.data.access_key ?? st.data[0]?.access_key;
  const st2 = await admin.post("/api/admin/students", { name: "طالب آخر", class_id: s.other });
  s.student2 = st2.data.id ?? st2.data[0]?.id;
  const t = await admin.post("/api/admin/teachers", { name: "أ. سعد", username: `saad${uid()}`.slice(0, 20), load: [{ class_id: s.cls, subject_id: sub }] });
  teacher = client(srv.base);
  assert.equal((await teacher.post("/api/staff/login", { school, username: t.data.credentials.username, password: t.data.credentials.password })).status, 200);
  assert.equal((await teacher.post("/api/teacher/password", { current: t.data.credentials.password, next: "Saad-Pass-2026x" })).status, 200);
});
after(async () => { await srv.close(); await endPool(); });

const parent = (path = "", body = {}) => client(srv.base).post(`/api/public/${school}/student${path}`, { access: code, student_id: s.student, key: s.key, ...body });
const studyDays = [];

test("سبب الغياب يُحفظ مع التسجيل ويظهر لولي الأمر، ويُمسح إن صار حاضرًا", async () => {
  // أيام دراسة فعلية فقط (قد تكون بعض الأيام نهاية أسبوع)
  for (let n = 1; studyDays.length < 4 && n < 20; n++) {
    const ds = (await admin.get(`/api/admin/attendance/day-status?date=${day(n)}`)).data;
    if (ds.study_day && !ds.holiday) studyDays.push(day(n));
  }
  const [d1] = studyDays;
  const r = await admin.post("/api/admin/attendance", { date: d1, entries: [{ student_id: s.student, status: "absent", excuse: "موعد طبي" }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let p = (await parent()).data;
  const rec = p.attendance.find((a) => a.day === d1);
  assert.equal(rec.excuse, "موعد طبي");
  assert.equal(rec.can_excuse, true);

  // تعديل السبب وحده لا يطلب سبب تعديل
  assert.equal((await admin.post("/api/admin/attendance", { date: d1, entries: [{ student_id: s.student, status: "absent", excuse: "مراجعة المستشفى" }] })).status, 200);
  p = (await parent()).data;
  assert.equal(p.attendance.find((a) => a.day === d1).excuse, "مراجعة المستشفى");

  const [, d2] = studyDays;
  await admin.post("/api/admin/attendance", { date: d2, entries: [{ student_id: s.student, status: "late", excuse: "زحمة" }] });
  assert.equal((await admin.post("/api/admin/attendance", { date: d2, reason: "خطأ", entries: [{ student_id: s.student, status: "present" }] })).status, 200);
  p = (await parent()).data;
  assert.equal(p.attendance.find((a) => a.day === d2).excuse, null, "الحاضر بلا سبب");
});

test("عذر ولي الأمر: يُرسل، يظهر للإدارة، والقبول يجعله «بعذر» ولا يُعاد إرساله", async () => {
  const [d1, d2] = studyDays;
  assert.equal((await parent("/excuse", { date: d2, text: "كان حاضرًا" })).status, 400, "لا عذر ليوم حضور");
  assert.equal((await parent("/excuse", { date: d1, text: "كان مريضًا ومعه تقرير" })).status, 200);
  const list = (await admin.get("/api/admin/attendance/excuses")).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].parent_excuse, "كان مريضًا ومعه تقرير");
  assert.equal((await admin.post("/api/admin/attendance/excuses/decide", { student_id: s.student, date: d1, accept: true })).data.status, "excused");
  const rec = (await parent()).data.attendance.find((a) => a.day === d1);
  assert.equal(rec.status, "excused");
  assert.equal(rec.excuse, "كان مريضًا ومعه تقرير");
  assert.equal(rec.parent_excuse_state, "accepted");
  assert.equal((await parent("/excuse", { date: d1, text: "مرة أخرى" })).status, 400, "قُبل عذره");
  assert.equal((await client(srv.base).post(`/api/public/${school}/student/excuse`, { access: code, student_id: s.student, key: "WRNG-KEY2", date: d1, text: "تجربة" })).status, 401);

  await admin.put("/api/admin/settings/public-page", { allow_parent_excuses: false });
  assert.equal((await parent("/excuse", { date: d1, text: "تجربة" })).status, 400, "أوقفتها المدرسة");
  await admin.put("/api/admin/settings/public-page", { allow_parent_excuses: true });
});

test("متابعة اليوم والتقرير وحد تنبيه الغياب", async () => {
  const [, , d3, d4] = studyDays;
  for (const d of [d3, d4]) await admin.post("/api/admin/attendance", { date: d, entries: [{ student_id: s.student, status: "absent" }] });
  const ov = (await admin.get(`/api/admin/attendance/overview?date=${d3}`)).data;
  const c = ov.classes.find((x) => x.id === s.cls);
  assert.equal(c.recorded, 1); assert.equal(c.absent, 1);
  assert.equal(ov.classes.find((x) => x.id === s.other).recorded, 0, "الفصل الآخر لم يُسجَّل");
  assert.equal(ov.people[0].id, s.student);

  await admin.put("/api/admin/settings/public-page", { absence_alert_threshold: 2 });
  const risk = (await admin.get(`/api/admin/attendance/overview?date=${d3}`)).data.at_risk;
  assert.equal(risk[0]?.id, s.student);
  assert.deepEqual((await parent()).data.absence_warning, { absent: 2, threshold: 2 });
  await admin.put("/api/admin/settings/public-page", { absence_alert_threshold: 0 });
  assert.equal((await parent()).data.absence_warning, null, "0 = إيقاف");

  const rep = (await admin.get(`/api/admin/attendance/report?from=${day(30)}&to=${day(0)}&class_id=${s.cls}`)).data;
  const me = rep.students.find((x) => x.id === s.student);
  assert.equal(me.absent, 2); assert.equal(me.excused, 1);
  assert.equal(me.rate, 33.3, "الحضور 1 من 3 أيام (الغياب بعذر لا يُحسب)");
  assert.equal(rep.students.some((x) => x.id === s.student2), false, "تصفية الفصل");
  assert.equal((await admin.get(`/api/admin/attendance/report?from=${day(0)}&to=${day(5)}`)).status, 400);
});

test("التنبيهات: الإدارة والمعلم يضيفان، الداخلي لا يظهر لولي الأمر، وتأكيد الاطلاع", async () => {
  const a = await admin.post(`/api/admin/students/${s.student}/alerts`, { kind: "behavior", level: "warning", title: "تكرار التأخر", body: "نرجو المتابعة" });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  await admin.post(`/api/admin/students/${s.student}/alerts`, { title: "ملاحظة داخلية", for_parent: false });
  const t = await teacher.post(`/api/teacher/students/${s.student}/alerts`, { kind: "praise", level: "positive", title: "تميز في العلوم" });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  assert.equal((await teacher.post(`/api/teacher/students/${s.student2}/alerts`, { title: "ليس من فصلي" })).status, 403);

  let p = (await parent()).data;
  assert.deepEqual(p.alerts.map((x) => x.title).sort(), ["تكرار التأخر", "تميز في العلوم"].sort());
  assert.equal(p.alerts[0].teacher_id, undefined, "لا معرّفات داخلية لولي الأمر");
  assert.equal((await parent("/alerts/ack", { alert_id: a.data.id })).status, 200);
  p = (await parent()).data;
  assert.ok(p.alerts.find((x) => x.id === a.data.id).acknowledged_at);

  assert.equal((await teacher.del(`/api/teacher/alerts/${a.data.id}`)).status, 403, "المعلم يحذف تنبيهاته فقط");
  assert.equal((await teacher.del(`/api/teacher/alerts/${t.data.id}`)).status, 200);
  assert.equal((await admin.get(`/api/admin/students/${s.student}/alerts`)).data.length, 2, "الإدارة ترى الداخلي أيضًا");
  const tl = (await teacher.get(`/api/teacher/students?class_id=${s.cls}`)).data;
  assert.equal(tl[0].alerts, 2);
});
