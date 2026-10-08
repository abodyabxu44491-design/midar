// حساب ولي الأمر الموحّد: دخول واحد لكل الأبناء، والربط بمعرّفات ثابتة، وتحقق الخادم من الارتباط مع كل طلب،
// والعزل بين المدارس. اختبارات على الواجهة البرمجية مباشرة (لا الشاشة فقط).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, deliveriesIdle, notify } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const P = (S) => `/api/public/${S.id}`;
const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await deliveriesIdle(); };
const DAD = "771100200", MOM = "733300400";
const kids = {};          // الاسم ← الطالب
let dad, mom, dadCreds;

async function addStudent(S, name, phone, cls = S.c1.id) {
  const r = await S.admin.post("/api/admin/students", { name, class_id: cls, guardian_phone: phone });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const login = async (S, phone, password) => {
  const c = client(srv.base);
  const r = await c.post(`${P(S)}/parent/login`, { phone, password });
  return { c, r };
};

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => ({ statusCode: 201 }), sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "pa", students: 1 });
  B = await readySchool(srv.base, { prefix: "pb", students: 1 });
  // خمسة أبناء لنفس الأب (نفس الجوال)، في شعب مختلفة
  for (const [n, cls] of [["أحمد عبدالله سالم", A.c1.id], ["محمد عبدالله سالم", A.c2.id], ["سارة عبدالله سالم", A.c1.id],
    ["خالد عبدالله سالم", A.c2.id], ["مريم عبدالله سالم", A.c1.id]]) kids[n.split(" ")[0]] = await addStudent(A, n, DAD, cls);
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("الإنشاء التلقائي من أرقام الجوال: حساب واحد للأب مرتبط بأبنائه الخمسة، بلا حسابات مكررة", async () => {
  const r = await A.admin.post("/api/admin/parents/auto-create");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const mine = r.data.credentials.find((c) => c.phone === DAD);
  assert.ok(mine, "حساب للأب");
  assert.equal(mine.children, 5);
  dadCreds = mine;
  const again = await A.admin.post("/api/admin/parents/auto-create");
  assert.equal(again.data.created, 0, "لا تكرار");
  assert.equal(again.data.linked, 0);
  const list = (await A.admin.get(`/api/admin/parents?search=${DAD}`)).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].children.length, 5);
  dad = list[0];
  // كلمة المرور المؤقتة ظاهرة للإدارة حتى يغيّرها ولي الأمر
  assert.equal((await A.admin.get(`/api/admin/parents/${dad.id}`)).data.initial_password, mine.password);
});

test("دخول واحد ← كل الأبناء الخمسة مع حالة اليوم، والتبديل بينهم بلا معرّف", async () => {
  const { c, r } = await login(A, DAD, dadCreds.password);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.must_change_password, true);
  dad.c = c;
  const me = (await c.post(`${P(A)}/parent/me`)).data;
  assert.equal(me.children.length, 5);
  assert.ok(me.children.every((k) => k.active && k.class_name));
  // تبديل سريع: ملف كل ابن ببياناته هو (بلا معرّف)
  for (const k of me.children) {
    const f = await c.post(`${P(A)}/student`, { student_id: k.id });
    assert.equal(f.status, 200, JSON.stringify(f.data));
    assert.equal(f.data.student.name, k.name);
  }
  // تغيير كلمة المرور المؤقتة
  assert.equal((await c.post(`${P(A)}/parent/password`, { current: dadCreds.password, next: "Dad-Pass-2026" })).status, 200);
  assert.equal((await A.admin.get(`/api/admin/parents/${dad.id}`)).data.initial_password, null);
  const relog = await login(A, DAD, "Dad-Pass-2026");
  assert.equal(relog.r.data.must_change_password, false);
});

