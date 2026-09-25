// اختبارات الأساس: الفصل بين الأدوار، عزل المدارس، الحماية المالية، سلامة البيانات
// التشغيل: npm test  (يحتاج قاعدة بيانات اختبار و TEST_OWNER_PASSWORD في .env)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, ownerPath, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { PgStore } from "../src/core/rate-limit.js";

let srv, owner, A, B;           // A و B مدرستان منفصلتان
const s = {};                   // بيانات مشتركة بين الاختبارات

async function makeSchool(name) {
  const id = `t-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, max_students: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const admin = client(srv.base);
  const login = await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password });
  assert.equal(login.status, 200);
  return { id, admin, directory: r.data.credentials.directory_code, password: r.data.credentials.password };
}

before(async () => {
  assert.ok(ownerPassword, "عيّن TEST_OWNER_PASSWORD في .env");
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  const r = await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  A = await makeSchool("مدرسة اختبار أ");
  s.adminPw = null;
  B = await makeSchool("مدرسة اختبار ب");
  s.adminPw = A.password;

  // تجهيز مدرسة أ
  const c = await A.admin.post("/api/admin/structure/classes", { name: "الأول" });
  const sb = await A.admin.post("/api/admin/structure/subjects", { name: "الرياضيات" });
  s.classId = c.data.id; s.subjectId = sb.data.id;
  const t = await A.admin.post("/api/admin/teachers", { name: "معلم الاختبار", username: "tester", load: [{ class_id: s.classId, subject_id: s.subjectId }] });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  s.teacherPw = t.data.credentials.password;
  const st = await A.admin.post("/api/admin/students", { name: "طالب الاختبار", class_id: s.classId, fees_enabled: true });
  assert.equal(st.status, 201, JSON.stringify(st.data));
  s.student = st.data;
});

after(async () => { await srv.close(); await endPool(); });

test("الرابط الرئيسي صفحة فاضية بلا روابط، ولكل مدرسة رابطها", async () => {
  const home = await fetch(srv.base).then((r) => r.text());
  assert.ok(!/\/admin|\/teacher|idara/.test(home), "الصفحة الرئيسية لا تكشف أي روابط");
  assert.equal((await fetch(`${srv.base}/${A.id}`)).status, 200);
  assert.equal((await fetch(`${srv.base}/${A.id}/idara`)).status, 200);
  assert.equal((await fetch(`${srv.base}/${A.id}/student`)).status, 200);
  assert.equal((await fetch(`${srv.base}/لا-يوجد`)).status, 404);
});

test("الرموز المحجوزة لا تُستخدم كرمز مدرسة", async () => {
  for (const id of ["admin", "api", "idara"]) {
    const r = await owner.post("/api/owner/tenants", { id, name: "محجوز" });
    assert.equal(r.status, 400, id);
  }
});

test("باب المدرسة الموحّد يوجّه كل حساب للوحته", async () => {
  const adminIn = client(srv.base);
  const r1 = await adminIn.post("/api/staff/login", { school: A.id, username: "admin", password: s.adminPw });
  assert.equal(r1.data.role, "admin");
  assert.equal((await adminIn.get("/api/admin/me")).status, 200);
  assert.equal((await adminIn.get("/api/teacher/me")).status, 401, "حساب المدير لا يفتح بوابة المعلم");

  const teacherIn = client(srv.base);
  const r2 = await teacherIn.post("/api/staff/login", { school: A.id, username: "tester", password: s.teacherPw });
  assert.equal(r2.data.role, "teacher");
  assert.equal((await teacherIn.get("/api/admin/me")).status, 401, "حساب المعلم لا يفتح لوحة الإدارة");
  assert.equal((await teacherIn.get("/api/teacher/me")).status, 200);

  // حساب مدرسة أ لا يدخل من باب مدرسة ب
  const cross = client(srv.base);
  assert.equal((await cross.post("/api/staff/login", { school: B.id, username: "tester", password: s.teacherPw })).status, 401);
});

test("لوحة المالك مخفية ولا تُفتح بدون دخول", async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get("/owner")).status, 404);
  assert.equal((await anon.get("/api/owner/tenants")).status, 401);
  const page = await fetch(`${srv.base}${ownerPath}/`);
  assert.equal(page.status, 200);
});

test("جلسة المدير لا تفتح واجهة المالك أو المعلم", async () => {
  assert.equal((await A.admin.get("/api/owner/tenants")).status, 401);
  assert.equal((await A.admin.get("/api/teacher/me")).status, 401);
});

test("بيانات المعلم لا تدخل لوحة الإدارة، والعكس", async () => {
  const x = client(srv.base);
  assert.equal((await x.post("/api/staff/login", { school: A.id, username: "tester", password: "كلمة-خاطئة" })).status, 401);
  const teacher = client(srv.base);
  assert.equal((await teacher.post("/api/staff/login", { school: A.id, username: "tester", password: s.teacherPw })).data.role, "teacher");
  assert.equal((await teacher.get("/api/admin/students")).status, 401);
  s.teacher = teacher;
});

test("عزل المدارس: مدير مدرسة ب لا يصل لطالب مدرسة أ", async () => {
  const id = s.student.id;
  assert.equal((await B.admin.patch(`/api/admin/students/${id}`, { version: 1, name: "اختراق" })).status, 404);
  assert.equal((await B.admin.post(`/api/admin/students/${id}/regenerate-key`)).status, 404);
  const list = await B.admin.get("/api/admin/students");
  assert.equal(list.data.length, 0);
  // محاولة ربط طالب بفصل مدرسة أخرى
  const bad = await B.admin.post("/api/admin/students", { name: "طالب ب", class_id: s.classId });
  assert.equal(bad.status, 409);
});

test("تسهيلات الإدخال: اسم ولي الأمر وتوحيد الجوال وربط الإخوة", async () => {
  // اسم ولي الأمر يُشتق من اسم الطالب، والجوال يُوحَّد إلى صيغة 05
  const a = await A.admin.post("/api/admin/students", { name: "  سالم   عبدالله ناصر ", guardian_phone: "+966 55 123 4567" });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.name, "سالم عبدالله ناصر", "تنظيف المسافات");
  assert.equal(a.data.guardian_name, "عبدالله ناصر", "اسم ولي الأمر من اسم الطالب");
  assert.equal(a.data.guardian_phone, "+966551234567", "الرقم الدولي يُحفظ بصيغة موحدة");

  // أخ بنفس الجوال يأخذ اسم ولي الأمر نفسه
  const b = await A.admin.post("/api/admin/students", { name: "ريم", guardian_phone: "+966 55 123 4567" });
  assert.equal(b.data.guardian_name, "عبدالله ناصر", "الأخ يرث اسم ولي الأمر");

  const g = await A.admin.get("/api/admin/students/guardian?phone=%2B966551234567");
  assert.equal(g.data.phone, "+966551234567");
  assert.equal(g.data.guardian_name, "عبدالله ناصر");
  assert.equal(g.data.siblings.length, 2, "يظهر الإخوة المسجلون");

  // مدرسة أخرى لا ترى أولياء أمور مدرستنا
  assert.equal((await B.admin.get("/api/admin/students/guardian?phone=%2B966551234567")).data.siblings.length, 0);

  // تنظيف بعد الاختبار حتى لا يتأثر حد الباقة
  for (const id of [a.data.id, b.data.id]) await A.admin.post(`/api/admin/students/${id}/status`, { status: "withdrawn" });
});

test("حد الباقة لا يُتجاوز", async () => {
  const r = await A.admin.post("/api/admin/students/import", { students: [{ name: "طالب ثان" }, { name: "طالب ثالث" }, { name: "طالب رابع" }] });
  assert.equal(r.status, 400);
  const list = await A.admin.get("/api/admin/students");
  assert.equal(list.data.length, 1, "الاستيراد الفاشل لا يترك نصف البيانات");
});

test("التعديل المتزامن: نسخة قديمة تُرفض", async () => {
  const id = s.student.id;
  const ok = await A.admin.patch(`/api/admin/students/${id}`, { version: 1, guardian_name: "ولي أمر" });
  assert.equal(ok.status, 200);
  const stale = await A.admin.patch(`/api/admin/students/${id}`, { version: 1, guardian_name: "قديم" });
  assert.equal(stale.status, 409);
});

test("المعلم لا يتجاوز فصوله، والدرجات تُقفل بعد الإرسال", async () => {
  const other = await A.admin.post("/api/admin/structure/classes", { name: "فصل آخر" });
  assert.equal((await s.teacher.get(`/api/teacher/attendance?class_id=${other.data.id}&date=2026-09-01`)).status, 403);
  assert.equal((await s.teacher.post("/api/teacher/exams", { class_id: other.data.id, subject_id: s.subjectId, title: "ممنوع", max_score: 10 })).status, 403);

  const e = await s.teacher.post("/api/teacher/exams", { class_id: s.classId, subject_id: s.subjectId, title: "اختبار 1", max_score: 20 });
  assert.equal(e.status, 201);
  s.examId = e.data.id;
  const over = await s.teacher.put(`/api/teacher/exams/${s.examId}/scores`, { scores: { [s.student.id]: 25 } });
  assert.equal(over.status, 400, "درجة أكبر من القصوى");
  assert.equal((await s.teacher.put(`/api/teacher/exams/${s.examId}/scores`, { scores: { [s.student.id]: 17.5 } })).status, 200);
  assert.equal((await s.teacher.post(`/api/teacher/exams/${s.examId}/submit`)).status, 200);
  assert.equal((await s.teacher.put(`/api/teacher/exams/${s.examId}/scores`, { scores: { [s.student.id]: 20 } })).status, 400);
});

test("صفحة الطلاب: الأسماء فقط، والملف بالمعرّف فقط، والدرجات بعد النشر فقط", async () => {
  const anon = client(srv.base);
  assert.equal((await anon.post(`/api/public/${A.id}/page`, { access: "WRONGCODE" })).status, 401);
  const dir = await anon.post(`/api/public/${A.id}/page`, { access: A.directory });
  assert.equal(dir.status, 200);
  const listed = dir.data.classes.flatMap((c) => c.students);
  assert.deepEqual(Object.keys(listed[0]).sort(), ["id", "name"], "لا تظهر أي بيانات غير الاسم");
  assert.equal(dir.data.settings.public_fee_badges, false, "حالة السداد موقوفة افتراضيًا");

  assert.equal((await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: "AAAA-BBBB" })).status, 401);
  const prof = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(prof.status, 200);
  assert.equal(prof.data.grades.length, 0, "الدرجات غير المنشورة لا تظهر");

  assert.equal((await A.admin.post(`/api/admin/exams/${s.examId}/status`, { status: "published" })).status, 200);
  const after = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(after.data.grades[0].score, 17.5);

  // معرّف مدرسة أ لا يعمل على مدرسة ب
  assert.equal((await anon.post(`/api/public/${B.id}/student`, { student_id: s.student.id, key: s.student.access_key })).status, 401);
});

test("إعدادات الصفحة العامة: كل عنصر اختياري", async () => {
  const anon = client(srv.base);
  const page = () => anon.post(`/api/public/${A.id}/page`, { access: A.directory });
  const set = (patch) => A.admin.put("/api/admin/settings/public-page", patch);

  // الوضع المفتوح: بلا رمز
  assert.equal((await anon.post(`/api/public/${A.id}/page`, {})).status, 401);
  assert.equal((await set({ access_mode: "open" })).status, 200);
  const open = await anon.post(`/api/public/${A.id}/page`, {});
  assert.equal(open.status, 200);
  assert.ok(open.data.classes.length);
  await set({ access_mode: "code" });

  // إخفاء الصفوف والأسماء يبقي البحث فقط
  assert.equal((await set({ show_classes: false, show_student_names: false })).status, 200);
  const hidden = await page();
  assert.equal(hidden.data.classes.length, 0);
  const found = await anon.post(`/api/public/${A.id}/search`, { access: A.directory, q: "الاختبار" });
  assert.ok(found.data.results.length, "البحث يعمل رغم إخفاء القوائم");
  assert.equal(found.data.results[0].fees, undefined, "لا تظهر حالة السداد افتراضيًا");

  // لا يمكن إيقاف كل شيء معًا
  assert.equal((await set({ show_search: false })).status, 400);
  await set({ show_classes: true, show_student_names: true });

  // معلمو الصف
  const withTeachers = await page();
  assert.ok(Array.isArray(withTeachers.data.classes[0].teachers));
  await set({ show_teachers: false });
  assert.equal((await page()).data.classes[0].teachers, null);
  await set({ show_teachers: true });

  // شارات السداد عند تفعيلها فقط
  await set({ public_fee_badges: true });
  const badged = await anon.post(`/api/public/${A.id}/search`, { access: A.directory, q: "الاختبار" });
  assert.ok("fees" in badged.data.results[0]);
  await set({ public_fee_badges: false });

  // إخفاء الدرجات من ملف الطالب
  await set({ profile_show_grades: false });
  const prof = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(prof.data.grades.length, 0);
  await set({ profile_show_grades: true });

  // مدرسة ب لا تتأثر بإعدادات مدرسة أ
  const bSettings = await B.admin.get("/api/admin/settings/public-page");
  assert.equal(bSettings.data.access_mode, "code");
});

test("الجدول الدراسي: يُحفظ ويمنع تعارض المعلمين", async () => {
  const [cls2] = (await A.admin.get("/api/admin/structure/classes")).data.filter((c) => c.id !== s.classId);
  const put = (body) => A.admin.put("/api/admin/timetable/slot", body);

  // مادة غير مسندة للمعلم تُرفض
  assert.equal((await put({ class_id: s.classId, day: 0, period: 1, subject_id: s.subjectId, teacher_id: 999999 })).status, 400);

  const teacherId = (await A.admin.get("/api/admin/teachers")).data[0].id;
  assert.equal((await put({ class_id: s.classId, day: 0, period: 1, subject_id: s.subjectId, teacher_id: teacherId })).status, 200);

  // نفس المعلم في صف آخر بنفس الوقت = تعارض
  await A.admin.post("/api/admin/teachers/" + teacherId + "/load", {});
  const clash = await put({ class_id: cls2.id, day: 0, period: 1, subject_id: s.subjectId, teacher_id: teacherId });
  assert.equal(clash.status, 409, JSON.stringify(clash.data));

  const slots = (await A.admin.get(`/api/admin/timetable?class_id=${s.classId}`)).data;
  assert.equal(slots.length, 1);
  assert.equal(slots[0].period, 1);

  // يظهر في بوابة المعلم وفي ملف الطالب
  const mine = await s.teacher.get("/api/teacher/timetable");
  assert.equal(mine.data.week.length, 1);
  const anon = client(srv.base);
  const prof = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(prof.data.timetable.length, 1);

  // إخفاء الجدول من الإعدادات
  await A.admin.put("/api/admin/settings/public-page", { profile_show_timetable: false });
  const hidden = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(hidden.data.timetable.length, 0);
  await A.admin.put("/api/admin/settings/public-page", { profile_show_timetable: true });
});

test("كشف الدرجات يُبنى من الاختبارات المنشورة فقط", async () => {
  const card = await A.admin.get(`/api/admin/reports/report-card/${s.student.id}`);
  assert.equal(card.status, 200);
  assert.equal(card.data.subjects.length, 1);
  assert.equal(card.data.subjects[0].score, 17.5);
  assert.equal(card.data.summary.percent, 87.5);
  assert.ok(card.data.summary.grade);
  // كشف مدرسة أخرى غير متاح
  assert.equal((await B.admin.get(`/api/admin/reports/report-card/${s.student.id}`)).status, 404);
});

test("قوالب واتساب تُحفظ لكل مدرسة على حدة", async () => {
  const r = await A.admin.put("/api/admin/messaging/templates", { absence: "غياب {الطالب} اليوم", country_code: "966" });
  assert.equal(r.status, 200);
  assert.equal(r.data.absence, "غياب {الطالب} اليوم");
  const b = await B.admin.get("/api/admin/messaging/templates");
  assert.match(b.data.absence, /نفيدكم بغياب/, "قوالب مدرسة أخرى لم تتأثر");
  const data = await A.admin.get(`/api/admin/messaging/student/${s.student.id}?kind=absence`);
  assert.equal(data.status, 200);
  assert.equal(data.data.student.name, "طالب الاختبار");
});

test("طلبات التجربة: تصل للمالك فقط", async () => {
  const anon = client(srv.base);
  // تنظيف طلبات تشغيل سابق (حد 5 طلبات لكل جهاز يوميًا)
  for (const old of (await owner.get("/api/owner/leads")).data) await owner.del(`/api/owner/leads/${old.id}`);
  const bad = await anon.post("/api/public/leads", { school_name: "م", contact_name: "ا", phone: "x" });
  assert.equal(bad.status, 400);
  const ok = await anon.post("/api/public/leads", { school_name: "مدرسة الطلب", contact_name: "أبو محمد", phone: "0500000009", students_count: 120 });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal((await A.admin.get("/api/owner/leads")).status, 401, "الإدارة لا ترى الطلبات");
  const list = await owner.get("/api/owner/leads");
  assert.ok(list.data.some((l) => l.school_name === "مدرسة الطلب"));
  const spam = list.data.find((l) => l.school_name === "مدرسة الطلب");
  assert.equal((await owner.del(`/api/owner/leads/${spam.id}`)).status, 200);
});

test("شكل الصفحة الرئيسية يتحكم به المالك", async () => {
  const site = () => fetch(`${srv.base}/api/site`).then((r) => r.json());
  assert.equal((await site()).landing_mode, "blank");
  assert.equal((await owner.put("/api/owner/settings", { landing_mode: "marketing", brand_phone: "0500000000" })).status, 200);
  assert.equal((await site()).landing_mode, "marketing");
  await owner.put("/api/owner/settings", { landing_mode: "blank" });
});

test("المالية: لا دفع زائد، لا تكرار، لا إلغاء مع دفعات، والاسترداد صحيح", async () => {
  const inv = await A.admin.post("/api/admin/finance/invoices", { target: "student", target_id: s.student.id, title: "رسوم الاختبار", amount: 1000.5 });
  assert.equal(inv.status, 201);
  const { data } = await A.admin.get("/api/admin/finance/invoices");
  const id = data.invoices[0].id;

  assert.equal((await A.admin.post(`/api/admin/finance/invoices/${id}/payments`, { amount: 1000.51, method: "cash", idempotency_key: `k-${uid()}-x` })).status, 400);

  const key = `k-${uid()}-pay`;
  const p1 = await A.admin.post(`/api/admin/finance/invoices/${id}/payments`, { amount: 400, method: "cash", idempotency_key: key });
  const p2 = await A.admin.post(`/api/admin/finance/invoices/${id}/payments`, { amount: 400, method: "cash", idempotency_key: key });
  assert.equal(p1.status, 201);
  assert.equal(p2.data.receipt, p1.data.receipt, "نفس العملية لا تُسجل مرتين");

  assert.equal((await A.admin.post(`/api/admin/finance/invoices/${id}/void`, { reason: "خطأ في الإصدار" })).status, 400);
  assert.equal((await A.admin.post(`/api/admin/finance/invoices/${id}/refunds`, { amount: 500, note: "اختبار", idempotency_key: `k-${uid()}-r` })).status, 400);
  assert.equal((await A.admin.post(`/api/admin/finance/invoices/${id}/refunds`, { amount: 400, note: "اختبار", idempotency_key: `k-${uid()}-r` })).status, 201);

  // ولي الأمر: يرى الحساب البنكي ثم يرسل إشعار تحويل، والإدارة تؤكده
  const acc = await A.admin.post("/api/admin/settings/payment/accounts", { bank_name: "مصرف الاختبار", account_holder: "مدرسة الاختبار", iban: "sa03 8000 0000 6080 1016 7519" });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  assert.equal((await A.admin.post("/api/admin/settings/payment/accounts", { bank_name: "خطأ", account_holder: "خطأ", iban: "123" })).status, 400);

  const anon = client(srv.base);
  const prof0 = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(prof0.data.fees.accounts[0].iban, "SA0380000000608010167519");
  const base = { student_id: s.student.id, key: s.student.access_key, invoice_id: id, account_id: acc.data.id,
    transfer_date: new Date().toISOString().slice(0, 10), sender_name: "ولي أمر الاختبار" };

  const tooMuch = await anon.post(`/api/public/${A.id}/transfer-claims`, { ...base, amount: 5000, idempotency_key: `k-${uid()}-c0` });
  assert.equal(tooMuch.status, 400, "أكبر من المتبقي");
  assert.match(tooMuch.data.error, /ر\.س/, "رمز عملة المدرسة (ريال سعودي) يظهر في الرسالة");
  const claimKey = `k-${uid()}-c1`;
  const c1 = await anon.post(`/api/public/${A.id}/transfer-claims`, { ...base, amount: 1000.5, idempotency_key: claimKey });
  assert.equal(c1.status, 201, JSON.stringify(c1.data));
  const again = await anon.post(`/api/public/${A.id}/transfer-claims`, { ...base, amount: 1000.5, idempotency_key: claimKey });
  assert.equal(again.data.id, c1.data.id, "الإشعار لا يتكرر");
  assert.equal((await anon.post(`/api/public/${A.id}/transfer-claims`, { ...base, amount: 1, idempotency_key: `k-${uid()}-c2` })).status, 400, "الإشعار المعلق يغطي المتبقي");

  // الإشعار وحده لا يغيّر حالة السداد
  const mid = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(mid.data.fees.status, "unpaid");

  // مدرسة ب لا تستطيع مراجعة إشعار مدرسة أ
  assert.equal((await B.admin.post(`/api/admin/finance/claims/${c1.data.id}/review`, { decision: "confirm" })).status, 404);
  assert.equal((await A.admin.post(`/api/admin/finance/claims/${c1.data.id}/review`, { decision: "reject" })).status, 400, "الرفض يحتاج سببًا");
  const ok = await A.admin.post(`/api/admin/finance/claims/${c1.data.id}/review`, { decision: "confirm" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.receipt, /^R-\d{6}$/);
  assert.equal((await A.admin.post(`/api/admin/finance/claims/${c1.data.id}/review`, { decision: "confirm" })).status, 400, "لا يُؤكد مرتين");

  const prof = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(prof.data.fees.status, "paid");
  assert.equal(prof.data.fees.remaining, 0);
  assert.equal(prof.data.fees.claims[0].status, "confirmed");
  assert.equal(prof.data.fees.receipts[0].method, "transfer");
});

test("حالات الطالب: خروج من القيد وإعادته، ولا يُفتح ملف غير النشط", async () => {
  const anon = client(srv.base);
  for (const status of ["graduated", "transferred", "withdrawn"]) {
    assert.equal((await A.admin.post(`/api/admin/students/${s.student.id}/status`, { status, note: "اختبار" })).status, 200, status);
    assert.equal((await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key })).status, 401);
    const list = await A.admin.get("/api/admin/students");
    assert.ok(!list.data.some((x) => x.id === s.student.id), `${status}: لا يظهر في القائمة النشطة`);
    const off = await A.admin.get("/api/admin/students?status=inactive");
    assert.equal(off.data.find((x) => x.id === s.student.id).status, status);
  }
  assert.equal((await A.admin.post(`/api/admin/students/${s.student.id}/status`, { status: "active", note: null })).status, 200);
  assert.equal((await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key })).status, 200);
  assert.equal((await A.admin.post(`/api/admin/students/${s.student.id}/status`, { status: "خطأ" })).status, 400);
});

test("طلب من موقع خارجي يُرفض (CSRF)", async () => {
  const evil = client(srv.base, { origin: "https://evil.example" });
  evil.jar.set(...A.admin.jar.entries().next().value);
  assert.equal((await evil.post("/api/admin/structure/classes", { name: "من الخارج" })).status, 403);
});

test("سجل التدقيق يسجل التعديلات بالقيم", async () => {
  const r = await A.admin.get("/api/admin/audit");
  assert.ok(r.data.some((a) => a.changes?.some((c) => c.field === "guardian_name")));
});

test("قفل الحساب بعد 5 محاولات خاطئة", async () => {
  const x = client(srv.base);
  for (let i = 0; i < 5; i++) await x.post("/api/staff/login", { school: A.id, username: "tester", password: "wrong-pass" });
  const r = await x.post("/api/staff/login", { school: A.id, username: "tester", password: s.teacherPw });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /مقفل/);
});

test("اشتراكات المدارس: فاتورة، سداد، تمديد، وإيقاف تلقائي", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const past = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  // اشتراك منتهٍ منذ 60 يومًا ومدة سماح 14 يومًا
  assert.equal((await owner.patch(`/api/owner/tenants/${A.id}`, { subscription_end: past, subscription_price: 4000, grace_days: 14 })).status, 200);

  const inv = await owner.post("/api/owner/billing/invoices", {
    tenant_id: A.id, period_start: today, period_end: nextYear, amount: 4000 });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));

  const before = await owner.get("/api/owner/billing");
  assert.ok(before.data.summary.due >= 4000);
  assert.ok(before.data.renewals.some((t) => t.id === A.id));

  // بعد مدة السماح: الاشتراك ينتهي (تغيير حالة فقط، بلا حذف ولا إيقاف للمدرسة)
  const suspended = await owner.post("/api/owner/billing/suspend-expired", {});
  assert.ok(suspended.data.suspended.some((t) => t.tenant_id === A.id), "الاشتراك المنتهي يُنهى");
  const me = await A.admin.get("/api/admin/me");
  assert.equal(me.status, 200, "المدير يبقى قادرًا على الدخول ليجدد");
  assert.equal(me.data.access.locked, true);
  assert.equal(me.data.access.status, "expired");
  const blocked = await A.admin.get("/api/admin/students");
  assert.equal(blocked.status, 402, "باقي اللوحة مقفل حتى التجديد");
  assert.equal(blocked.data.code, "subscription_inactive");
  assert.equal((await A.admin.get("/api/admin/subscription")).status, 200, "صفحة الاشتراك متاحة للتجديد");
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/directory`, { access: "X" })).status, 404, "صفحات المدرسة العامة متوقفة");

  // السداد يعيد التفعيل ويمدد الاشتراك، والبيانات كما هي
  assert.equal((await owner.post(`/api/owner/billing/invoices/${inv.data.id}/pay`, { method: "transfer" })).status, 200);
  const tenants = await owner.get("/api/owner/tenants");
  const A2 = tenants.data.find((t) => t.id === A.id);
  assert.equal(A2.status, "active");
  assert.equal(A2.subscription_end, nextYear);
  assert.equal((await A.admin.get("/api/admin/students")).status, 200, "عادت المدرسة للعمل ببياناتها");
  assert.equal((await owner.post(`/api/owner/billing/invoices/${inv.data.id}/pay`, { method: "cash" })).status, 400, "لا تُسدد مرتين");

  // المدرسة لا ترى فواتير الاشتراك
  const admin2 = client(srv.base);
  await admin2.post("/api/staff/login", { school: A.id, username: "admin", password: s.adminPw });
  assert.equal((await admin2.get("/api/owner/billing")).status, 401);
  A.admin = admin2;
});

