// اختبارات الأساس: الفصل بين الأدوار، عزل المدارس، الحماية المالية، سلامة البيانات
// التشغيل: npm test  (يحتاج قاعدة بيانات اختبار و TEST_OWNER_PASSWORD في .env)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, ownerPath, endPool } from "./helpers.js";

let srv, owner, A, B;           // A و B مدرستان منفصلتان
const s = {};                   // بيانات مشتركة بين الاختبارات

async function makeSchool(name) {
  const id = `t-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, max_students: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const admin = client(srv.base);
  const login = await admin.post("/api/admin/login", { school: id, username: "admin", password: r.data.credentials.password });
  assert.equal(login.status, 200);
  return { id, admin, directory: r.data.credentials.directory_code, password: r.data.credentials.password };
}

before(async () => {
  assert.ok(ownerPassword, "عيّن TEST_OWNER_PASSWORD في .env");
  srv = await startServer();
  owner = client(srv.base);
  const r = await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword });
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
  assert.equal((await x.post("/api/admin/login", { school: A.id, username: "tester", password: s.teacherPw })).status, 401);
  const teacher = client(srv.base);
  assert.equal((await teacher.post("/api/teacher/login", { school: A.id, username: "tester", password: s.teacherPw })).status, 200);
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
  assert.equal((await anon.post(`/api/public/${A.id}/directory`, { access: "WRONGCODE" })).status, 401);
  const dir = await anon.post(`/api/public/${A.id}/directory`, { access: A.directory });
  assert.equal(dir.status, 200);
  const listed = dir.data.classes.flatMap((c) => c.students);
  assert.deepEqual(Object.keys(listed[0]).sort(), ["id", "name"], "لا تظهر أي بيانات غير الاسم");

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

  assert.equal((await anon.post(`/api/public/${A.id}/transfer-claims`, { ...base, amount: 5000, idempotency_key: `k-${uid()}-c0` })).status, 400, "أكبر من المتبقي");
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

test("الأرشفة بدل الحذف، والطالب المؤرشف لا يُفتح ملفه", async () => {
  assert.equal((await A.admin.post(`/api/admin/students/${s.student.id}/archive`, { archived: true })).status, 200);
  const anon = client(srv.base);
  assert.equal((await anon.post(`/api/public/${A.id}/student`, { student_id: s.student.id, key: s.student.access_key })).status, 401);
  assert.equal((await A.admin.post(`/api/admin/students/${s.student.id}/archive`, { archived: false })).status, 200);
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
  for (let i = 0; i < 5; i++) await x.post("/api/teacher/login", { school: A.id, username: "tester", password: "wrong-pass" });
  const r = await x.post("/api/teacher/login", { school: A.id, username: "tester", password: s.teacherPw });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /مقفل/);
});

test("إيقاف المدرسة يُخرج مستخدميها فورًا", async () => {
  assert.equal((await owner.patch(`/api/owner/tenants/${B.id}`, { status: "suspended" })).status, 200);
  assert.equal((await B.admin.get("/api/admin/me")).status, 401);
  assert.equal((await client(srv.base).post(`/api/public/${B.id}/directory`, { access: B.directory })).status, 404);
});