test("منع الوصول لطالب غير مرتبط: 403 بلا أي بيانات، حتى لو أُرسل معرّفه من المتصفح", async () => {
  const [other] = A.students;
  const r = await dad.c.post(`${P(A)}/student`, { student_id: other.id });
  assert.equal(r.status, 403);
  assert.ok(!JSON.stringify(r.data).includes(other.full_name || "زز"));
  assert.equal(r.data.student, undefined);
  for (const path of ["student/inbox", "student/notify-prefs", "student/attendance-card", "student/online-exams"]) {
    assert.equal((await dad.c.post(`${P(A)}/${path}`, { student_id: other.id })).status, 403, path);
  }
  // بلا جلسة: 401
  assert.equal((await client(srv.base).post(`${P(A)}/student`, { student_id: kids["أحمد"].id })).status, 401);
  // المعرّف القديم ما زال يعمل (بطاقات ولي الأمر الحالية)
  assert.equal((await client(srv.base).post(`${P(A)}/student`, A.parent(other))).status, 200);
});

test("العزل بين المدارس: جلسة ولي أمر في مدرسة أ لا تفتح شيئًا في مدرسة ب", async () => {
  const [b1] = B.students;
  assert.equal((await dad.c.post(`${P(B)}/student`, { student_id: b1.id })).status, 401);
  assert.equal((await dad.c.post(`${P(B)}/parent/me`)).status, 401);
  // معرّف طالب من مدرسة أ في مسار مدرسة ب
  assert.equal((await dad.c.post(`${P(B)}/student`, { student_id: kids["أحمد"].id })).status, 401);
  // إدارة ب لا ترى حسابات أ
  assert.equal((await B.admin.get(`/api/admin/parents/${dad.id}`)).status, 404);
  assert.equal((await B.admin.get(`/api/admin/parents?search=${DAD}`)).data.length, 0);
});