test("الواجبات: المعلم ينشئ ويرصد، وولي الأمر يتابع", async () => {
  // جلسة المعلم انتهت في الاختبارات السابقة (إيقاف المدرسة وقفل الحساب)، فنعيد تفعيلها من الإدارة
  const teacherId = (await A.admin.get("/api/admin/teachers")).data[0].id;
  const fresh = await A.admin.post(`/api/admin/teachers/${teacherId}/reset-password`, {});
  s.teacherPw = fresh.data.credentials.password;
  s.teacher = client(srv.base);
  assert.equal((await s.teacher.post("/api/staff/login", { school: A.id, username: "tester", password: s.teacherPw })).data.role, "teacher");
  const hw = await s.teacher.post("/api/teacher/homework", {
    class_id: s.classId, subject_id: s.subjectId, title: "حل تمارين الوحدة", due_date: new Date().toISOString().slice(0, 10) });
  assert.equal(hw.status, 201, JSON.stringify(hw.data));

  // مادة غير مسندة تُرفض
  const other = (await A.admin.get("/api/admin/structure/classes")).data.find((c) => c.id !== s.classId);
  assert.equal((await s.teacher.post("/api/teacher/homework", { class_id: other.id, subject_id: s.subjectId, title: "ممنوع" })).status, 403);

  const sheet = await s.teacher.get(`/api/teacher/homework/${hw.data.id}/submissions`);
  assert.ok(sheet.data.length >= 1);
  assert.equal(sheet.data[0].submitted, false);

  assert.equal((await s.teacher.put(`/api/teacher/homework/${hw.data.id}/submissions`,
    { entries: [{ student_id: s.student.id, submitted: true, note: null }] })).status, 200);

  const anon = client(srv.base);
  const prof = await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key });
  assert.equal(prof.data.homework[0].title, "حل تمارين الوحدة");
  assert.equal(prof.data.homework[0].submitted, true);

  // مدرسة ب لا ترى واجبات مدرسة أ
  assert.equal((await B.admin.get("/api/admin/homework")).data.length, 0);
});

