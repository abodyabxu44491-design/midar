// منطقة الحذر: لا تنفيذ دون المراحل (تأكيد برمز المدرسة + إعادة التحقق + نسخة احتياطية تلقائية)،
// ورمز العملية لا يُستخدم مرتين، والاستعادة ترجع البيانات كما كانت، والعزل بين المدارس، وصلاحيات المدير، والتسجيل.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner;
const A = {}, B = {};
const D = "/api/owner/danger";

async function school(o, name) {
  o.id = `dz-${uid()}`.slice(0, 28);
  const r = await owner.post("/api/owner/tenants", { id: o.id, name, max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  o.pw = r.data.credentials.password; o.code = r.data.credentials.directory_code;
  o.admin = client(srv.base);
  assert.equal((await o.admin.post("/api/staff/login", { school: o.id, username: "admin", password: o.pw })).status, 200);
  o.cls = (await o.admin.post("/api/admin/structure/classes", { name: "الأول - أ" })).data.id;
  for (const n of ["طالب أول", "طالب ثان"]) {
    const s = await o.admin.post("/api/admin/students", { name: n, class_id: o.cls });
    o.student ??= s.data.id ?? s.data[0]?.id; o.key ??= s.data.access_key ?? s.data[0]?.access_key;
  }
  await o.admin.post("/api/admin/announcements", { title: "تعميم تجريبي", body: "نص" });
  // حضور ليوم دراسي
  for (let n = 1; n < 15; n++) {
    const d = new Date(); d.setDate(d.getDate() - n); const day = d.toLocaleDateString("en-CA");
    const ds = (await o.admin.get(`/api/admin/attendance/day-status?date=${day}`)).data;
    if (ds.study_day && !ds.holiday) { o.day = day; break; }
  }
  const at = await o.admin.post("/api/admin/attendance", { date: o.day, entries: [{ student_id: o.student, status: "absent", excuse: "مرض" }] });
  assert.equal(at.status, 200, JSON.stringify(at.data));
}
const count = (o, table) => transaction({ tenantId: o.id, platform: true }, async (q) => (await q(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [o.id]))[0].n);
const run = async (o, op, params = {}, extra = {}) => {
  const p = await owner.post(`${D}/plan`, { tenant: o.id, op, params });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const x = await owner.post(`${D}/${p.data.id}/execute`, { tenant: o.id, token: p.data.token, confirm: o.id, password: ownerPassword, ...extra });
  return { plan: p.data, res: x };
};

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await school(A, "مدرسة الحذر أ");
  await school(B, "مدرسة الحذر ب");
});
after(async () => { await srv.close(); await endPool(); });

test("الكتالوج: عمليات المدير جزء محدود، وكل عمليات المالك منفصلة عن الاشتراكات", async () => {
  const o = (await owner.get(`${D}/catalog`)).data;
  const a = (await A.admin.get("/api/admin/danger/catalog")).data;
  assert.ok(o.operations.some((x) => x.key === "school_delete"));
  assert.ok(!a.operations.some((x) => ["school_delete", "school_reset", "backup_restore", "archive"].includes(x.key)));
  assert.ok(!a.categories.some((c) => ["finance", "students", "grades"].includes(c.key)), "فئات المدير آمنة فقط");
  assert.equal(a.allowed, true, "المدير الأول يملك الصلاحية");
  assert.ok(!JSON.stringify(o).includes("subscription"), "لا عمليات اشتراكات");
});

