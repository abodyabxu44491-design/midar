// ترابط الأقسام (فحص شامل): طالب واحد يُتتبَّع عبر النظام كله، وتغيير اسم صف ينعكس في كل مكان،
// ونقل الطالب وأرشفته تتعامل معهما كل الأقسام. الهدف: أن تكون المنصة نظامًا واحدًا لا صفحات منفصلة.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, admin, teacher, code;
const id = `it-${uid()}`.slice(0, 28);
const S = {};
const day = new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10);

before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  const otp = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: otp })).status, 200);
  const r = await owner.post("/api/owner/tenants", { id, name: "مدرسة الترابط" });
  code = r.data.credentials.directory_code;
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = 'admin'"));
  // هيكل: الأساسي (1–6) بشعبتين، ومادة الرياضيات
  assert.ok([200, 201].includes((await admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 2, grade_set: "yemen" })).status));
  const classes = (await admin.get("/api/admin/structure/classes")).data;
  S.c1 = classes.find((c) => c.name === "الأول - أ"); S.c2 = classes.find((c) => c.name === "الأول - ب");
  const subjects = (await admin.get("/api/admin/structure/subjects")).data;
  S.math = subjects.find((s) => s.name === "الرياضيات");
  const t = await admin.post("/api/admin/teachers", { name: "أ. سالم علي باوزير", username: `ts${uid()}`.slice(0, 18),
    load: [{ class_id: S.c1.id, subject_id: S.math.id }, { class_id: S.c2.id, subject_id: S.math.id }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  teacher = client(srv.base);
  assert.equal((await teacher.post("/api/staff/login", { school: id, username: t.data.credentials.username, password: t.data.credentials.password })).status, 200);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false WHERE role = 'teacher'"));
  await admin.put("/api/admin/settings/public-page", { show_classes: true, show_student_names: true, show_search: true });
});
after(async () => { await srv.close(); await endPool(); });

test("طالب جديد يظهر في كل الأقسام: القائمة، الملف، المعلم، الحضور، الاختبار، الكشف، البحث، الصفحة العامة، التصدير", async () => {
  const s = await admin.post("/api/admin/students", { name: "محمد أحمد علي العمودي", class_id: S.c1.id, guardian_phone: "771234567" });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  S.student = s.data;
  assert.ok((await admin.get("/api/admin/students")).data.some((x) => x.id === S.student.id), "قائمة الطلاب");
  assert.equal((await admin.get(`/api/admin/students/${S.student.id}/profile`)).status, 200, "ملف الطالب");
  const tl = (await teacher.get(`/api/teacher/students?class_id=${S.c1.id}`)).data;
  assert.ok(JSON.stringify(tl).includes(S.student.name), "يظهر للمعلم");
  const att = (await admin.get(`/api/admin/attendance?class_id=${S.c1.id}&date=${day}`)).data;
  assert.ok(JSON.stringify(att).includes(S.student.name), "في لوح الحضور");
  assert.equal((await admin.post("/api/admin/attendance", { date: day, entries: [{ student_id: S.student.id, status: "absent", excuse: "مرض" }] })).status, 200);

  const e = await teacher.post("/api/teacher/exams", { class_id: S.c1.id, subject_id: S.math.id, title: "اختبار الترابط", max_score: 20 });
  assert.equal(e.status, 201, JSON.stringify(e.data));
  S.exam = e.data.id;
  const sc = (await teacher.get(`/api/teacher/exams/${S.exam}/scores`)).data;
  assert.ok(JSON.stringify(sc).includes(S.student.name), "في قائمة إدخال الدرجات");
  assert.equal((await teacher.put(`/api/teacher/exams/${S.exam}/scores`, { scores: { [S.student.id]: 17 } })).status, 200);
  await teacher.post(`/api/teacher/exams/${S.exam}/submit`, {});
  assert.equal((await admin.post(`/api/admin/exams/${S.exam}/status`, { status: "published" })).status, 200);

  const rc = (await admin.get(`/api/admin/reports/report-cards?class_id=${S.c1.id}`)).data;
  assert.ok(JSON.stringify(rc).includes("17"), "الدرجة في كشف الدرجات");
  const found = (await admin.get(`/api/admin/analytics/search?q=${encodeURIComponent("العمودي")}`)).data;
  assert.equal(found.students.length, 1, "البحث السريع");
  const pub = await client(srv.base).post(`/api/public/${id}/section`, { access: code, class_id: S.c1.id });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.ok(JSON.stringify(pub.data).includes(S.student.name), "الصفحة العامة (مع السماح)");
  const parent = (await client(srv.base).post(`/api/public/${id}/student`, { access: code, student_id: S.student.id, key: S.student.access_key })).data;
  assert.ok(parent.attendance.some((a) => a.day === day && a.excuse === "مرض"), "ولي الأمر يرى الغياب وسببه");
  assert.ok(JSON.stringify(parent).includes("اختبار الترابط"), "ولي الأمر يرى الدرجة المنشورة");
  const exp = await admin.get("/api/admin/export/");
  assert.ok(JSON.stringify(exp.data).includes(S.student.name), "في نسخة البيانات");
});

test("تغيير اسم الصف ينعكس في الشعب والطلاب والمعلم والاختبارات والكشف والصفحة العامة", async () => {
  const grade = await transaction({ tenantId: id }, async (q) => (await q("SELECT grade_id FROM classes WHERE id = $1", [S.c1.id]))[0].grade_id);
  assert.equal((await admin.patch(`/api/admin/setup/grades/${grade}`, { name: "الصف الأول" })).status, 200);
  const classes = (await admin.get("/api/admin/structure/classes")).data;
  const renamed = classes.find((c) => c.id === S.c1.id);
  assert.equal(renamed.name, "الصف الأول - أ", "اسم الشعبة يتبع اسم الصف");
  const st = (await admin.get("/api/admin/students")).data.find((x) => x.id === S.student.id);
  assert.equal(st.class_name, "الصف الأول - أ", "الطالب");
  const ex = (await admin.get("/api/admin/exams/")).data.find((x) => x.id === S.exam);
  assert.equal(ex.class_name, "الصف الأول - أ", "الاختبارات");
  const tt = (await teacher.get("/api/teacher/me")).data;
  assert.ok(JSON.stringify(tt).includes("الصف الأول - أ"), "بوابة المعلم");
  const parent = (await client(srv.base).post(`/api/public/${id}/student`, { access: code, student_id: S.student.id, key: S.student.access_key })).data;
  assert.ok(JSON.stringify(parent).includes("الصف الأول - أ"), "ملف ولي الأمر");
});

test("نقل الطالب لشعبة أخرى: يظهر فيها فقط، ويبقى سجله السابق", async () => {
  const cur = (await admin.get(`/api/admin/students/${S.student.id}/profile`)).data;
  const version = cur.student?.version ?? cur.version;
  const mv = await admin.patch(`/api/admin/students/${S.student.id}`, { version, class_id: S.c2.id });
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  const a1 = JSON.stringify((await admin.get(`/api/admin/attendance?class_id=${S.c1.id}&date=${day}`)).data);
  const a2 = JSON.stringify((await admin.get(`/api/admin/attendance?class_id=${S.c2.id}&date=${day}`)).data);
  assert.ok(!a1.includes(S.student.name) && a2.includes(S.student.name), "الحضور يتبع الشعبة الجديدة");
  const parent = (await client(srv.base).post(`/api/public/${id}/student`, { access: code, student_id: S.student.id, key: S.student.access_key })).data;
  assert.ok(parent.attendance.some((a) => a.day === day), "سجل الغياب السابق باقٍ");
});

test("أرشفة الطالب (انسحاب): يخرج من القوائم والحضور والصفحة العامة، ويبقى في السجل", async () => {
  assert.equal((await admin.post(`/api/admin/students/${S.student.id}/status`, { status: "withdrawn", note: "انتقال" })).status, 200);
  assert.ok(!(await admin.get("/api/admin/students")).data.some((x) => x.id === S.student.id && x.status === "active"), "ليس ضمن النشطين");
  const att = JSON.stringify((await admin.get(`/api/admin/attendance?class_id=${S.c2.id}&date=${day}`)).data);
  assert.ok(!att.includes(S.student.name), "لا يظهر في تسجيل الحضور");
  const pub = JSON.stringify((await client(srv.base).post(`/api/public/${id}/section`, { access: code, class_id: S.c2.id })).data);
  assert.ok(!pub.includes(S.student.name), "لا يظهر في الصفحة العامة");
  const n = await transaction({ tenantId: id }, async (q) => (await q("SELECT count(*)::int AS n FROM attendance WHERE student_id = $1", [S.student.id]))[0].n);
  assert.equal(n, 1, "سجله محفوظ");
});

test("حذف معلم له إسناد: يُحذف إسناده، ويصبح جدوله بلا معلم، ويتوقف سجله الوظيفي", async () => {
  const t = (await admin.get("/api/admin/teachers/")).data[0];
  await admin.put("/api/admin/timetable/slot", { class_id: S.c1.id, day: 0, period: 1, subject_id: S.math.id, teacher_id: t.id });
  const del = await admin.del(`/api/admin/teachers/${t.id}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const left = await transaction({ tenantId: id }, async (q) => (await q(
    `SELECT (SELECT count(*) FROM teacher_assignments)::int AS ta, (SELECT count(*) FROM timetable_slots WHERE teacher_id IS NOT NULL)::int AS slots,
            (SELECT count(*) FROM timetable_slots)::int AS all_slots, (SELECT bool_and(NOT is_active) FROM staff WHERE category = 'teacher') AS staff_off`))[0]);
  assert.equal(left.ta, 0);
  assert.equal(left.slots, 0);
  assert.equal(left.all_slots, 1, "الحصة باقية بلا معلم");
  assert.equal(left.staff_off, true);
});