test("طلبات التسجيل: تُرسل من صفحة المدرسة وتُقبل فيصبح الطالب مسجلًا", async () => {
  const anon = client(srv.base);
  const body = { access: A.directory, student_name: "طالب جديد", guardian_name: "ولي أمر جديد", guardian_phone: "0500000077", grade_wanted: "الأول" };

  // موقوف افتراضيًا
  assert.equal((await anon.post(`/api/public/${A.id}/admissions`, body)).status, 403);
  assert.equal((await A.admin.put("/api/admin/settings/public-page", { show_admissions: true })).status, 200);
  assert.equal((await anon.post(`/api/public/${A.id}/admissions`, body)).status, 201);
  assert.equal((await anon.post(`/api/public/${A.id}/admissions`, { ...body, access: "WRONG" })).status, 401, "الرمز مطلوب في وضع الرمز");

  const list = await A.admin.get("/api/admin/admissions");
  const req = list.data.find((x) => x.student_name === "طالب جديد");
  assert.equal(req.status, "new");
  assert.equal((await B.admin.get("/api/admin/admissions")).data.length, 0, "لا تراها مدرسة أخرى");

  const accepted = await A.admin.post(`/api/admin/admissions/${req.id}/review`, { decision: "accepted", class_id: s.classId });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.match(accepted.data.student.access_key, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await A.admin.post(`/api/admin/admissions/${req.id}/review`, { decision: "accepted" })).status, 400, "لا يُقبل مرتين");

  // الطالب الجديد يفتح ملفه بمعرّفه
  const prof = await anon.post(`/api/public/${A.id}/student`, { student_id: accepted.data.student.id, key: accepted.data.student.access_key });
  assert.equal(prof.status, 200);
  assert.equal(prof.data.student.name, "طالب جديد");
});