test("لا تنفيذ دون تأكيد وتحقق، والنسخة تلقائية، والرمز لا يُستخدم مرتين", async () => {
  const p = (await owner.post(`${D}/plan`, { tenant: A.id, op: "data_purge", params: { categories: ["attendance"] } })).data;
  assert.equal(p.affected.find((x) => x.table === "attendance").count, 1, "ما سيتأثر بالأرقام الحقيقية");
  assert.ok(p.unaffected.length && p.backup_required && p.reauth);
  assert.equal(p.confirm_text, A.id);
  const go = (b) => owner.post(`${D}/${p.id}/execute`, { tenant: A.id, token: p.token, ...b });
  assert.equal((await go({ confirm: "خطأ", password: ownerPassword })).status, 400, "رمز التأكيد خاطئ");
  assert.equal((await go({ confirm: A.id, password: "wrong-password" })).status, 401, "إعادة التحقق");
  assert.equal(await count(A, "attendance"), 1, "لم يتغير شيء");
  assert.equal((await owner.post(`${D}/${p.id}/execute`, { tenant: A.id, token: "x".repeat(40), confirm: A.id, password: ownerPassword })).status, 404, "رمز العملية");
  const ok = await go({ confirm: A.id, password: ownerPassword });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.backup_id, "نسخة احتياطية قبل الحذف");
  assert.equal(await count(A, "attendance"), 0);
  assert.equal(await count(A, "students"), 2, "الفئات غير المختارة باقية");
  assert.equal(await count(B, "attendance"), 1, "المدرسة الأخرى لم تتأثر");
  assert.equal((await go({ confirm: A.id, password: ownerPassword })).status, 409, "لا تنفيذ مرتين");
  A.backup = ok.data.backup_id;
  const text = JSON.stringify((await owner.get("/api/owner/audit")).data);
  assert.ok(text.includes("منطقة الحذر") && text.includes(A.id), "مسجلة في سجل عمليات المنصة");
  const [n] = await transaction({ tenantId: A.id }, (q) => q("SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action LIKE 'منطقة الحذر%'", [A.id]));
  assert.ok(n.n >= 3, "وفي سجل المدرسة: التجهيز والنسخة والتنفيذ");
});

test("الاستعادة ترجع البيانات كما كانت (مع نسخة للوضع الحالي أولًا)، ولا تعبر بين المدارس", async () => {
  assert.equal((await owner.post(`${D}/plan`, { tenant: B.id, op: "backup_restore", params: { backup_id: A.backup } })).status, 404, "نسخة مدرسة أخرى");
  const { plan, res } = await run(A, "backup_restore", { backup_id: A.backup });
  assert.ok(plan.affected.some((x) => x.table === "attendance" && x.count === 0 && x.after === 1), "قبل وبعد");
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(res.data.backup_id && res.data.backup_id !== A.backup, "نسخة للوضع الحالي قبل الاستعادة");
  assert.equal(await count(A, "attendance"), 1, "عاد الحضور");
  const [row] = await transaction({ tenantId: A.id }, (q) => q("SELECT excuse FROM attendance WHERE student_id = $1", [A.student]));
  assert.equal(row.excuse, "مرض", "بالتفاصيل نفسها");
  assert.equal(await count(A, "sessions"), 0, "الجلسات انتهت");
  // الحسابات عادت بكلمات مرورها: المدير يدخل من جديد
  A.admin = client(srv.base);
  assert.equal((await A.admin.post("/api/staff/login", { school: A.id, username: "admin", password: A.pw })).status, 200);
  const p = await client(srv.base).post(`/api/public/${A.id}/student`, { access: A.code, student_id: A.student, key: A.key });
  assert.equal(p.status, 200, "ولي الأمر بالمعرّف نفسه");
});

test("المدير: عمليات محدودة بصلاحيته وبكلمة مروره", async () => {
  const plan = (body) => A.admin.post("/api/admin/danger/plan", body);
  assert.equal((await plan({ op: "school_delete" })).status, 403);
  assert.equal((await plan({ op: "data_purge", params: { categories: ["finance"] } })).status, 403);
  const p = (await plan({ op: "data_purge", params: { categories: ["announcements"] } })).data;
  const go = (b) => A.admin.post(`/api/admin/danger/${p.id}/execute`, { token: p.token, confirm: A.id, ...b });
  assert.equal((await go({ password: "wrong-pass-1" })).status, 401);
  const ok = await go({ password: A.pw });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(await count(A, "announcements"), 0);
  // مدرسة أخرى لا تُمس من حساب مدير هذه المدرسة
  assert.equal((await A.admin.post(`/api/admin/danger/${p.id}/execute`, { token: p.token, confirm: A.id, password: A.pw })).status, 409);
  // بدون الصلاحية: لا شيء
  await transaction({ tenantId: A.id }, (q) => q("UPDATE users SET can_danger_zone = false WHERE role = 'admin'"));
  assert.equal((await plan({ op: "sessions_kill" })).status, 403);
  assert.equal((await A.admin.get("/api/admin/danger/catalog")).data.allowed, false);
  await transaction({ tenantId: A.id }, (q) => q("UPDATE users SET can_danger_zone = true WHERE role = 'admin'"));
});

