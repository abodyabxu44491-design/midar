/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport, deliveriesIdle, notify } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

let srv, A, B;
const P = (S) => `/api/public/${S.id}`;
const settle = async () => { await new Promise((r) => setTimeout(r, 150)); await deliveriesIdle(); };
const DAD = "771100200", MOM = "733300400";
const kids = {};
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
  for (const k of me.children) {
    const f = await c.post(`${P(A)}/student`, { student_id: k.id });
    assert.equal(f.status, 200, JSON.stringify(f.data));
    assert.equal(f.data.student.name, k.name);
  }
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
  assert.equal((await client(srv.base).post(`${P(A)}/student`, { student_id: kids["أحمد"].id })).status, 401);
  assert.equal((await client(srv.base).post(`${P(A)}/student`, A.parent(other))).status, 200);
});

test("العزل بين المدارس: جلسة ولي أمر في مدرسة أ لا تفتح شيئًا في مدرسة ب", async () => {
  const [b1] = B.students;
  assert.equal((await dad.c.post(`${P(B)}/student`, { student_id: b1.id })).status, 401);
  assert.equal((await dad.c.post(`${P(B)}/parent/me`)).status, 401);
  assert.equal((await dad.c.post(`${P(B)}/student`, { student_id: kids["أحمد"].id })).status, 401);
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
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Aden" }); // the school's own day
  await transaction({ tenantId: A.id }, (q) => q(`INSERT INTO timetable_settings (tenant_id, days) VALUES (app_tenant(), '{0,1,2,3,4,5,6}')
    ON CONFLICT (tenant_id) DO UPDATE SET days = EXCLUDED.days`));
  assert.equal((await A.admin.post("/api/admin/attendance", { date, entries: [
    { student_id: kids["أحمد"].id, status: "present" }, { student_id: kids["محمد"].id, status: "late" }] })).status, 200);
  await transaction({ tenantId: A.id }, (q) => notify(q, { event: "homework", students: [kids["محمد"].id], title: "واجب جديد", body: "الرياضيات" }));
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
  assert.equal((await dad.c.post(`${P(A)}/parent/children/add`, { key: "AAAA-BBBB" })).status, 404);
  const r = await dad.c.post(`${P(A)}/parent/children/add`, { key: `https://x.app/${A.id}?k=${k.access_key}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked, true);
  await A.admin.put("/api/admin/parents/settings", { link_by_key: false });
  const [other] = A.students;
  const req = await mom.c.post(`${P(A)}/parent/children/add`, { key: other.access_key });
  assert.equal(req.data.requested, true);
  assert.equal((await mom.c.post(`${P(A)}/student`, { student_id: other.id })).status, 403, "قبل الموافقة لا وصول");
  const pending = (await A.admin.get("/api/admin/parents/requests")).data;
  assert.equal(pending.length, 1);
  assert.equal((await A.admin.post(`/api/admin/parents/requests/${pending[0].id}`, { approve: true })).status, 200);
  assert.equal((await mom.c.post(`${P(A)}/student`, { student_id: other.id })).status, 200);
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

test("إنشاء ولي الأمر حسابه بنفسه بالبريد: معرّفات أبنائه ← حساب جاهز بكل أبنائه، والجلسة محفوظة", async () => {
  const s1 = await addStudent(A, "يوسف سعيد عمر", "770008001");
  const s2 = await addStudent(A, "هند سعيد عمر", "770008001");
  const c = client(srv.base);
  const bad = await c.post(`${P(A)}/parent/register`, { name: "سعيد عمر", identifier: "Saeed@Example.com", password: "Saeed-Pass-1",
    keys: [s1.access_key, "ZZZZ-9999"] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.data.invalid, [1]);
  assert.equal((await A.admin.get("/api/admin/parents?search=saeed@example.com")).data.length, 0);
  const r = await c.post(`${P(A)}/parent/register`, { name: "سعيد عمر", identifier: "Saeed@Example.com", password: "Saeed-Pass-1",
    keys: [s1.access_key, `https://x.app/${A.id}?k=${s2.access_key}`] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked.length, 2);
  const me = (await c.post(`${P(A)}/parent/me`)).data;
  assert.deepEqual(me.children.map((k) => k.id).sort(), [s1.id, s2.id].sort());
  assert.equal(me.parent.email, "saeed@example.com");
  assert.equal(me.parent.must_change_password, false);
  assert.equal((await c.post(`${P(A)}/student`, { student_id: s1.id })).status, 200);
  const dup = await client(srv.base).post(`${P(A)}/parent/register`, { name: "آخر", identifier: "SAEED@example.com", password: "Other-Pass-1", keys: [s1.access_key] });
  assert.equal(dup.status, 409);
  const c2 = client(srv.base);
  const li = await c2.post(`${P(A)}/parent/login`, { identifier: "saeed@EXAMPLE.com", password: "Saeed-Pass-1" });
  assert.equal(li.status, 200, JSON.stringify(li.data));
  assert.equal((await c2.post(`${P(A)}/parent/me`)).data.children.length, 2);
  const [row] = (await A.admin.get("/api/admin/parents?search=saeed@")).data;
  assert.equal(row.source, "self");
  assert.equal(row.phone, null);
  assert.equal((await client(srv.base).post(`${P(A)}/parent/register`, { name: "س", identifier: "x@y.com", password: "Xx-Pass-12", keys: [] })).status, 400);
});

test("إنشاء الحساب بالجوال: الإخوة بنفس الجوال يُربطون فقط إن أثبت المعرّف أنه جواله", async () => {
  const a1 = await addStudent(A, "ريم فيصل حسن", "770007001");
  const a2 = await addStudent(A, "ليلى فيصل حسن", "770007001");
  const other = await addStudent(A, "عمر صالح هادي", "770007002");
  const x = client(srv.base);
  const rx = await x.post(`${P(A)}/parent/register`, { name: "صالح", identifier: "770007001", password: "Salh-Pass-1", keys: [other.access_key] });
  assert.equal(rx.status, 200, JSON.stringify(rx.data));
  assert.equal(rx.data.siblings.length, 0);
  assert.deepEqual((await x.post(`${P(A)}/parent/me`)).data.children.map((k) => k.id), [other.id]);
  assert.equal((await x.post(`${P(A)}/student`, { student_id: a1.id })).status, 403);
  const c = client(srv.base);
  const exists = await c.post(`${P(A)}/parent/register`, { name: "فيصل حسن", identifier: "+967 770007001", password: "Faisal-Pass-1", keys: [a1.access_key] });
  assert.equal(exists.status, 409);
  const rs = await c.post(`${P(A)}/parent/activate`, { identifier: "770007001", key: a1.access_key, password: "Faisal-Pass-2" });
  assert.equal(rs.status, 200, JSON.stringify(rs.data));
  assert.equal((await x.post(`${P(A)}/parent/me`)).status, 401);
  const ids = (await c.post(`${P(A)}/parent/me`)).data.children.map((k) => k.id);
  assert.ok(ids.includes(a1.id) && ids.includes(a2.id));
});

test("حساب أنشأته الإدارة ولم يُستخدم: يستلمه ولي الأمر بالتسجيل بمعرّف ابنه، بلا حساب مكرر", async () => {
  const s = await addStudent(A, "سلمان راشد يحيى", "770006001");
  await A.admin.post("/api/admin/parents/auto-create");
  const c = client(srv.base);
  const r = await c.post(`${P(A)}/parent/register`, { name: "راشد يحيى", identifier: "770006001", password: "Rashed-Pass-1", keys: [s.access_key] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const list = (await A.admin.get("/api/admin/parents?search=770006001")).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].must_change_password, false);
  assert.equal(list[0].children.length, 1);
});

test("إضافة عدة أبناء دفعة واحدة من الحساب، والمعرّف الخاطئ يُعلَّم بموضعه", async () => {
  const s1 = await addStudent(A, "جود ماجد أحمد", "770005001");
  const s2 = await addStudent(A, "تالا ماجد أحمد", "770005002");
  const s3 = await addStudent(A, "زيد ماجد أحمد", "770005003");
  const c = client(srv.base);
  assert.equal((await c.post(`${P(A)}/parent/register`, { name: "ماجد أحمد", identifier: "majed@example.com", password: "Majed-Pass-1", keys: [s1.access_key] })).status, 200);
  const bad = await c.post(`${P(A)}/parent/children/add`, { keys: [s2.access_key, "nonsense"] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.data.invalid, [1]);
  const r = await c.post(`${P(A)}/parent/children/add`, { keys: [s2.access_key, s3.access_key, s1.access_key] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.linked.length, 2);
  assert.equal(r.data.already.length, 1);
  assert.equal((await c.post(`${P(A)}/parent/me`)).data.children.length, 3);
  assert.equal((await c.post(`${P(A)}/parent/children/add`, { keys: [B.students[0].access_key] })).status, 400);
});

const freshLogin = async () => login(A, DAD, (await A.admin.post(`/api/admin/parents/${dad.id}/reset-password`)).data.password);

test("الأجهزة: ابن يُربط لاحقًا تصله إشعاراته فورًا على جوال الأب، والخروج من جهاز يوقف إشعاراته وحده", async () => {
  const { c, r } = await freshLogin();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sub = (n) => ({ endpoint: `https://push.example.com/send/dad-${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
  for (const n of [1, 2]) assert.equal((await c.post(`${P(A)}/parent/push`, { subscription: sub(n) })).status, 200);
  const late = await addStudent(A, "يوسف عبدالله سالم", DAD);
  const rows = (sid) => transaction({ tenantId: A.id }, (q) => q("SELECT endpoint FROM push_subscriptions WHERE student_id = $1 AND parent_id = $2 ORDER BY endpoint", [sid, dad.id]));
  const linked = (await transaction({ tenantId: A.id }, (q) => q("SELECT 1 FROM parent_students WHERE student_id = $1 AND parent_id = $2 AND removed_at IS NULL", [late.id, dad.id]))).length;
  assert.equal(linked, 1, "رُبط تلقائيًا برقم الجوال");
  assert.deepEqual((await rows(late.id)).map((x) => x.endpoint), [sub(1).endpoint, sub(2).endpoint], "جهازا الأب يستقبلان إشعارات الابن الجديد");
  const out = await c.post(`${P(A)}/parent/logout`, { endpoint: sub(1).endpoint });
  assert.equal(out.status, 200);
  const left = await transaction({ tenantId: A.id }, (q) => q("SELECT DISTINCT endpoint FROM push_subscriptions WHERE parent_id = $1", [dad.id]));
  assert.deepEqual(left.map((x) => x.endpoint), [sub(2).endpoint], "الجهاز الذي خرج لم يعد يستقبل، والآخر باقٍ");
});

test("الجلسة تبقى ما دام التطبيق مستخدمًا: الكوكي يتجدد ولا ينتهي بعد مدة ثابتة", async () => {
  const { c, r } = await freshLogin();
  assert.equal(r.status, 200);
  await transaction({ platform: true }, (q) => q("UPDATE sessions SET last_seen_at = now() - interval '7 hours' WHERE parent_id = $1", [dad.id]));
  const res = await fetch(`${srv.base}${P(A)}/parent/me`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: "{}" });
  assert.equal(res.status, 200);
  const set = res.headers.getSetCookie().find((x) => x.includes("midar_p="));
  assert.ok(set, "أُعيد إصدار الكوكي");
  const age = Number(/Max-Age=(\d+)/.exec(set)?.[1]);
  assert.ok(age > 170 * 86400, `مدة طويلة: ${age}`);
});