test("النظام المالي: حسابات وحركات واعتماد وتبرعات ورواتب", async () => {
  // التبرعات والرواتب أقسام اختيارية موقوفة افتراضيًا
  assert.equal((await A.admin.get("/api/admin/ledger/donations")).status, 404, "القسم الموقوف غير موجود");
  assert.equal((await A.admin.put("/api/admin/settings/modules", { donations: true, payroll: true })).status, 200);
  // الحسابات والتصنيفات تُجهَّز تلقائيًا لكل مدرسة
  const accounts = await A.admin.get("/api/admin/ledger/accounts");
  assert.equal(accounts.status, 200, JSON.stringify(accounts.data));
  assert.ok(accounts.data.length >= 2, "صندوق نقدي وحساب بنكي افتراضيان");
  const cash = accounts.data.find((a) => a.kind === "cash");
  const categories = (await A.admin.get("/api/admin/ledger/categories")).data;
  const expenseCat = categories.find((c) => c.direction === "expense");
  const incomeCat = categories.find((c) => c.direction === "income");

  // دفعة رسوم جديدة تدخل سجل الحركات تلقائيًا
  await A.admin.post("/api/admin/finance/invoices", { target: "student", target_id: s.student.id, title: "رسوم نشاط", amount: 200 });
  const inv = (await A.admin.get("/api/admin/finance/invoices")).data.invoices.find((i) => i.title === "رسوم نشاط");
  assert.equal((await A.admin.post(`/api/admin/finance/invoices/${inv.id}/payments`,
    { amount: 200, method: "cash", idempotency_key: `k-${uid()}-ledger` })).status, 201);

  const entriesAfterFees = await A.admin.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01");
  assert.ok(entriesAfterFees.data.some((e) => e.source_type === "fee"), "دفعة الرسوم أنشأت حركة");
  assert.ok(entriesAfterFees.data.every((e) => e.reason && e.account_name && e.category_name), "لا حركة مجهولة السبب");

  // مصروف يحتاج اعتمادًا: لا يُحتسب قبل الاعتماد
  const before = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  const pending = await A.admin.post("/api/admin/ledger/entries", {
    direction: "expense", amount: 500, account_id: cash.id, category_id: expenseCat.id,
    occurred_on: "2026-09-01", reason: "شراء مستلزمات", beneficiary: "مورد", method: "cash", needs_approval: true });
  assert.equal(pending.status, 201, JSON.stringify(pending.data));
  assert.equal(pending.data.status, "pending");
  assert.match(pending.data.entry_no, /^F-\d{6}$/);

  const mid = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  assert.equal(mid.data.expense, before.data.expense, "المعلّق لا يُحتسب");
  assert.equal(mid.data.pending, 1);

  assert.equal((await A.admin.post(`/api/admin/ledger/entries/${pending.data.id}/review`, { decision: "approve" })).status, 200);
  const after = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  assert.equal(after.data.expense, before.data.expense + 500, "بعد الاعتماد يُحتسب");
  assert.equal(after.data.balance, before.data.balance - 500, "الرصيد ينقص");
  assert.equal((await A.admin.post(`/api/admin/ledger/entries/${pending.data.id}/review`, { decision: "approve" })).status, 400, "لا يُعتمد مرتين");

  // الإلغاء يحتاج سببًا ولا يُحذف
  assert.equal((await A.admin.post(`/api/admin/ledger/entries/${pending.data.id}/void`, { reason: "خط" })).status, 400);
  assert.equal((await A.admin.post(`/api/admin/ledger/entries/${pending.data.id}/void`, { reason: "خطأ في الإدخال" })).status, 200);
  const voided = (await A.admin.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01")).data
    .find((e) => e.id === pending.data.id);
  assert.equal(voided.status, "void", "الحركة تبقى في السجل ملغاة");
  const afterVoid = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  assert.equal(afterVoid.data.expense, before.data.expense, "الملغاة لا تُحتسب");

  // حركة الرسوم لا تُلغى من السجل المالي
  const feeEntry = entriesAfterFees.data.find((e) => e.source_type === "fee");
  assert.equal((await A.admin.post(`/api/admin/ledger/entries/${feeEntry.id}/void`, { reason: "محاولة" })).status, 400);

  // تبرع: يُسجَّل كإيراد مستقل
  const donation = await A.admin.post("/api/admin/ledger/donations", {
    anonymous: true, amount: 1000, method: "transfer", received_on: "2026-09-02", purpose: "دعم الأنشطة" });
  assert.equal(donation.status, 201, JSON.stringify(donation.data));
  assert.ok(donation.data.entry_no);
  const withDonation = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  assert.equal(withDonation.data.donations, 1000);
  assert.equal((await A.admin.post("/api/admin/ledger/donations", { anonymous: false, amount: 50, method: "cash", received_on: "2026-09-02" })).status, 400, "اسم المتبرع مطلوب");

  // الرواتب: مسير ← اعتماد ← صرف ينشئ حركات
  assert.ok((await A.admin.post("/api/admin/ledger/staff/import-teachers", {})).data.added >= 1);
  await A.admin.post("/api/admin/ledger/staff", { full_name: "موظف إداري", category: "admin", base_salary: 3000 });
  const run = await A.admin.post("/api/admin/ledger/payroll", { period: "2026-09-01" });
  assert.equal(run.status, 201, JSON.stringify(run.data));
  assert.ok(run.data.employees >= 2);
  assert.equal((await A.admin.post("/api/admin/ledger/payroll", { period: "2026-09-15" })).status, 409, "مسير واحد للشهر");

  const items = (await A.admin.get(`/api/admin/ledger/payroll/${run.data.id}/items`)).data;
  const item = items.find((i) => Number(i.base) > 0) || items[0];
  const updated = await A.admin.patch(`/api/admin/ledger/payroll/${run.data.id}/items/${item.id}`,
    { allowances: 500, bonus: 0, deductions: 100, advances: 0 });
  assert.equal(Number(updated.data.net), Number(item.base) + 400, "صافي الراتب يُحسب آليًا");

  assert.equal((await A.admin.post(`/api/admin/ledger/payroll/${run.data.id}/pay`, { method: "transfer" })).status, 400, "الصرف بعد الاعتماد");
  assert.equal((await A.admin.post(`/api/admin/ledger/payroll/${run.data.id}/approve`, {})).status, 200);
  assert.equal((await A.admin.patch(`/api/admin/ledger/payroll/${run.data.id}/items/${item.id}`, { allowances: 0, bonus: 0, deductions: 0, advances: 0 })).status, 400, "لا تعديل بعد الاعتماد");
  const paid = await A.admin.post(`/api/admin/ledger/payroll/${run.data.id}/pay`, { method: "transfer" });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.ok(paid.data.paid >= 1);
  const salaryEntries = (await A.admin.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01&source_type=salary")).data;
  assert.equal(salaryEntries.length, paid.data.paid, "حركة مصروف لكل موظف");
  assert.ok(salaryEntries.every((e) => e.beneficiary), "كل راتب مربوط باسم موظفه");
  const salaryVoid = await A.admin.post(`/api/admin/ledger/entries/${salaryEntries[0].id}/void`, { reason: "محاولة إلغاء" });
  assert.equal(salaryVoid.status, 400, "قيد الراتب لا يُلغى منفردًا");
  assert.match(salaryVoid.data.error, /عكسية/);

  // عزل المدارس
  assert.equal((await B.admin.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01")).data.length, 0);
  await B.admin.put("/api/admin/settings/modules", { donations: true });
  assert.equal((await B.admin.get("/api/admin/ledger/donations")).data.length, 0);
});

test("دور المحاسب: يرى المالية فقط، والصلاحيات تُطبَّق", async () => {
  await A.admin.put("/api/admin/settings/modules", { donations: true, payroll: true });
  // إنشاء حساب محاسب بلا صلاحية اعتماد
  const created = await A.admin.post("/api/admin/users", {
    name: "محاسب المدرسة", username: "acc1", can_approve_finance: false, can_manage_payroll: false, can_manage_accounts: false });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const acc = client(srv.base);
  const login = await acc.post("/api/staff/login", { school: A.id, username: "acc1", password: created.data.credentials.password });
  assert.equal(login.data.role, "accountant");

  // يرى المالية
  assert.equal((await acc.get("/api/accountant/ledger/accounts")).status, 200);
  assert.equal((await acc.get("/api/accountant/finance/invoices")).status, 200);
  // لا يرى بقية أقسام المدرسة
  assert.equal((await acc.get("/api/admin/students")).status, 401, "لا يفتح لوحة الإدارة");
  assert.equal((await acc.get("/api/admin/exams")).status, 401);
  assert.equal((await acc.get("/api/teacher/me")).status, 401);

  // يسجل حركة، لكن لا يعتمدها بلا صلاحية
  const cash = (await acc.get("/api/accountant/ledger/accounts")).data.find((a) => a.kind === "cash");
  const cat = (await acc.get("/api/accountant/ledger/categories")).data.find((c) => c.direction === "expense");
  const entry = await acc.post("/api/accountant/ledger/entries", {
    direction: "expense", amount: 300, account_id: cash.id, category_id: cat.id,
    occurred_on: "2026-09-03", reason: "قرطاسية", method: "cash", needs_approval: true });
  assert.equal(entry.status, 201);
  assert.equal((await acc.post(`/api/accountant/ledger/entries/${entry.data.id}/review`, { decision: "approve" })).status, 403);
  assert.equal((await acc.post("/api/accountant/ledger/payroll", { period: "2026-10-01" })).status, 403, "الرواتب تحتاج صلاحية");

  // المدير يعتمدها
  assert.equal((await A.admin.post(`/api/admin/ledger/entries/${entry.data.id}/review`, { decision: "approve" })).status, 200);

  // منح الصلاحيات ثم إعادة المحاولة
  const listed = (await A.admin.get("/api/admin/users")).data.find((u) => u.username === "acc1");
  assert.equal((await A.admin.patch(`/api/admin/users/${listed.id}/permissions`,
    { can_approve_finance: true, can_manage_payroll: true, can_manage_accounts: true })).status, 200);
  const entry2 = await acc.post("/api/accountant/ledger/entries", {
    direction: "expense", amount: 120, account_id: cash.id, category_id: cat.id,
    occurred_on: "2026-09-04", reason: "مستلزمات", method: "cash", needs_approval: true });
  assert.equal((await acc.post(`/api/accountant/ledger/entries/${entry2.data.id}/review`, { decision: "approve" })).status, 200);

  // المرفقات: صورة فاتورة مع الحركة
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const up = await acc.post(`/api/accountant/ledger/entries/${entry2.data.id}/attachments`,
    { filename: "فاتورة.png", mime: "image/png", data: png });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.ok(up.data.size_bytes > 0);
  assert.equal((await acc.post(`/api/accountant/ledger/entries/${entry2.data.id}/attachments`,
    { filename: "ملف.txt", mime: "text/plain", data: png })).status, 400, "نوع ملف غير مسموح");

  const withFiles = (await acc.get("/api/accountant/ledger/entries?from=2000-01-01&to=2100-01-01")).data
    .find((e) => e.id === entry2.data.id);
  assert.equal(withFiles.attachments.length, 1, "المرفق يظهر مع الحركة");

  // مدرسة أخرى لا تفتح مرفقاتنا
  assert.equal((await B.admin.get(`/api/admin/ledger/attachments/${up.data.id}`)).status, 404);

  // إيقاف الحساب يُخرجه فورًا
  assert.equal((await A.admin.patch(`/api/admin/users/${listed.id}/active`, { active: false })).status, 200);
  assert.equal((await acc.get("/api/accountant/me")).status, 401);

  // مدرسة أخرى لا ترى حسابات محاسبينا
  assert.equal((await B.admin.get("/api/admin/users")).data.length, 0);
});

test("العملات: عملة المدرسة وحساب بعملة أخرى وسعر التحويل", async () => {
  // مدرسة عملتها الريال اليمني
  const tenantC = client(srv.base);
  const created = await owner.post("/api/owner/tenants", { id: `t-${uid()}`, name: "مدرسة بالريال اليمني", currency: "YER", max_students: 10 });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const school = created.data.credentials;
  await tenantC.post("/api/staff/login", { school: school.school, username: "admin", password: school.password });

  const accs = await tenantC.get("/api/admin/ledger/accounts");
  assert.ok(accs.data.length >= 2);
  assert.ok(accs.data.every((a) => a.currency === "YER"), "الحسابات الافتراضية بعملة المدرسة");

  // حساب بالدولار داخل نفس المدرسة
  const usd = await tenantC.post("/api/admin/ledger/accounts", {
    name: "صندوق الدولار", kind: "cash", currency: "USD", opening_balance: 0, methods: [] });
  assert.equal(usd.status, 201, JSON.stringify(usd.data));
  const incomeCat = (await tenantC.get("/api/admin/ledger/categories")).data.find((c) => c.direction === "income");

  // بدون سعر تحويل تُرفض الحركة
  const noRate = await tenantC.post("/api/admin/ledger/entries", {
    direction: "income", amount: 100, account_id: usd.data.id, category_id: incomeCat.id,
    occurred_on: "2026-09-05", reason: "تبرع بالدولار", method: "cash" });
  assert.equal(noRate.status, 400);
  assert.match(noRate.data.error, /سعر تحويل/);

  // مع سعر التحويل: الرصيد بعملة الحساب والتقارير بالعملة الأساسية
  const ok = await tenantC.post("/api/admin/ledger/entries", {
    direction: "income", amount: 100, account_id: usd.data.id, category_id: incomeCat.id,
    occurred_on: "2026-09-05", reason: "تبرع بالدولار", method: "cash", rate: 530 });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));

  const summary = await tenantC.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  assert.equal(summary.data.currency, "YER");
  assert.equal(summary.data.income, 53000, "يُحتسب بالعملة الأساسية");
  const usdAccount = summary.data.accounts.find((a) => a.id === usd.data.id);
  assert.equal(Number(usdAccount.balance), 100, "رصيد الحساب يبقى بعملته");
  assert.equal(summary.data.balance, 0, "الرصيد الإجمالي يجمع العملة الأساسية فقط");

  const entry = (await tenantC.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01")).data[0];
  assert.equal(entry.currency, "USD");
  assert.equal(Number(entry.amount_base), 53000);

  // تغيير عملة المدرسة ممنوع بعد وجود حركات
  assert.equal((await tenantC.put("/api/admin/settings/currency", { currency: "USD" })).status, 400);
});

test("التحويل بين الحسابات: حركتان مرتبطتان ولا يُحتسب إيرادًا", async () => {
  const accounts = (await A.admin.get("/api/admin/ledger/accounts")).data.filter((a) => a.is_active);
  const cash = accounts.find((a) => a.kind === "cash");
  const bank = accounts.find((a) => a.kind === "bank");
  // إيداع مبلغ في الصندوق أولًا حتى يكون فيه رصيد
  const incomeCat = (await A.admin.get("/api/admin/ledger/categories")).data.find((c) => c.direction === "income");
  await A.admin.post("/api/admin/ledger/entries", {
    direction: "income", amount: 2000, account_id: cash.id, category_id: incomeCat.id,
    occurred_on: "2026-09-06", reason: "إيراد نشاط", method: "cash" });

  const fresh = (await A.admin.get("/api/admin/ledger/accounts")).data;
  const cashBalance = Number(fresh.find((a) => a.id === cash.id).balance);
  const bankBalance = Number(fresh.find((a) => a.id === bank.id).balance);
  const before = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");

  // لا تحويل بأكثر من الرصيد
  const tooMuch = await A.admin.post("/api/admin/ledger/transfers", {
    from_account_id: bank.id, to_account_id: cash.id, amount: 999999,
    occurred_on: "2026-09-06", reason: "تجربة" });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.data.error, /لا يكفي/);

  const amount = 500;
  const r = await A.admin.post("/api/admin/ledger/transfers", {
    from_account_id: cash.id, to_account_id: bank.id, amount,
    occurred_on: "2026-09-06", reason: "إيداع نقدية في البنك" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.sent.entry_no, /^F-/);
  assert.match(r.data.received.entry_no, /^F-/);

  const after = await A.admin.get("/api/admin/ledger/summary?from=2000-01-01&to=2100-01-01");
  assert.equal(after.data.income, before.data.income, "التحويل ليس إيرادًا");
  assert.equal(after.data.expense, before.data.expense, "التحويل ليس مصروفًا");
  assert.equal(after.data.balance, before.data.balance, "الرصيد الإجمالي لا يتغير");

  const cashAfter = after.data.accounts.find((a) => a.id === cash.id);
  const bankAfter = after.data.accounts.find((a) => a.id === bank.id);
  assert.equal(Number(cashAfter.balance), cashBalance - amount);
  assert.equal(Number(bankAfter.balance), bankBalance + amount);

  assert.equal((await A.admin.post("/api/admin/ledger/transfers", {
    from_account_id: cash.id, to_account_id: cash.id, amount: 10,
    occurred_on: "2026-09-06", reason: "نفس الحساب" })).status, 400);
});

test("أقسام المنصة: الإيقاف يخفي القسم ويرفضه الخادم، والبيانات تعود عند التشغيل", async () => {
  const S = await makeSchool("مدرسة الأقسام");
  const mods = await S.admin.get("/api/admin/settings/modules");
  assert.equal(mods.status, 200, JSON.stringify(mods.data));
  assert.equal(mods.data.attendance, true);
  assert.equal(mods.data.donations, false, "التبرعات والرواتب اختيارية موقوفة افتراضيًا");

  // القسم يعمل قبل الإيقاف
  assert.equal((await S.admin.get("/api/admin/analytics/alerts")).status, 200);

  // الإيقاف: الخادم يرفض بـ 404 (كأن القسم غير موجود)
  assert.equal((await S.admin.put("/api/admin/settings/modules", { attendance: false, analytics: false })).status, 200);
  assert.equal((await S.admin.get("/api/admin/analytics/alerts")).status, 404);
  assert.equal((await S.admin.post("/api/admin/attendance", { date: "2026-09-10", entries: [] })).status, 404);

  // الأقسام تظهر في /me فتُخفى التبويبات في الواجهة
  const me = await S.admin.get("/api/admin/me");
  assert.equal(me.data.modules.attendance, false);
  assert.equal(me.data.modules.exams, true);

  // المعلم أيضًا يُمنع من القسم الموقوف
  const created = await S.admin.post("/api/admin/teachers", { name: "معلم الأقسام", username: "mod-teacher" });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const tc = client(srv.base);
  await tc.post("/api/staff/login", { school: S.id, username: "mod-teacher", password: created.data.credentials.password });
  await tc.post("/api/teacher/password", { current: created.data.credentials.password, next: "Teacher-Pass-2026" });
  assert.equal((await tc.get("/api/teacher/me")).data.modules.attendance, false);
  assert.equal((await tc.get("/api/teacher/attendance/class/1?date=2026-09-10")).status, 404);

  // قيود منطقية: كشوف الدرجات لا تعمل بدون الاختبارات، والتبرعات بدون المالية
  assert.equal((await S.admin.put("/api/admin/settings/modules", { exams: false })).status, 400, "كشوف الدرجات تحتاج الاختبارات");
  assert.equal((await S.admin.put("/api/admin/settings/modules", { finance: false, donations: true })).status, 400);

  // التشغيل من جديد يعيد القسم كما كان
  assert.equal((await S.admin.put("/api/admin/settings/modules", { attendance: true, analytics: true })).status, 200);
  assert.equal((await S.admin.get("/api/admin/analytics/alerts")).status, 200);
});

test("الاستيراد من ملف: قالب جاهز، تحقق كامل، واستيراد كامل أو لا شيء", async () => {
  const S = await makeSchool("مدرسة الاستيراد");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 50 });

  const kinds = await S.admin.get("/api/admin/import/kinds");
  assert.equal(kinds.status, 200);
  assert.ok(kinds.data.some((k) => k.key === "students" && k.columns.some((c) => c.required)));

  // القالب يُنزَّل بصيغة CSV وفيه العناوين العربية
  const cookie = [...S.admin.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const tpl = await fetch(`${srv.base}/api/admin/import/template/students`, { headers: { cookie } });
  assert.equal(tpl.status, 200);
  const body = await tpl.text();
  assert.ok(body.includes("اسم الطالب"), "القالب يحوي عناوين الأعمدة");

  // الفصول أولًا
  const classes = await S.admin.post("/api/admin/import/classes", {
    rows: [{ "اسم الفصل": "الأول - أ" }, { "اسم الفصل": "الأول - ب" }] });
  assert.equal(classes.status, 200, JSON.stringify(classes.data));
  assert.equal(classes.data.created, 2);
  // التكرار يُرفض
  assert.equal((await S.admin.post("/api/admin/import/classes", { rows: [{ "اسم الفصل": "الأول - أ" }] })).status, 400);

  // الطلاب: سطر بفصل غير موجود يُبطل الملف كله
  const bad = await S.admin.post("/api/admin/import/students", { rows: [
    { "اسم الطالب": "طالب أول", "الفصل": "الأول - أ" },
    { "اسم الطالب": "طالب ثانٍ", "الفصل": "فصل غير موجود" }] });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.some((e) => /غير موجود/.test(e.message)));
  assert.equal((await S.admin.get("/api/admin/students")).data.length, 0, "لم يُستورد شيء");

  // سطر بلا اسم يُرفض مع رقم السطر
  const noName = await S.admin.post("/api/admin/import/students", { rows: [{ "اسم الطالب": "", "الفصل": "الأول - أ" }] });
  assert.equal(noName.status, 400);
  assert.equal(noName.data.errors[0].row, 2);

  // استيراد صحيح: اسم ولي الأمر يُستنتج والجوال يُوحَّد
  const ok = await S.admin.post("/api/admin/import/students", { rows: [
    { "اسم الطالب": "محمد عبدالله سالم", "الفصل": "الأول - أ", "جوال ولي الأمر": "+966 50 111 2233", "الرسوم (نعم/لا)": "نعم" },
    { "اسم الطالب": "ريم عبدالله سالم", "الفصل": "الأول - ب" }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.created, 2);
  const list = (await S.admin.get("/api/admin/students")).data;
  const first = list.find((x) => x.name === "محمد عبدالله سالم");
  assert.equal(first.guardian_name, "عبدالله سالم", "اسم ولي الأمر من اسم الطالب");
  assert.equal(first.guardian_phone, "+966501112233", "توحيد صيغة الجوال");
  assert.equal(first.fees_enabled, true);

  // المعلمون: كلمات مرور مؤقتة تعود مرة واحدة، والمستخدم المكرر يُرفض
  const teachers = await S.admin.post("/api/admin/import/teachers", { rows: [
    { "اسم المعلم": "أحمد سعيد", "اسم المستخدم (إنجليزي)": "ahmad-i", "الجوال": "0500000010" },
    { "اسم المعلم": "نورة خالد", "اسم المستخدم (إنجليزي)": "noura-i" }] });
  assert.equal(teachers.status, 200, JSON.stringify(teachers.data));
  assert.equal(teachers.data.created, 2);
  assert.ok(teachers.data.rows.every((t) => t.password && t.username));
  assert.equal((await S.admin.post("/api/admin/import/teachers", {
    rows: [{ "اسم المعلم": "مكرر", "اسم المستخدم (إنجليزي)": "ahmad-i" }] })).status, 400);

  // المعلم المستورد يدخل بكلمته المؤقتة ويُطلب منه تغييرها
  const tc = client(srv.base);
  const login = await tc.post("/api/staff/login", { school: S.id, username: "ahmad-i", password: teachers.data.rows[0].password });
  assert.equal(login.data.role, "teacher");
  assert.equal((await tc.get("/api/teacher/me")).data.must_change_password, true);

  // حد الباقة يُحترم في الاستيراد
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 2 });
  assert.equal((await S.admin.post("/api/admin/import/students", {
    rows: [{ "اسم الطالب": "طالب زائد", "الفصل": "الأول - أ" }] })).status, 400, "حد الباقة يمنع الاستيراد");
});

test("الاشتراك: تفاصيله للمدرسة، وطلب التجديد يصل للمالك", async () => {
  const sub = await A.admin.get("/api/admin/settings/subscription");
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  assert.ok(sub.data.subscription.name);
  assert.equal(typeof sub.data.subscription.students, "number");
  assert.ok(Array.isArray(sub.data.requests));

  // إعدادات الدعم من لوحة المالك تظهر للمدرسة
  await owner.put("/api/owner/settings", { support_whatsapp: "0591757224", support_note: "للدعم والتجديد" });
  const withSupport = await A.admin.get("/api/admin/settings/subscription");
  assert.equal(withSupport.data.support.support_whatsapp, "0591757224");

  const req = await A.admin.post("/api/admin/settings/subscription/renew", {
    kind: "renew", months: 12, contact_name: "مدير المدرسة", contact_phone: "0500000000", note: "تجديد سنة" });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  assert.equal(req.data.status, "new");
  // لا يُكرر الطلب نفسه قبل الرد
  assert.equal((await A.admin.post("/api/admin/settings/subscription/renew", { kind: "renew", months: 12 })).status, 400);

  // المدرسة ترى طلبها فقط
  const mine = await A.admin.get("/api/admin/settings/subscription");
  assert.equal(mine.data.requests[0].kind, "renew");
  assert.equal((await B.admin.get("/api/admin/settings/subscription")).data.requests.length, 0);

  // المالك يراه ويردّ عليه
  const list = await owner.get("/api/owner/renewals");
  const found = list.data.find((x) => x.id === req.data.id);
  assert.ok(found, "الطلب يظهر للمالك");
  assert.equal(found.school_name, "مدرسة اختبار أ");
  assert.equal(found.months, 12);
  assert.equal((await A.admin.get("/api/owner/renewals")).status, 401, "المدرسة لا تفتح لوحة المالك");

  assert.equal((await owner.patch(`/api/owner/renewals/${req.data.id}`,
    { status: "done", owner_note: "جُدد الاشتراك سنة" })).status, 200);
  const after = await A.admin.get("/api/admin/settings/subscription");
  assert.equal(after.data.requests[0].status, "done");
  assert.equal(after.data.requests[0].owner_note, "جُدد الاشتراك سنة");
});

test("الأرقام الدولية: أي دولة تُقبل ورابط واتساب يُبنى صحيحًا", async () => {
  const { normalizePhone } = await import("../src/modules/shared/students.service.js");
  assert.equal(normalizePhone("+967 77 123 4567"), "+967771234567");
  assert.equal(normalizePhone("00967771234567"), "+967771234567");
  assert.equal(normalizePhone("0771234567"), "0771234567", "المحلي يبقى كما هو");
  assert.equal(normalizePhone("  "), null);

  const yemeni = await A.admin.post("/api/admin/students", { name: "طالب يمني", guardian_phone: "+967 77 111 2233" });
  assert.equal(yemeni.status, 201, JSON.stringify(yemeni.data));
  assert.equal(yemeni.data.guardian_phone, "+967771112233");
  await A.admin.post(`/api/admin/students/${yemeni.data.id}/status`, { status: "withdrawn" });
});

test("أوراق الطباعة: بطاقات المعرّفات وسجل الحضور الشهري", async () => {
  const cards = await A.admin.get("/api/admin/sheets/cards");
  assert.equal(cards.status, 200, JSON.stringify(cards.data));
  assert.ok(cards.data.school && cards.data.directory_code);
  assert.ok(cards.data.students.every((s) => s.name && s.access_key), "كل بطاقة فيها الاسم والمعرّف");

  const byClass = await A.admin.get(`/api/admin/sheets/cards?class_id=${s.classId}`);
  assert.ok(byClass.data.students.length <= cards.data.students.length);
  assert.ok(byClass.data.students.every((x) => x.class_name));

  const month = new Date().toISOString().slice(0, 7);
  const sheet = await A.admin.get(`/api/admin/sheets/attendance-month?class_id=${s.classId}&month=${month}`);
  assert.equal(sheet.status, 200, JSON.stringify(sheet.data));
  assert.ok(sheet.data.days >= 28 && sheet.data.days <= 31);
  assert.ok(sheet.data.students.every((x) => typeof x.absent === "number" && "days" in x));
  assert.equal((await A.admin.get(`/api/admin/sheets/attendance-month?class_id=${s.classId}&month=2026-13`)).status, 400);

  // مدرسة أخرى لا ترى فصولنا
  assert.equal((await B.admin.get(`/api/admin/sheets/attendance-month?class_id=${s.classId}&month=${month}`)).status, 404);
  assert.equal((await B.admin.get("/api/admin/sheets/cards")).data.students.length, 0);
});

test("سجل العمليات: تصفية بالقسم والنوع والتاريخ والبحث", async () => {
  const filters = await A.admin.get("/api/admin/audit/filters");
  assert.equal(filters.status, 200);
  assert.ok(filters.data.tables.some((x) => x.key === "students"));

  const all = await A.admin.get("/api/admin/audit");
  assert.ok(all.data.length > 0);

  const students = await A.admin.get("/api/admin/audit?table=students");
  assert.ok(students.data.length > 0);
  assert.ok(students.data.every((x) => /الطلاب/.test(x.summary)), "التصفية بالقسم تعمل");

  const inserts = await A.admin.get("/api/admin/audit?table=students&action=insert");
  assert.ok(inserts.data.every((x) => /إضافة/.test(x.summary)));

  const future = await A.admin.get("/api/admin/audit?from=2099-01-01");
  assert.equal(future.data.length, 0, "التصفية بالتاريخ تعمل");

  const found = await A.admin.get(`/api/admin/audit?q=${encodeURIComponent("طالب الاختبار")}`);
  assert.ok(found.data.length > 0, "البحث في القيم يعمل");

  // السجل لا يتجاوز المدرسة
  const other = await B.admin.get(`/api/admin/audit?q=${encodeURIComponent("طالب الاختبار")}`);
  assert.equal(other.data.length, 0);
});

test("معالج الإعداد: قالب ينشئ المراحل والصفوف والشعب والمواد، وكلها قابلة للتعديل", async () => {
  const S = await makeSchool("مدرسة الهيكل");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 500 });

  const state = await S.admin.get("/api/admin/setup");
  assert.equal(state.status, 200, JSON.stringify(state.data));
  assert.equal(state.data.profile.setup_completed_at, null, "مدرسة جديدة = الإعداد لم يكتمل");
  assert.ok(state.data.catalog.templates.some((x) => x.key === "primary"));
  assert.equal(state.data.structure.stages.length, 0);

  // بيانات المدرسة
  const profile = await S.admin.put("/api/admin/setup/profile", {
    name: "مدرسة الهيكل النموذجية", school_type: "private", gender: "boys",
    country: "السعودية", city: "الرياض", email: "info@example.com", phone: "0500000000" });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.city, "الرياض");
  assert.equal(profile.data.name, "مدرسة الهيكل النموذجية");

  // تطبيق قالب ابتدائي: 6 صفوف × 3 شعب + المواد المختارة
  const applied = await S.admin.post("/api/admin/setup/template", {
    template: "primary", sections_per_grade: 3, naming: "arabic",
    subjects: ["اللغة العربية", "الرياضيات", "العلوم"] });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.stages, 1);
  assert.equal(applied.data.grades, 6);
  assert.equal(applied.data.sections, 18, "6 صفوف × 3 شعب");
  assert.equal(applied.data.subjects, 3, "المواد المختارة فقط");

  const after = (await S.admin.get("/api/admin/setup")).data.structure;
  assert.equal(after.stages.length, 1);
  const grade1 = after.stages[0].grades[0];
  assert.equal(grade1.sections.length, 3);
  assert.match(grade1.sections[0].name, /- أ$/, "تسمية الشعب بالحروف العربية");
  assert.ok(after.subjects.every((x) => x.grade_ids.length === 6), "المواد مرتبطة بصفوف المرحلة");

  // إعادة تطبيق القالب لا تكرر شيئًا
  const again = await S.admin.post("/api/admin/setup/template", {
    template: "primary", sections_per_grade: 3, naming: "arabic" });
  assert.equal(again.data.grades, 0, "لا تكرار للصفوف");
  assert.equal(again.data.sections, 0, "لا تكرار للشعب");

  // إنشاء شعب إضافية بنمط إنجليزي
  const more = await S.admin.post(`/api/admin/setup/grades/${grade1.id}/sections`, { count: 2, naming: "english" });
  assert.equal(more.data.created, 2);
  assert.match(more.data.sections[0].name, /- A$/);

  // تعديل وحذف وترتيب
  assert.equal((await S.admin.patch(`/api/admin/setup/grades/${grade1.id}`, { name: "الصف الأول" })).status, 200);
  const stage = (await S.admin.get("/api/admin/setup")).data.structure.stages[0];
  const ids = stage.grades.map((g) => g.id);
  assert.equal((await S.admin.post(`/api/admin/setup/stages/${stage.id}/reorder`,
    { ids: [ids[1], ids[0], ...ids.slice(2)] })).status, 200);
  const reordered = (await S.admin.get("/api/admin/setup")).data.structure.stages[0];
  assert.equal(Number(reordered.grades[0].id), Number(ids[1]), "الترتيب تغيّر");

  const lastGrade = reordered.grades[reordered.grades.length - 1];
  const delRes = await S.admin.del(`/api/admin/setup/grades/${lastGrade.id}`);
  assert.equal(delRes.status, 200, JSON.stringify(delRes.data));

  // صف فيه طلاب لا يُحذف
  const section = reordered.grades[0].sections[0];
  await S.admin.post("/api/admin/students", { name: "طالب الهيكل", class_id: section.id });
  assert.equal((await S.admin.del(`/api/admin/setup/grades/${reordered.grades[0].id}`)).status, 400);

  // مادة جديدة وربطها بصفوف
  const subject = await S.admin.post("/api/admin/setup/subjects", {
    name: "المهارات الحياتية", code: "LIF", weekly_periods: 2, grade_ids: [reordered.grades[0].id] });
  assert.equal(subject.status, 201, JSON.stringify(subject.data));
  const withSubject = (await S.admin.get("/api/admin/setup")).data.structure.subjects
    .find((x) => x.name === "المهارات الحياتية");
  assert.equal(withSubject.grade_ids.length, 1);
  assert.equal((await S.admin.post("/api/admin/setup/subjects", { name: "المهارات الحياتية" })).status, 409);

  // إنهاء الإعداد
  assert.equal((await S.admin.post("/api/admin/setup/complete", {})).status, 200);
  assert.ok((await S.admin.get("/api/admin/me")).data.setup_completed);

  // العزل
  assert.equal((await B.admin.get("/api/admin/setup")).data.structure.stages.length, 0);
});