test("طالب مرتبط بالأب والأم: لكلٍّ حسابه، ويصلان لنفس الابن", async () => {
  const r = await A.admin.post("/api/admin/parents", { name: "أم أحمد", phone: MOM, student_ids: [kids["أحمد"].id, kids["سارة"].id], relation: "mother" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  mom = { id: r.data.id };
  assert.equal((await A.admin.post("/api/admin/parents", { name: "مكرر", phone: MOM })).status, 409, "لا حسابين بنفس الجوال");
  const { c } = await login(A, MOM, r.data.credentials.password);
  mom.c = c;
  const me = (await c.post(`${P(A)}/parent/me`)).data;
  assert.deepEqual(me.children.map((k) => k.name).sort(), ["أحمد عبدالله سالم", "سارة عبدالله سالم"]);
  assert.equal(me.children[0].relation, "mother");
  assert.equal((await c.post(`${P(A)}/student`, { student_id: kids["أحمد"].id })).status, 200);
  assert.equal((await c.post(`${P(A)}/student`, { student_id: kids["محمد"].id })).status, 403);
  const of = (await A.admin.get(`/api/admin/parents/of-student/${kids["أحمد"].id}`)).data;
  assert.equal(of.length, 2);
});

test("الإشعار يحمل اسم الابن، والحضور والدرجات والواجبات والرسوم مستقلة لكل ابن", async () => {
  const date = new Date().toISOString().slice(0, 10);
  await transaction({ tenantId: A.id }, (q) => q(`INSERT INTO timetable_settings (tenant_id, days) VALUES (app_tenant(), '{0,1,2,3,4,5,6}')
    ON CONFLICT (tenant_id) DO UPDATE SET days = EXCLUDED.days`));
  assert.equal((await A.admin.post("/api/admin/attendance", { date, entries: [
    { student_id: kids["أحمد"].id, status: "present" }, { student_id: kids["محمد"].id, status: "late" }] })).status, 200);
  await transaction({ tenantId: A.id }, (q) => notify(q, { event: "homework", students: [kids["محمد"].id], title: "واجب جديد", body: "الرياضيات" }));
  // فاتورة لسارة فقط
  assert.equal((await A.admin.post("/api/admin/finance/invoices", { target: "student", target_id: kids["سارة"].id, title: "رسوم الفصل", amount: 1000 })).status, 201);
  await settle();
  const me = (await dad.c.post(`${P(A)}/parent/me`)).data;
  const hw = me.notifications.find((n) => n.kind === "homework");
  assert.match(hw.title, /محمد/);
  assert.equal(hw.student_name, "محمد عبدالله سالم");
  const st = Object.fromEntries(me.children.map((k) => [k.name.split(" ")[0], k.today_status]));
  assert.equal(st["أحمد"], "present");
  assert.equal(st["محمد"], "late");
  assert.equal(st["سارة"], null);
  const fileOf = async (n) => (await dad.c.post(`${P(A)}/student`, { student_id: kids[n].id })).data;
  const [ahmad, sara] = [await fileOf("أحمد"), await fileOf("سارة")];
  assert.equal(ahmad.attendance[0].status, "present");
  assert.equal(sara.attendance.length, 0);
  assert.ok(sara.fees?.invoices?.length || sara.fees?.open_total || JSON.stringify(sara.fees).includes("1000"));
  assert.ok(!JSON.stringify(ahmad.fees || {}).includes("رسوم الفصل"));
  // صلاحية الرسوم: الأم لا ترى رسوم سارة إن مُنعت
  await A.admin.post(`/api/admin/parents/${mom.id}/link`, { student_id: kids["سارة"].id, can_view_fees: false });
  assert.equal((await mom.c.post(`${P(A)}/student`, { student_id: kids["سارة"].id })).data.fees, null);
  assert.equal((await mom.c.post(`${P(A)}/transfer-claims`, { student_id: kids["سارة"].id, invoice_id: 1, amount: 10, transfer_date: date })).status, 400);
});

test("نقل الطالب بين الشعب لا يمس العلاقة، والأرشفة تحفظ السجل وتمنع فتح الملف", async () => {
  const k = kids["خالد"];
  const [{ version }] = await transaction({ tenantId: A.id }, (q) => q("SELECT version FROM students WHERE id = $1", [k.id]));
  const moved = await A.admin.patch(`/api/admin/students/${k.id}`, { version, class_id: A.c1.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  let me = (await dad.c.post(`${P(A)}/parent/me`)).data;
  assert.equal(me.children.find((x) => x.id === k.id).class_name, "الأول - أ");
  assert.equal((await A.admin.post(`/api/admin/students/${k.id}/status`, { status: "transferred", note: "انتقل لمدرسة أخرى" })).status, 200);
  me = (await dad.c.post(`${P(A)}/parent/me`)).data;
  const old = me.children.find((x) => x.id === k.id);
  assert.ok(old, "يبقى في القائمة كسابق");
  assert.equal(old.active, false);
  assert.equal((await dad.c.post(`${P(A)}/student`, { student_id: k.id })).status, 403);
  await A.admin.put("/api/admin/parents/settings", { show_inactive: false });
  assert.ok(!(await dad.c.post(`${P(A)}/parent/me`)).data.children.some((x) => x.id === k.id));
  await A.admin.put("/api/admin/parents/settings", { show_inactive: true });
});

test("فك ارتباط ابن: يختفي من الحساب فورًا ويُرفض ملفه، ويبقى في سجل الإدارة", async () => {
  const k = kids["مريم"];
  assert.equal((await A.admin.post(`/api/admin/parents/${dad.id}/unlink`, { student_id: k.id })).status, 200);
  assert.equal((await dad.c.post(`${P(A)}/student`, { student_id: k.id })).status, 403);
  assert.ok(!(await dad.c.post(`${P(A)}/parent/me`)).data.children.some((x) => x.id === k.id));
  const d = (await A.admin.get(`/api/admin/parents/${dad.id}`)).data;
  assert.ok(d.history.some((h) => h.name === "مريم عبدالله سالم" && h.removed_at));
  assert.equal((await A.admin.post(`/api/admin/parents/${dad.id}/unlink`, { student_id: k.id })).status, 404);
});

test("إضافة ابن من الحساب: بمعرّفه مباشرة، أو بطلب تراجعه الإدارة؛ ولا ربط بلا تحقق", async () => {
  const k = kids["مريم"];
  // معرّف خاطئ
  assert.equal((await dad.c.post(`${P(A)}/parent/children/add`, { key: "AAAA-BBBB" })).status, 404);
  // بالمعرّف (رابط البطاقة أيضًا مقبول)
  const r = await dad.c.post(`${P(A)}/parent/children/add`, { key: `https://x.app/${A.id}?k=${k.access_key}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked, true);
  // المدرسة تشترط الموافقة: يصير طلبًا
  await A.admin.put("/api/admin/parents/settings", { link_by_key: false });
  const [other] = A.students;
  const req = await mom.c.post(`${P(A)}/parent/children/add`, { key: other.access_key });
  assert.equal(req.data.requested, true);
  assert.equal((await mom.c.post(`${P(A)}/student`, { student_id: other.id })).status, 403, "قبل الموافقة لا وصول");
  const pending = (await A.admin.get("/api/admin/parents/requests")).data;
  assert.equal(pending.length, 1);
  assert.equal((await A.admin.post(`/api/admin/parents/requests/${pending[0].id}`, { approve: true })).status, 200);
  assert.equal((await mom.c.post(`${P(A)}/student`, { student_id: other.id })).status, 200);
  // طلب برقم الطالب واسمه: الرد واحد سواء وُجد أو لا (لا يكشف الطلاب)
  const fake = await dad.c.post(`${P(A)}/parent/children/request`, { student_no: "999999", student_name: "غير موجود" });
  assert.equal(fake.data.requested, true);
  assert.equal((await A.admin.get("/api/admin/parents/requests")).data.length, 0);
  await A.admin.put("/api/admin/parents/settings", { link_by_key: true });
});

test("التفعيل الذاتي: جوال المدرسة + معرّف ابن ← حساب واحد مع إخوته، والبيانات الخاطئة مرفوضة", async () => {
  const s1 = await addStudent(A, "فهد ناصر علي", "770009001");
  const s2 = await addStudent(A, "نورة ناصر علي", "770009001");
  const c = client(srv.base);
  assert.equal((await c.post(`${P(A)}/parent/activate`, { phone: "770009999", key: s1.access_key, password: "Fahd-Pass-1" })).status, 400);
  const r = await c.post(`${P(A)}/parent/activate`, { phone: "770009001", key: s1.access_key, password: "Fahd-Pass-1", name: "ناصر علي" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.siblings, 1);
  const me = (await c.post(`${P(A)}/parent/me`)).data;
  assert.deepEqual(me.children.map((k) => k.id).sort(), [s1.id, s2.id].sort());
  // تفعيل ثانٍ بنفس الجوال: نفس الحساب (استعادة كلمة المرور) والأجهزة السابقة تخرج
  const c2 = client(srv.base);
  assert.equal((await c2.post(`${P(A)}/parent/activate`, { phone: "770009001", key: s2.access_key, password: "Fahd-Pass-2" })).status, 200);
  assert.equal((await c.post(`${P(A)}/parent/me`)).status, 401);
  assert.equal((await A.admin.get("/api/admin/parents?search=770009001")).data.length, 1);
});

test("الدخول والصلاحيات: كلمة مرور خاطئة، قفل بعد المحاولات، الحساب الموقوف، ولا وصول لواجهة الإدارة", async () => {
  assert.equal((await login(A, DAD, "wrong-pass")).r.status, 401);
  assert.equal((await login(A, "779999999", "x")).r.status, 401);
  for (let i = 0; i < 5; i++) await login(A, MOM, "bad-pass-x");
  assert.equal((await login(A, MOM, "anything")).r.status, 429);
  assert.equal((await A.admin.post(`/api/admin/parents/${dad.id}/disable`)).status, 200);
  assert.equal((await dad.c.post(`${P(A)}/parent/me`)).status, 401, "الإيقاف ينهي الجلسات");
  assert.equal((await login(A, DAD, "Dad-Pass-2026")).r.status, 401);
  await A.admin.post(`/api/admin/parents/${dad.id}/enable`);
  const rs = await A.admin.post(`/api/admin/parents/${dad.id}/reset-password`);
  const { c } = await login(A, DAD, rs.data.password);
  assert.equal((await c.get("/api/admin/parents")).status, 401);
  assert.equal((await A.teacher.get("/api/admin/parents")).status, 401);
});