test("إعادة ضبط الحسابات: كلمات جديدة تُعرض مرة واحدة ولا تُحفظ في السجل", async () => {
  const t = await A.admin.post("/api/admin/teachers", { name: "أ. خالد", username: `k${uid()}`.slice(0, 18) });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const { res } = await run(A, "accounts_reset");
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const cred = res.data.result.credentials.find((c) => c.role === "teacher");
  assert.ok(cred?.password);
  assert.ok(!res.data.result.credentials.some((c) => c.role === "admin"), "المدير لا يُشمل افتراضيًا");
  const hist = (await owner.get(`${D}/history?tenant=${A.id}`)).data;
  assert.ok(!JSON.stringify(hist).includes(cred.password), "لا كلمات مرور في السجل");
  const tc = client(srv.base);
  assert.equal((await tc.post("/api/staff/login", { school: A.id, username: cred.username, password: cred.password })).status, 200);
});

test("القفل الطارئ يوقف الدخول والصفحة العامة فورًا، ورفعه يعيدها", async () => {
  assert.equal((await run(A, "emergency_lock", { reason: "اشتباه" })).res.status, 200);
  assert.equal((await A.admin.get("/api/admin/me")).status, 401, "الجلسات انتهت");
  assert.equal((await client(srv.base).post("/api/staff/login", { school: A.id, username: "admin", password: A.pw })).status, 403);
  assert.equal((await client(srv.base).post(`/api/public/${A.id}/student`, { access: A.code, student_id: A.student, key: A.key })).status, 404);
  assert.equal((await run(A, "emergency_unlock")).res.status, 200);
  A.admin = client(srv.base);
  assert.equal((await A.admin.post("/api/staff/login", { school: A.id, username: "admin", password: A.pw })).status, 200);
});

test("إعادة المدرسة لوضع البداية: يبقى المدير ويُفتح معالج الإعداد", async () => {
  const { res } = await run(A, "school_reset");
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(await count(A, "students"), 0);
  assert.equal(await count(A, "classes"), 0);
  assert.equal(await count(A, "teachers"), 0);
  const users = await transaction({ tenantId: A.id }, (q) => q("SELECT role FROM users"));
  assert.deepEqual(users.map((u) => u.role), ["admin"]);
  assert.equal(await count(A, "academic_years"), 1, "سنة دراسية جديدة كما عند الإنشاء");
  A.admin = client(srv.base);
  assert.equal((await A.admin.post("/api/staff/login", { school: A.id, username: "admin", password: A.pw })).status, 200);
  assert.equal(await count(B, "students"), 2, "المدرسة الأخرى سليمة");
});

test("حذف المدرسة نهائيًا: يُشترط الأرشفة، وتبقى نسخة أخيرة وسجل العمليات", async () => {
  assert.equal((await owner.post(`${D}/plan`, { tenant: B.id, op: "school_delete" })).status, 409, "أرشف أولًا");
  assert.equal((await run(B, "archive")).res.status, 200);
  assert.equal((await client(srv.base).post("/api/staff/login", { school: B.id, username: "admin", password: B.pw })).status, 403);
  const { res } = await run(B, "school_delete");
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [t] = await transaction({ platform: true }, (q) => q("SELECT 1 FROM tenants WHERE id = $1", [B.id]));
  assert.equal(t, undefined, "المدرسة حُذفت");
  const backups = (await owner.get(`${D}/backups?tenant=${B.id}`)).data;
  assert.ok(backups.some((b) => b.id === res.data.backup_id), "النسخة الأخيرة باقية");
  const [log] = await transaction({ tenantId: B.id }, (q) => q("SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action LIKE 'منطقة الحذر%'", [B.id]));
  assert.ok(log.n >= 3, "سجل العمليات محفوظ بعد الحذف");
});