test("قوالب الرسوم: تقسيط تلقائي وخصومات وإعفاء، ولا تكرار عند إعادة التطبيق", async () => {
  const S = await makeSchool("مدرسة الرسوم");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 100 });
  await S.admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 1, naming: "arabic" });
  const structure = (await S.admin.get("/api/admin/setup")).data.structure;
  const grade = structure.stages[0].grades[0];
  const section = grade.sections[0];

  const a = await S.admin.post("/api/admin/students", { name: "طالب أول", class_id: section.id });
  const bStudent = await S.admin.post("/api/admin/students", { name: "طالب ثانٍ", class_id: section.id });
  const cStudent = await S.admin.post("/api/admin/students", { name: "طالب معفى", class_id: section.id });

  // قالب: 5000 على 4 دفعات
  const plan = await S.admin.post("/api/admin/finance/plans", {
    name: "رسوم الأول الابتدائي", grade_id: grade.id, amount: 5000, installments: 4,
    first_due: "2026-09-01", interval_months: 2 });
  assert.equal(plan.status, 201, JSON.stringify(plan.data));
  assert.equal((await S.admin.post("/api/admin/finance/plans", { name: "رسوم الأول الابتدائي", amount: 100 })).status, 409);

  // خصم 20% للثاني، وإعفاء كامل للثالث
  assert.equal((await S.admin.post("/api/admin/finance/adjustments",
    { student_id: bStudent.data.id, kind: "discount", percent: 20, note: "أخ ثانٍ" })).status, 201);
  assert.equal((await S.admin.post("/api/admin/finance/adjustments",
    { student_id: cStudent.data.id, kind: "exemption", note: "حالة خاصة" })).status, 201);

  // معاينة قبل التطبيق
  const preview = await S.admin.post(`/api/admin/finance/plans/${plan.data.id}/apply`, { dry_run: true });
  assert.equal(preview.data.students, 3);
  assert.equal(preview.data.invoices, 0, "المعاينة لا تنشئ شيئًا");
  const previewB = preview.data.preview.find((x) => x.student_id === bStudent.data.id);
  assert.equal(previewB.total, 4000, "خصم 20٪");
  assert.equal(previewB.per_installment, 1000);
  assert.equal(preview.data.preview.find((x) => x.student_id === cStudent.data.id).total, 0);

  // التطبيق الفعلي
  const applied = await S.admin.post(`/api/admin/finance/plans/${plan.data.id}/apply`, {});
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.invoices, 8, "طالبان × 4 دفعات، والمعفى بلا فواتير");

  const invoices = (await S.admin.get("/api/admin/finance/invoices")).data.invoices;
  const mine = invoices.filter((i) => i.student_id === a.data.id);
  assert.equal(mine.length, 4);
  assert.equal(mine.reduce((sum, i) => sum + Number(i.amount), 0), 5000, "مجموع الدفعات = الرسوم");
  assert.ok(mine.some((i) => /دفعة 1 من 4/.test(i.title)));
  const dues = mine.map((i) => i.due_date).sort();
  assert.equal(dues[0], "2026-09-01");
  assert.equal(dues[3], "2027-03-01", "كل دفعة بعد شهرين");

  // إعادة التطبيق لا تكرر
  const again = await S.admin.post(`/api/admin/finance/plans/${plan.data.id}/apply`, {});
  assert.equal(again.data.invoices, 0);

  // طالب جديد في نفس الصف يأخذ الفواتير عند إعادة التطبيق
  const late = await S.admin.post("/api/admin/students", { name: "طالب متأخر", class_id: section.id });
  const third = await S.admin.post(`/api/admin/finance/plans/${plan.data.id}/apply`, {});
  assert.equal(third.data.invoices, 4);
  assert.ok((await S.admin.get("/api/admin/finance/invoices")).data.invoices.some((i) => i.student_id === late.data.id));
});

test("الإجراءات الجماعية على الطلاب", async () => {
  const S = await makeSchool("مدرسة الإجراءات");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 100 });
  await S.admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 2, naming: "arabic" });
  const grade = (await S.admin.get("/api/admin/setup")).data.structure.stages[0].grades[0];
  const [first, second] = grade.sections;

  const ids = [];
  for (const name of ["طالب أ", "طالب ب", "طالب ج"]) {
    ids.push((await S.admin.post("/api/admin/students", { name, class_id: first.id })).data.id);
  }

  // نقل جماعي لشعبة أخرى
  const moved = await S.admin.post("/api/admin/students/bulk", { ids, action: "move_class", class_id: second.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.done, 3);
  const list = (await S.admin.get("/api/admin/students")).data;
  assert.ok(ids.every((id) => Number(list.find((x) => x.id === id).class_id) === Number(second.id)));

  // تفعيل الرسوم جماعيًا
  assert.equal((await S.admin.post("/api/admin/students/bulk",
    { ids, action: "fees", fees_enabled: true })).data.done, 3);
  assert.ok((await S.admin.get("/api/admin/students")).data.filter((x) => ids.includes(x.id)).every((x) => x.fees_enabled));

  // تغيير الحالة جماعيًا
  assert.equal((await S.admin.post("/api/admin/students/bulk",
    { ids: ids.slice(0, 2), action: "status", status: "transferred", note: "نقل جماعي" })).data.done, 2);
  const after = (await S.admin.get("/api/admin/students")).data;
  assert.equal(after.filter((x) => ids.includes(x.id)).length, 1, "المنقولون خرجوا من القائمة النشطة");

  // التحقق من المدخلات
  assert.equal((await S.admin.post("/api/admin/students/bulk", { ids: [], action: "fees", fees_enabled: true })).status, 400);
  assert.equal((await S.admin.post("/api/admin/students/bulk",
    { ids, action: "move_class", class_id: 999999 })).status, 404);
  // لا تتجاوز المدرسة حدودها
  assert.equal((await B.admin.post("/api/admin/students/bulk",
    { ids, action: "fees", fees_enabled: true })).data.done, 0);
});

test("توليد الجدول: مسودة بلا تعارض، لا تُحفظ إلا بموافقة المدير", async () => {
  const S = await makeSchool("مدرسة الجدول");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 100 });
  await S.admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 2, naming: "arabic" });
  const structure = (await S.admin.get("/api/admin/setup")).data.structure;
  const grade = structure.stages[0].grades[0];
  const sections = grade.sections;
  const subjects = structure.subjects.filter((x) => x.grade_ids.includes(Number(grade.id)));

  // معلم واحد لمادتين في الشعبتين
  const teacher = await S.admin.post("/api/admin/teachers", { name: "معلم الجدول", username: "tt-teacher" });
  assert.equal(teacher.status, 201, JSON.stringify(teacher.data));
  const items = sections.flatMap((c) => subjects.slice(0, 2).map((sub) => ({
    class_id: c.id, subject_id: sub.id, teacher_id: teacher.data.id })));
  assert.equal((await S.admin.post("/api/admin/teachers/assignments/bulk", { items })).data.saved, items.length);

  // إعدادات الجدول
  const settings = await S.admin.put("/api/admin/timetable/settings", {
    days: [0, 1, 2, 3, 4], periods_per_day: 6, start_time: "07:30", period_minutes: 45, break_after: 3, break_minutes: 20 });
  assert.equal(settings.status, 200, JSON.stringify(settings.data));

  const timesRes = await S.admin.get("/api/admin/timetable/settings");
  assert.equal(timesRes.data.times.length, 6);
  assert.equal(timesRes.data.times[0].from, "07:30");
  assert.equal(timesRes.data.times[1].from, "08:15", "الحصة الثانية بعد 45 دقيقة");
  assert.equal(timesRes.data.times[3].from, "10:05", "الفسحة 20 دقيقة بعد الحصة الثالثة");

  // التوليد: مسودة فقط
  const draft = await S.admin.post("/api/admin/timetable/generate", { class_ids: sections.map((c) => c.id) });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.ok(draft.data.slots.length > 0, "وُزّعت حصص");
  assert.equal((await S.admin.get(`/api/admin/timetable?class_id=${sections[0].id}`)).data.length, 0,
    "المسودة لا تُحفظ قبل الموافقة");

  // لا تعارض داخل المسودة: معلم واحد في وقت واحد، وشعبة واحدة في وقت واحد
  const teacherSlots = draft.data.slots.filter((x) => x.teacher_id).map((x) => `${x.teacher_id}:${x.day}:${x.period}`);
  assert.equal(new Set(teacherSlots).size, teacherSlots.length, "لا معلم في فصلين بنفس الوقت");
  const classSlots = draft.data.slots.map((x) => `${x.class_id}:${x.day}:${x.period}`);
  assert.equal(new Set(classSlots).size, classSlots.length, "لا شعبة بحصتين بنفس الوقت");
  assert.ok(draft.data.slots.every((x) => x.period <= 6), "ضمن عدد الحصص اليومية");

  // الاعتماد
  const applied = await S.admin.post("/api/admin/timetable/apply", {
    slots: draft.data.slots.map(({ class_id, day, period, subject_id, teacher_id }) =>
      ({ class_id, day, period, subject_id, teacher_id })), replace: true });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.saved, draft.data.slots.length);
  assert.ok((await S.admin.get(`/api/admin/timetable?class_id=${sections[0].id}`)).data.length > 0);

  // الجدول المعتمد بلا تعارضات
  const conflicts = await S.admin.get("/api/admin/timetable/conflicts");
  assert.equal(conflicts.data.teacher.length, 0);
  assert.equal(conflicts.data.room.length, 0);

  // إعادة التوليد بعد الاعتماد لا تتعارض مع الشعب الأخرى
  const second = await S.admin.post("/api/admin/timetable/generate", { class_ids: [sections[0].id], replace: true });
  assert.ok(second.data.slots.every((x) => x.class_id === sections[0].id));

  // العزل
  assert.equal((await B.admin.post("/api/admin/timetable/generate", { class_ids: sections.map((c) => c.id) })).status, 400);
});

test("النسخ والتكرار: مواد صف، قالب رسوم، وجدول شعبة", async () => {
  const S = await makeSchool("مدرسة النسخ");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 100 });
  await S.admin.post("/api/admin/setup/template", { template: "primary", sections_per_grade: 2, naming: "arabic" });
  const st = (await S.admin.get("/api/admin/setup")).data.structure;
  const [g1, g2] = st.stages[0].grades;
  const [c1, c2] = g1.sections;

  // نسخ مواد صف إلى صف: نفرغ الهدف أولًا ثم ننسخ
  const before = (await S.admin.get("/api/admin/setup")).data.structure.subjects
    .filter((x) => x.grade_ids.includes(Number(g1.id))).length;
  const copied = await S.admin.post(`/api/admin/setup/grades/${g1.id}/copy-subjects`,
    { to_grade_id: g2.id, replace: true });
  assert.equal(copied.status, 200, JSON.stringify(copied.data));
  assert.equal(copied.data.copied, before, "نُسخت كل مواد الصف");
  // إعادة النسخ بلا تكرار
  assert.equal((await S.admin.post(`/api/admin/setup/grades/${g1.id}/copy-subjects`, { to_grade_id: g2.id })).data.copied, 0);

  // نسخ قالب رسوم
  const plan = await S.admin.post("/api/admin/finance/plans", { name: "رسوم الأول", grade_id: g1.id, amount: 4000, installments: 2 });
  const clone = await S.admin.post(`/api/admin/finance/plans/${plan.data.id}/copy`, { name: "رسوم الثاني", grade_id: g2.id });
  assert.equal(clone.status, 201, JSON.stringify(clone.data));
  const plans = (await S.admin.get("/api/admin/finance/plans")).data;
  const copiedPlan = plans.find((p) => p.name === "رسوم الثاني");
  assert.equal(Number(copiedPlan.amount), 4000);
  assert.equal(copiedPlan.installments, 2);
  assert.equal(Number(copiedPlan.grade_id), Number(g2.id));

  // نسخ جدول شعبة إلى شعبة: المعلم المشغول تُترك حصته بلا معلم
  const teacher = await S.admin.post("/api/admin/teachers", { name: "معلم النسخ", username: "copy-teacher" });
  const subject = (await S.admin.get("/api/admin/setup")).data.structure.subjects[0];
  await S.admin.post("/api/admin/teachers/assignments/bulk",
    { items: [{ class_id: c1.id, subject_id: subject.id, teacher_id: teacher.data.id }] });
  await S.admin.put("/api/admin/timetable/slot",
    { class_id: c1.id, day: 0, period: 1, subject_id: subject.id, teacher_id: teacher.data.id });

  const copyRes = await S.admin.post("/api/admin/timetable/copy",
    { from_class_id: c1.id, to_class_id: c2.id, keep_teachers: true });
  assert.equal(copyRes.status, 200, JSON.stringify(copyRes.data));
  assert.equal(copyRes.data.copied, 1);
  assert.equal(copyRes.data.without_teacher, 1, "المعلم مشغول في نفس الوقت فتُركت بلا معلم");
  const target = (await S.admin.get(`/api/admin/timetable?class_id=${c2.id}`)).data;
  assert.equal(target.length, 1);
  assert.equal(target[0].teacher_id, null);
  assert.equal(Number(target[0].subject_id), Number(subject.id));

  // العزل
  assert.equal((await B.admin.post(`/api/admin/setup/grades/${g1.id}/copy-subjects`, { to_grade_id: g2.id })).status, 404);
});

test("تغيير كلمة المرور: طلب ← تحقق الإدارة ← اعتماد المالك ← رابط لمرة واحدة", async () => {
  const S = await makeSchool("مدرسة كلمات المرور");
  const teacher = await S.admin.post("/api/admin/teachers", { name: "معلم النسيان", username: "forgot-teacher" });
  assert.equal(teacher.status, 201, JSON.stringify(teacher.data));

  // 1) الطلب من بوابة المدرسة بلا تسجيل دخول
  const anon = client(srv.base);
  const submitted = await anon.post(`/api/public/${S.id}/password-request`, {
    full_name: "معلم النسيان", username: "forgot-teacher", phone: "0500000123",
    job_title: "teacher", description: "نسيت كلمة المرور بعد الإجازة", contact_pref: "whatsapp" });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  assert.match(submitted.data.ref, /^PR-\d{4}-[A-Z0-9]{5}$/);
  assert.equal(submitted.data.token, undefined, "لا يُعاد أي رمز للمستخدم");

  // الطلب يصل لإدارة المدرسة فقط
  const list = await S.admin.get("/api/admin/password-requests");
  const request = list.data.find((x) => x.ref === submitted.data.ref);
  assert.equal(request.status, "new");
  assert.equal(request.token_hash, undefined, "تجزئة الرمز لا تُعاد للواجهة");
  assert.equal((await B.admin.get("/api/admin/password-requests")).data.length, 0, "مدرسة أخرى لا تراه");

  // 2) المالك لا يرى الطلب قبل إحالته
  assert.equal((await owner.get("/api/owner/password-requests")).data.some((x) => x.ref === request.ref), false);
  assert.equal((await owner.post(`/api/owner/password-requests/${request.id}/review`, { decision: "approve" })).status, 400);

  // 3) الإدارة تتحقق وتحيل
  const referred = await S.admin.post(`/api/admin/password-requests/${request.id}/review`,
    { decision: "refer", note: "تحققت من هويته هاتفيًا" });
  assert.equal(referred.status, 200, JSON.stringify(referred.data));
  assert.equal(referred.data.matched_account, true);
  assert.equal((await S.admin.post(`/api/admin/password-requests/${request.id}/review`, { decision: "refer" })).status, 400,
    "لا تُعاد المراجعة مرتين");

  // 4) المالك يعتمد فيصدر الرابط مرة واحدة
  const approved = await owner.post(`/api/owner/password-requests/${request.id}/review`,
    { decision: "approve", note: "اعتُمد" });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.match(approved.data.link, /\/reset\?token=[0-9a-f]{64}$/);
  const token = approved.data.link.split("token=")[1];

  // 5) صفحة التغيير تتحقق من الرابط
  const check = await anon.get(`/api/public/password-reset/check?token=${token}`);
  assert.equal(check.status, 200, JSON.stringify(check.data));
  assert.equal((await anon.get(`/api/public/password-reset/check?token=${"a".repeat(64)}`)).status, 404);

  // كلمة مرور ضعيفة تُرفض
  assert.equal((await anon.post("/api/public/password-reset", { token, password: "123" })).status, 400);

  const done = await anon.post("/api/public/password-reset", { token, password: "Forgot-Pass-2026" });
  assert.equal(done.status, 200, JSON.stringify(done.data));

  // 6) الرابط لا يُستخدم مرتين، والحساب يعمل بكلمة المرور الجديدة بلا إجبار تغيير
  assert.equal((await anon.post("/api/public/password-reset", { token, password: "Another-Pass-2026" })).status, 404);
  const tc = client(srv.base);
  const login = await tc.post("/api/staff/login", { school: S.id, username: "forgot-teacher", password: "Forgot-Pass-2026" });
  assert.equal(login.data.role, "teacher");
  assert.equal((await tc.get("/api/teacher/me")).data.must_change_password, false);

  const closed = (await S.admin.get("/api/admin/password-requests")).data.find((x) => x.ref === request.ref);
  assert.equal(closed.status, "used");
  assert.ok(closed.used_at);
});

test("الحقول المخصصة: تعريفها وقيمها وتحققها وظهورها لولي الأمر", async () => {
  const S = await makeSchool("مدرسة الحقول");
  await owner.patch(`/api/owner/tenants/${S.id}`, { max_students: 50 });

  // حقول بأنواع مختلفة
  const bus = await S.admin.post("/api/admin/custom-fields", {
    entity: "student", label: "رقم الحافلة", type: "number", required: false, show_parent: true });
  assert.equal(bus.status, 201, JSON.stringify(bus.data));
  assert.match(bus.data.key, /^[a-z][a-z0-9_]*$/, "مفتاح إنجليزي يُشتق تلقائيًا");

  const health = await S.admin.post("/api/admin/custom-fields", {
    entity: "student", label: "الحالة الصحية", type: "select",
    options: ["سليم", "يحتاج متابعة", "حساسية"], required: true, show_parent: false });
  assert.equal(health.status, 201);
  assert.equal((await S.admin.post("/api/admin/custom-fields",
    { entity: "student", label: "الحالة الصحية", type: "text" })).status, 409, "لا تكرار للاسم");
  assert.equal((await S.admin.post("/api/admin/custom-fields",
    { entity: "student", label: "بلا خيارات", type: "select" })).status, 400, "قائمة بلا خيارات تُرفض");

  const student = await S.admin.post("/api/admin/students", { name: "طالب الحقول" });
  const url = `/api/admin/custom-fields/values/student/${student.data.id}`;

  // الحقل المطلوب يُفرض
  assert.equal((await S.admin.put(url, { values: { [bus.data.key]: "12" } })).status, 400);
  // نوع خاطئ يُرفض
  assert.equal((await S.admin.put(url, {
    values: { [bus.data.key]: "ليس رقمًا", [health.data.key]: "سليم" } })).status, 400);
  // قيمة خارج القائمة تُرفض
  assert.equal((await S.admin.put(url, {
    values: { [bus.data.key]: "12", [health.data.key]: "قيمة غريبة" } })).status, 400);

  const saved = await S.admin.put(url, { values: { [bus.data.key]: "12", [health.data.key]: "يحتاج متابعة" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const values = await S.admin.get(url);
  assert.equal(values.data[bus.data.key], "12");
  assert.equal(values.data[health.data.key], "يحتاج متابعة");

  // ولي الأمر يرى ما فعّلته المدرسة فقط
  const anon = client(srv.base);
  const code = (await S.admin.get("/api/admin/me")).data.school.directory_code;
  const key = (await S.admin.get("/api/admin/students")).data.find((x) => x.id === student.data.id).access_key;
  await anon.post(`/api/public/${S.id}/page`, { access: code });
  const profile = await anon.post(`/api/public/${S.id}/student`, { student_id: student.data.id, key });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  const labels = profile.data.custom.map((x) => x.label);
  assert.ok(labels.includes("رقم الحافلة"), "الحقل المفعّل لولي الأمر يظهر");
  assert.ok(!labels.includes("الحالة الصحية"), "الحقل غير المفعّل لا يظهر");

  // الحذف يزيل الحقل وقيمه
  assert.equal((await S.admin.del(`/api/admin/custom-fields/${bus.data.id}`)).status, 200);
  assert.equal((await S.admin.get(url)).data[bus.data.key], undefined);

  // العزل
  assert.equal((await B.admin.get("/api/admin/custom-fields")).data.length, 0);
});

test("مركز التنبيهات: مستويات مرتبة ووجهة لكل تنبيه", async () => {
  const n = await A.admin.get("/api/admin/analytics/notifications");
  assert.equal(n.status, 200, JSON.stringify(n.data));
  assert.ok(Array.isArray(n.data.items));
  assert.ok(n.data.items.every((x) => ["urgent", "action", "info"].includes(x.level)), "كل تنبيه له مستوى");
  assert.ok(n.data.items.every((x) => x.count > 0 && x.text && x.tab), "كل تنبيه له عدد ونص ووجهة");
  for (const key of ["urgent", "action", "info"]) assert.equal(typeof n.data.counts[key], "number");

  // مدرسة فارغة: لا تنبيهات عاجلة
  const S = await makeSchool("مدرسة بلا تنبيهات");
  const fresh = await S.admin.get("/api/admin/analytics/notifications");
  assert.equal(fresh.data.items.filter((x) => x.level === "urgent").length, 0);
});

test("تصدير بيانات المدرسة يشمل كل الأقسام ولا يتجاوزها", async () => {
  const r = await A.admin.get("/api/admin/export");
  assert.equal(r.status, 200);
  for (const k of ["students", "classes", "attendance", "exams", "invoices", "payments", "timetable"]) {
    assert.ok(Array.isArray(r.data[k]), k);
  }
  assert.ok(r.data.students.every((x) => x.name), "بيانات الطلاب موجودة");
  const b = await B.admin.get("/api/admin/export");
  assert.equal(b.data.students.length, 0, "تصدير مدرسة ب لا يحوي طلاب مدرسة أ");
});

test("إيقاف المدرسة يُخرج مستخدميها فورًا", async () => {
  assert.equal((await owner.patch(`/api/owner/tenants/${B.id}`, { status: "suspended" })).status, 200);
  assert.equal((await B.admin.get("/api/admin/me")).status, 401);
  assert.equal((await client(srv.base).post(`/api/public/${B.id}/directory`, { access: B.directory })).status, 404);
});

test("التحليلات والتنبيهات والبحث السريع", async () => {
  const alerts = await A.admin.get("/api/admin/analytics/alerts");
  assert.equal(alerts.status, 200, JSON.stringify(alerts.data));
  for (const k of ["pending_exams", "overdue_invoices", "frequent_absentees", "teachers_without_load"]) {
    assert.equal(typeof alerts.data.counts[k], "number", k);
  }
  assert.ok(Array.isArray(alerts.data.absentees) && Array.isArray(alerts.data.overdue));

  const an = await A.admin.get("/api/admin/analytics?months=6");
  assert.equal(an.status, 200);
  for (const k of ["attendance_by_month", "attendance_by_class", "grades_by_class", "grades_by_subject", "top_students", "fees_by_month"]) {
    assert.ok(Array.isArray(an.data[k]), k);
  }
  assert.equal(typeof an.data.fees.collected, "number");

  const found = await A.admin.get(`/api/admin/analytics/search?q=${encodeURIComponent("طالب")}`);
  assert.equal(found.status, 200, JSON.stringify(found.data));
  assert.ok(found.data.students.length >= 1);
  assert.equal((await A.admin.get("/api/admin/analytics/search?q=ط")).status, 400, "حرف واحد غير كافٍ");

  // البحث لا يتجاوز المدرسة (نعيد تفعيل مدرسة ب بعد اختبار الإيقاف)
  await owner.patch(`/api/owner/tenants/${B.id}`, { status: "active" });
  B.admin = client(srv.base);
  await B.admin.post("/api/staff/login", { school: B.id, username: "admin", password: B.password });
  const other = await B.admin.get(`/api/admin/analytics/search?q=${encodeURIComponent("طالب")}`);
  assert.equal(other.status, 200, JSON.stringify(other.data));
  assert.equal(other.data.students.length, 0);
});

// يُنفَّذ أخيرًا لأنه ينقل الطلاب بين الصفوف
test("السنة الدراسية والفصول: ربط تلقائي وبدء سنة جديدة", async () => {
  // إعادة تفعيل جلسة المعلم بعد اختبارات الإيقاف والقفل السابقة
  const teacherId = (await A.admin.get("/api/admin/teachers")).data[0].id;
  s.teacherPw = (await A.admin.post(`/api/admin/teachers/${teacherId}/reset-password`, {})).data.credentials.password;
  s.teacher = client(srv.base);
  await s.teacher.post("/api/staff/login", { school: A.id, username: "tester", password: s.teacherPw });

  const state = await A.admin.get("/api/admin/academic");
  assert.equal(state.status, 200, JSON.stringify(state.data));
  assert.ok(state.data.current.year_name, "توجد سنة حالية");
  const terms = state.data.terms.filter((t) => t.year_id === state.data.current.year_id);
  assert.equal(terms.length, 3, "ثلاثة فصول افتراضية");
  const first = terms.find((t) => t.ordinal === 1);
  assert.equal(first.is_current, true);

  // الاختبار الجديد يُربط تلقائيًا بالفصل الحالي
  const e1 = await s.teacher.post("/api/teacher/exams", { class_id: s.classId, subject_id: s.subjectId, title: "اختبار الفصل الأول", max_score: 10 });
  assert.equal(e1.status, 201);
  const listed = (await A.admin.get("/api/admin/exams")).data.find((x) => x.id === e1.data.id);
  assert.equal(listed.term_id, first.id);
  assert.equal(listed.term_name, "الفصل الأول");

  // تغيير الفصل الحالي ثم اختبار جديد يذهب للفصل الثاني
  const second = terms.find((t) => t.ordinal === 2);
  assert.equal((await A.admin.post(`/api/admin/academic/terms/${second.id}/current`, {})).status, 200);
  const e2 = await s.teacher.post("/api/teacher/exams", { class_id: s.classId, subject_id: s.subjectId, title: "اختبار الفصل الثاني", max_score: 10 });
  const listed2 = (await A.admin.get("/api/admin/exams")).data.find((x) => x.id === e2.data.id);
  assert.equal(listed2.term_name, "الفصل الثاني");

  // كشف الدرجات يفصل بين الفصلين
  await s.teacher.put(`/api/teacher/exams/${e2.data.id}/scores`, { scores: { [s.student.id]: 9 } });
  await s.teacher.post(`/api/teacher/exams/${e2.data.id}/submit`, {});
  await A.admin.post(`/api/admin/exams/${e2.data.id}/status`, { status: "published" });
  const termCard = await A.admin.get(`/api/admin/reports/report-card/${s.student.id}?term_id=${second.id}`);
  assert.equal(termCard.data.subjects[0].score, 9, "درجات الفصل الثاني فقط");
  const yearCard = await A.admin.get(`/api/admin/reports/report-card/${s.student.id}`);
  assert.ok(yearCard.data.subjects[0].max > termCard.data.subjects[0].max, "السنة كاملة تجمع الفصول");

  // النتائج: ناجح أو راسب حسب درجة النجاح
  const classes = (await A.admin.get("/api/admin/structure/classes")).data;
  const target = classes.find((c) => c.id !== s.classId);

  const yearId = (await A.admin.get("/api/admin/academic")).data.current.year_id;
  assert.equal((await A.admin.patch(`/api/admin/academic/years/${yearId}/pass-mark`, { pass_mark: 95 })).status, 200);
  let preview = await A.admin.post("/api/admin/academic/promotion-preview", {
    moves: [{ from_class_id: s.classId, action: "promote", to_class_id: target.id }] });
  let mine = preview.data.students.find((x) => x.id === s.student.id);
  assert.equal(mine.outcome, "failed", "أقل من درجة النجاح = راسب");
  assert.equal(mine.suggested_action, "repeat", "الراسب يُعاد تلقائيًا");

  assert.equal((await A.admin.patch(`/api/admin/academic/years/${yearId}/pass-mark`, { pass_mark: 50 })).status, 200);
  preview = await A.admin.post("/api/admin/academic/promotion-preview", {
    moves: [{ from_class_id: s.classId, action: "promote", to_class_id: target.id }] });
  mine = preview.data.students.find((x) => x.id === s.student.id);
  assert.equal(mine.outcome, "passed");
  assert.equal(mine.suggested_action, "promote");
  assert.ok(mine.average > 0 && mine.attendance_rate !== undefined);

  // بدء سنة جديدة مع استثناء طالب (تخرّج)
  const other = preview.data.students.find((x) => x.id !== s.student.id);
  const rollover = await A.admin.post("/api/admin/academic/start-year", {
    year: { name: "2030/2031", start_date: "2030-08-01", end_date: "2031-06-30", terms: 2 },
    moves: [{ from_class_id: s.classId, action: "promote", to_class_id: target.id }],
    overrides: other ? [{ student_id: other.id, action: "graduate", note: "أنهى المرحلة" }] : [],
  });
  assert.equal(rollover.status, 200, JSON.stringify(rollover.data));
  assert.ok(rollover.data.promoted >= 1);

  const after = await A.admin.get("/api/admin/academic");
  assert.equal(after.data.current.year_name, "2030/2031");
  assert.equal(after.data.terms.filter((t) => t.year_id === after.data.current.year_id).length, 2);
  assert.ok(after.data.years.some((y) => y.status === "archived"), "السنة السابقة صارت مؤرشفة");

  const student = (await A.admin.get("/api/admin/students")).data.find((x) => x.id === s.student.id);
  assert.equal(student.class_id, target.id, "الطالب انتقل للصف الجديد");

  const history = await A.admin.get(`/api/admin/academic/students/${s.student.id}/history`);
  assert.equal(history.data[0].result, "promoted");
  assert.equal(history.data[0].outcome, "passed");
  assert.ok(Number(history.data[0].average) > 0, "المعدل محفوظ في السجل");
  assert.ok(history.data[0].year_name, "سجل السنة محفوظ");

  if (other) {
    const grad = (await A.admin.get("/api/admin/students?status=inactive")).data.find((x) => x.id === other.id);
    assert.equal(grad.status, "graduated", "الاستثناء نُفِّذ: تخرّج");
    const gradHistory = await A.admin.get(`/api/admin/academic/students/${other.id}/history`);
    assert.equal(gradHistory.data[0].result, "graduated");
  }

  // الدرجات القديمة لم تُحذف
  assert.ok((await A.admin.get(`/api/admin/reports/report-card/${s.student.id}?term_id=${second.id}`)).data.subjects.length >= 1);
});

/* =====================================================================
   إصلاحات المراجعة: المرفقات، فرض الاعتماد، اتساق التحويل، أقفال الدخول
   ===================================================================== */

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function financeSchool(name) {
  const C = await makeSchool(name);
  const accounts = (await C.admin.get("/api/admin/ledger/accounts")).data;
  C.cash = accounts.find((a) => a.kind === "cash");
  C.bank = accounts.find((a) => a.kind === "bank");
  const cats = (await C.admin.get("/api/admin/ledger/categories")).data;
  C.income = cats.find((c) => c.direction === "income");
  C.expense = cats.find((c) => c.direction === "expense");
  C.deposit = (amount) => C.admin.post("/api/admin/ledger/entries", {
    direction: "income", amount, account_id: C.cash.id, category_id: C.income.id,
    occurred_on: "2026-09-06", reason: "إيراد اختبار", method: "cash" });
  C.balance = async (id) => Number((await C.admin.get("/api/admin/ledger/accounts")).data.find((a) => a.id === id).balance);
  return C;
}

test("المرفقات: ملف أكبر من 512KB يُقبل، والمحتوى المزيّف والحجم الزائد يُرفضان", async () => {
  const C = await financeSchool("مدرسة المرفقات");
  const entry = await C.deposit(100);
  assert.equal(entry.status, 201, JSON.stringify(entry.data));
  const url = `/api/admin/ledger/entries/${entry.data.id}/attachments`;

  const big = Buffer.concat([PNG_HEAD, Buffer.alloc(1_000_000)]).toString("base64");   // ~1.3MB بعد base64
  const ok = await C.admin.post(url, { filename: "فاتورة.png", mime: "image/png", data: big });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.ok(ok.data.size_bytes > 900_000);

  const fake = Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " ")).toString("base64");
  assert.equal((await C.admin.post(url, { filename: "x.png", mime: "image/png", data: fake })).status, 400, "HTML بصفة صورة");

  const tooBig = Buffer.concat([PNG_HEAD, Buffer.alloc(2_200_000)]).toString("base64");
  assert.equal((await C.admin.post(url, { filename: "كبير.png", mime: "image/png", data: tooBig })).status, 400, "أكبر من 2MB");
});

test("الاعتماد المالي يُفرض من الخادم: مصروف من دون صلاحية يبقى معلّقًا، والاسترداد يحتاج صلاحية", async () => {
  const C = await financeSchool("مدرسة الاعتماد");
  await C.deposit(1000);
  const created = await C.admin.post("/api/admin/users", { name: "محاسب بلا صلاحيات", username: "acc-plain" });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const acc = client(srv.base);
  assert.equal((await acc.post("/api/staff/login", { school: C.id, username: "acc-plain", password: created.data.credentials.password })).status, 200);

  // يرسل needs_approval: false ليتجاوز الاعتماد، والخادم يتجاهله
  const before = await C.balance(C.cash.id);
  const sneaky = await acc.post("/api/accountant/ledger/entries", {
    direction: "expense", amount: 400, account_id: C.cash.id, category_id: C.expense.id,
    occurred_on: "2026-09-07", reason: "سحب بلا اعتماد", method: "cash", needs_approval: false });
  assert.equal(sneaky.status, 201, JSON.stringify(sneaky.data));
  assert.equal(sneaky.data.status, "pending", "المصروف بانتظار الاعتماد رغم الطلب");
  assert.equal(await C.balance(C.cash.id), before, "الرصيد لا يتأثر قبل الاعتماد");

  // الإيراد لا يحتاج اعتمادًا
  const inc = await acc.post("/api/accountant/ledger/entries", {
    direction: "income", amount: 50, account_id: C.cash.id, category_id: C.income.id,
    occurred_on: "2026-09-07", reason: "إيراد", method: "cash" });
  assert.equal(inc.data.status, "approved");

  // الاسترداد يُخرج نقدًا، فيحتاج الصلاحية (يُرفض قبل أي فحص آخر)
  const refund = await acc.post("/api/accountant/finance/invoices/1/refunds", { amount: 10, note: "اختبار", idempotency_key: `k-${uid()}-r` });
  assert.equal(refund.status, 403);
});

test("التحويل بين الحسابات: يُلغى بطرفيه معًا، ولا يتجاوز الرصيد تحويلان متزامنان", async () => {
  const C = await financeSchool("مدرسة التحويل");
  await C.deposit(1000);
  const transfer = (amount) => C.admin.post("/api/admin/ledger/transfers", {
    from_account_id: C.cash.id, to_account_id: C.bank.id, amount, occurred_on: "2026-09-08", reason: "إيداع" });

  // تحويلان متزامنان بـ 700 من رصيد 1000: ينجح أحدهما فقط
  const both = await Promise.all([transfer(700), transfer(700)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 400], JSON.stringify(both.map((r) => r.data)));
  assert.equal(await C.balance(C.cash.id), 300);
  assert.equal(await C.balance(C.bank.id), 700);

  const legs = (await C.admin.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01&source_type=transfer")).data;
  assert.equal(legs.length, 2);

  // إلغاء طرف واحد يُلغي الطرفين، فيعود الرصيدان كما كانا
  const voided = await C.admin.post(`/api/admin/ledger/entries/${legs[0].id}/void`, { reason: "تحويل بالخطأ" });
  assert.equal(voided.status, 200, JSON.stringify(voided.data));
  assert.equal(voided.data.voided, 2);
  const after = (await C.admin.get("/api/admin/ledger/entries?from=2000-01-01&to=2100-01-01&source_type=transfer")).data;
  assert.ok(after.every((e) => e.status === "void"), "الطرفان ملغيان");
  assert.equal(await C.balance(C.cash.id), 1000);
  assert.equal(await C.balance(C.bank.id), 0);

  // لا إلغاء ثانٍ
  assert.equal((await C.admin.post(`/api/admin/ledger/entries/${legs[1].id}/void`, { reason: "مرة ثانية" })).status, 400);
});

test("أقفال الدخول: تبقى الحماية، ورسالة القفل لا تكشف وجود الحساب، وإعادة التعيين تفكّ القفل", async () => {
  const C = await makeSchool("مدرسة الأقفال");
  const created = await C.admin.post("/api/admin/users", { name: "محاسب القفل", username: "acc-lock" });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const x = client(srv.base);
  for (let i = 0; i < 5; i++) await x.post("/api/staff/login", { school: C.id, username: "acc-lock", password: "wrong-pass-1" });
  const locked = await x.post("/api/staff/login", { school: C.id, username: "acc-lock", password: created.data.credentials.password });
  assert.equal(locked.status, 401);
  assert.match(locked.data.error, /مقفل/, "كلمة المرور الصحيحة لا تفتح أثناء القفل");

  // اسم غير موجود يُعامل بالطريقة نفسها: لا فرق ظاهر بين حساب موجود وغير موجود
  const y = client(srv.base);
  for (let i = 0; i < 5; i++) await y.post("/api/staff/login", { school: C.id, username: "ghost-user", password: "wrong-pass-1" });
  const ghost = await y.post("/api/staff/login", { school: C.id, username: "ghost-user", password: "wrong-pass-1" });
  assert.match(ghost.data.error, /مقفل/);

  // المدير يعيد تعيين كلمة المرور فيُفك القفل فورًا
  const id = (await C.admin.get("/api/admin/users")).data.find((u) => u.username === "acc-lock").id;
  const reset = await C.admin.post(`/api/admin/users/${id}/reset-password`, {});
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  const back = await client(srv.base).post("/api/staff/login", { school: C.id, username: "acc-lock", password: reset.data.credentials.password });
  assert.equal(back.status, 200, "الدخول بعد إعادة التعيين");
});

/* =====================================================================
   الجولة الثانية: RLS على الجداول الأساسية، الحدود المشتركة، التصدير، السنة، القراءة العامة
   ===================================================================== */

test("RLS: جداول المدارس والجلسات والأحداث الأمنية معزولة في قاعدة البيانات نفسها", async () => {
  // بلا سياق لا يظهر أي صف
  for (const t of ["tenants", "sessions", "security_events"]) {
    const [row] = await transaction({}, (q) => q(`SELECT count(*)::int AS n FROM ${t}`));
    assert.equal(row.n, 0, `${t} بلا سياق`);
  }
  // سياق مدرسة يرى صفها فقط، ولا يستطيع تعديل مدرسة أخرى
  const own = await transaction({ tenantId: A.id }, (q) => q("SELECT id FROM tenants"));
  assert.deepEqual(own.map((r) => r.id), [A.id]);
  const foreign = await transaction({ tenantId: A.id }, (q) => q("UPDATE tenants SET name = name WHERE id = $1 RETURNING id", [B.id]));
  assert.equal(foreign.length, 0, "لا تعديل لمدرسة أخرى");
  const sess = await transaction({ tenantId: A.id }, (q) => q("SELECT DISTINCT tenant_id FROM sessions"));
  assert.ok(sess.length > 0 && sess.every((r) => r.tenant_id === A.id), "جلسات مدرسة أ فقط");
  // سياق المنصة يرى الكل
  const [all] = await transaction({ platform: true }, (q) => q("SELECT count(*)::int AS n FROM tenants"));
  assert.ok(all.n >= 2);
  // جلسة واحدة بصمتها فقط
  const [one] = await transaction({ tenantId: A.id }, (q) => q("SELECT token_hash FROM sessions LIMIT 1"));
  const byHash = await transaction({ sessionHash: one.token_hash }, (q) => q("SELECT token_hash FROM sessions"));
  assert.deepEqual(byHash.map((r) => r.token_hash), [one.token_hash]);
});

test("مخزن الحدود المشترك: يعدّ، ويصفّر، وينتهي، ويتحمل التزامن", async () => {
  const store = new PgStore(`t-${uid()}`);
  store.init({ windowMs: 60_000 });
  assert.equal((await store.increment("ip1")).totalHits, 1);
  assert.equal((await store.increment("ip1")).totalHits, 2);
  assert.equal((await store.increment("ip2")).totalHits, 1, "كل مفتاح مستقل");
  await store.decrement("ip1");
  assert.equal((await store.increment("ip1")).totalHits, 2);
  await store.resetKey("ip1");
  assert.equal((await store.increment("ip1")).totalHits, 1);

  const short = new PgStore(`s-${uid()}`);
  short.init({ windowMs: 1000 });
  await short.increment("k"); await short.increment("k");
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await short.increment("k")).totalHits, 1, "النافذة تنتهي وتبدأ من جديد");

  const conc = new PgStore(`c-${uid()}`);
  conc.init({ windowMs: 60_000 });
  const hits = (await Promise.all(Array.from({ length: 10 }, () => conc.increment("k")))).map((r) => r.totalHits).sort((a, b) => a - b);
  assert.deepEqual(hits, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "10 طلبات متزامنة تُعدّ كلها");
});

test("التصدير: يشمل المالية والسنوات، وأكثر من دفعة، ويُسجَّل في التدقيق", async () => {
  // أكثر من 5000 صف حضور لنتأكد من القراءة على دفعات دون فقدان أو تكرار
  const [st] = await A.admin.get("/api/admin/students").then((r) => r.data);
  await transaction({ tenantId: A.id, actor: "اختبار" }, (q) => q(
    `INSERT INTO attendance (tenant_id, student_id, day, status, recorded_by)
     SELECT app_tenant(), $1, DATE '2040-01-01' + g, 'present', 'اختبار' FROM generate_series(0, 5000) g
     ON CONFLICT DO NOTHING`, [st.id]));

  const r = await A.admin.get("/api/admin/export");
  assert.equal(r.status, 200);
  for (const k of ["finance_accounts", "finance_categories", "finance_entries", "donations", "staff", "payroll_runs", "payroll_items",
    "academic_years", "terms", "student_years", "assignments", "assignment_submissions", "admissions", "attachments_meta",
    "scores", "public_page_settings", "message_templates"]) {
    assert.ok(Array.isArray(r.data[k]), k);
  }
  assert.ok(r.data.finance_entries.length > 0, "الحركات المالية مضمَّنة");
  assert.ok(r.data.academic_years.length >= 1);
  assert.ok(r.data.attendance.length >= 5001, "لا قصّ عند 20,000 ولا عند حد الدفعة");
  assert.equal(new Set(r.data.attendance.map((x) => x.id)).size, r.data.attendance.length, "لا صف مكرر بين الدفعات");

  const log = (await A.admin.get("/api/admin/audit")).data;
  assert.ok(log.some((e) => /تصدير/.test(e.summary || "")), "التصدير مسجَّل في التدقيق");
});

test("بدء سنة جديدة يرفض الطلب إذا تغيّرت السنة الحالية عمّا رآه المدير", async () => {
  const data = (await A.admin.get("/api/admin/academic")).data;
  const stale = data.years.find((y) => y.id !== data.current.year_id).id;
  const r = await A.admin.post("/api/admin/academic/start-year", {
    year: { name: "2031/2032", start_date: "2031-08-01", end_date: "2032-06-30", terms: 2 }, moves: [], expected_year_id: stale });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal((await A.admin.get("/api/admin/academic")).data.current.year_name, "2030/2031", "لم تتغير السنة");
});

test("قراءة الصفحة العامة لا تكتب في قاعدة البيانات", async () => {
  const anon = client(srv.base);
  const stamp = async () => String((await transaction({ tenantId: A.id }, (q) =>
    q("SELECT updated_at FROM school_public_settings WHERE tenant_id = app_tenant()")))[0].updated_at);
  assert.equal((await anon.post(`/api/public/${A.id}/page`, { access: A.directory })).status, 200);   // يضمن وجود الصف
  const before = await stamp();
  await new Promise((r) => setTimeout(r, 30));
  for (let i = 0; i < 3; i++) assert.equal((await anon.post(`/api/public/${A.id}/page`, { access: A.directory })).status, 200);
  assert.equal(await stamp(), before, "الصف لم يُحدَّث أثناء القراءة");
});

test("أداة فحص الشبكة للمالك: تعرض عنوان IP الذي يراه الخادم", async () => {
  const r = await owner.get("/api/owner/network");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.ip, "عنوان الطلب ظاهر");
  assert.equal(typeof r.data.trust_proxy, "number");
  assert.equal((await client(srv.base).get("/api/owner/network")).status, 401, "بلا دخول لا يُعرض شيء");
});

/* =====================================================================
   الجولة الثالثة: كلمة المرور المؤقتة، إنهاء الجلسات، إلزام TOTP، وأخطاء صغيرة
   ===================================================================== */

test("كلمة المرور المؤقتة: لا يعمل شيء قبل تغييرها، والتغيير يُنهي جلسات الأجهزة الأخرى", async () => {
  const C = await makeSchool("مدرسة كلمة المرور");    // الإلزام مطفأ افتراضيًا في الاختبارات
  const other = client(srv.base);                    // جهاز آخر بالحساب نفسه
  assert.equal((await other.post("/api/staff/login", { school: C.id, username: "admin", password: C.password })).status, 200);

  process.env.FORCE_PASSWORD_CHANGE = "true";
  try {
    const me = await C.admin.get("/api/admin/me");
    assert.equal(me.status, 200, "قراءة /me مسموحة لتعرف الواجهة أن التغيير لازم");
    assert.equal(me.data.must_change_password, true);

    const blocked = await C.admin.get("/api/admin/students");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, "password_change_required");

    const NEW = `Brand-New-${uid()}9`;
    assert.equal((await C.admin.post("/api/admin/password", { current: C.password, next: C.password })).status, 400, "لا تُقبل نفس المؤقتة");
    assert.equal((await C.admin.post("/api/admin/password", { current: "wrong-password-1", next: NEW })).status, 401);
    assert.equal((await C.admin.post("/api/admin/password", { current: C.password, next: NEW })).status, 200);

    assert.equal((await C.admin.get("/api/admin/students")).status, 200, "بعد التغيير يعمل كل شيء");
    assert.equal((await C.admin.get("/api/admin/me")).data.must_change_password, false);
    assert.equal((await other.get("/api/admin/me")).status, 401, "جلسة الجهاز الآخر أُنهيت (حتى لو كانت نشطة الآن)");

    // إعادة تعيين كلمة مرور المحاسب من المدير تُعيد الإلزام
    const created = await C.admin.post("/api/admin/users", { name: "محاسب مؤقت", username: "acc-temp" });
    const acc = client(srv.base);
    assert.equal((await acc.post("/api/staff/login", { school: C.id, username: "acc-temp", password: created.data.credentials.password })).status, 200);
    assert.equal((await acc.get("/api/accountant/me")).data.must_change_password, true);
    assert.equal((await acc.get("/api/accountant/ledger/accounts")).status, 403);
  } finally {
    delete process.env.FORCE_PASSWORD_CHANGE;
  }
});

test("الإنتاج يعمل بدون تحقق ثنائي لكنه ينبّه، ويعمل بصمت مع ضبطه", async () => {
  const { spawnSync } = await import("node:child_process");
  const base = {
    PATH: process.env.PATH, NODE_ENV: "production", COOKIE_SECURE: "true",
    DATABASE_URL: "postgres://x:y@localhost:5432/z", OWNER_PATH: "/abcdefghijk123", OWNER_USERNAME: "owner",
    OWNER_PASSWORD_HASH: "scrypt$x$y", OWNER_TOTP_SECRET: "",
  };
  const run = (extra) => spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./src/config/env.js")'],
    { env: { ...base, ...extra }, cwd: new URL("..", import.meta.url), encoding: "utf8" });

  const without = run({});
  assert.equal(without.status, 0, "يعمل بدون تحقق ثنائي");
  assert.match(without.stderr, /تحقق ثنائي/, "لكنه ينبّه بوضوح");

  const withSecret = run({ OWNER_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
  assert.equal(withSecret.status, 0);
  assert.doesNotMatch(withSecret.stderr, /تحقق ثنائي/, "لا تنبيه عند ضبطه");
});
