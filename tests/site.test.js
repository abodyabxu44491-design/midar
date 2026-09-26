// اختبارات: موقع المدرسة المصغّر، الروابط المولَّدة، إصلاحات الدخول والجلسات، وصفحة المدرسة عند المالك
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { purgeExpiredSessions } from "../src/core/auth/sessions.js";

let srv, owner, admin;
const s = {};
const pub = (path, body = {}) => client(srv.base).post(`/api/public/${s.id}${path}`, { access: s.code, ...body });

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  s.id = `site-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: s.id, name: "مدرسة الموقع", max_students: 500 });
  s.code = r.data.credentials.directory_code;
  s.adminPw = r.data.credentials.password;
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: s.id, username: "admin", password: s.adminPw })).status, 200);
  // الهيكل: مرحلة ← صفان ← شعب
  const st = await admin.post("/api/admin/setup/stages", { name: "الابتدائية" });
  assert.equal(st.status, 201, JSON.stringify(st.data));
  s.stage = st.data.id;
  s.g1 = (await admin.post("/api/admin/setup/grades", { name: "الأول", stage_id: s.stage })).data.id;
  s.g2 = (await admin.post("/api/admin/setup/grades", { name: "الثاني", stage_id: s.stage })).data.id;
  const secs = await admin.post(`/api/admin/setup/grades/${s.g1}/sections`, { count: 2 });
  assert.equal(secs.status, 201, JSON.stringify(secs.data));
  [s.c1, s.c2] = secs.data.sections.map((x) => x.id);
  s.secNames = secs.data.sections.map((x) => x.name);
  s.students = [];
  for (let i = 0; i < 35; i++) {
    const r2 = await admin.post("/api/admin/students", { name: `طالب رقم ${String(i).padStart(2, "0")}`, class_id: i < 33 ? s.c1 : s.c2, guardian_phone: "0500000000" });
    s.students.push(r2.data.student ?? r2.data);
  }
});

after(async () => { await srv.close(); await endPool(); });

test("الرئيسية: الاسم والنبذة والتواصل حسب إعدادات الإدارة، بلا روابط داخلية", async () => {
  await admin.put("/api/admin/settings/public-page", { about: "مدرسة نموذجية في قلب المدينة", show_contact: true });
  const home = await pub("/home");
  assert.equal(home.status, 200, JSON.stringify(home.data));
  assert.equal(home.data.school.name, "مدرسة الموقع");
  assert.equal(home.data.school.about, "مدرسة نموذجية في قلب المدينة");
  assert.ok(home.data.features.directory);
  assert.ok(!/idara|\/api\/admin|password/.test(JSON.stringify(home.data)), "لا روابط دخول ولا بيانات حساسة في الصفحة العامة");
  await admin.put("/api/admin/settings/public-page", { show_contact: false });
  assert.equal((await pub("/home")).data.contact, null, "التواصل يختفي عند إيقافه");
  assert.equal((await client(srv.base).post(`/api/public/${s.id}/home`, { access: "WRONG123" })).status, 401, "وضع الرمز محمي");
});

test("الطلاب: المراحل ← الصفوف ← الشعب ← الطلاب صفحة بعد صفحة (الاسم فقط)", async () => {
  const st = await pub("/structure");
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const stage = st.data.stages.find((x) => x.name === "الابتدائية");
  assert.ok(stage, "المرحلة ظاهرة");
  const g1 = stage.grades.find((g) => g.id === s.g1);
  assert.equal(g1.sections, 2);

  const grade = await pub("/grade", { grade_id: s.g1 });
  assert.deepEqual(grade.data.sections.map((c) => c.name), s.secNames, "الشعب بترتيبها");

  const p1 = await pub("/section", { class_id: s.c1, offset: 0, limit: 30 });
  assert.equal(p1.data.students.length, 30);
  assert.equal(p1.data.total, 33);
  assert.deepEqual(Object.keys(p1.data.students[0]).sort(), ["id", "name"], "بطاقة الطالب: الاسم فقط");
  const p2 = await pub("/section", { class_id: s.c1, offset: 30, limit: 30 });
  assert.equal(p2.data.students.length, 3, "عرض المزيد");
  const search = await pub("/section", { class_id: s.c1, q: "رقم 07" });
  assert.equal(search.data.total, 1);

  await admin.put("/api/admin/settings/public-page", { show_student_names: false });
  assert.equal((await pub("/section", { class_id: s.c1 })).data.students, null, "الأسماء مخفية");
  await admin.put("/api/admin/settings/public-page", { show_classes: false });
  assert.equal((await pub("/structure")).status, 403, "الصفوف مخفية");
  await admin.put("/api/admin/settings/public-page", { show_classes: true, show_student_names: true });
});

test("البحث بالمعرّف: يفتح الملف بالمعرّف الصحيح فقط، والمحاولات الخاطئة تُحسب", async () => {
  const full = (await admin.get("/api/admin/students")).data;
  const target = full[0];
  const ok = await pub("/find", { key: target.access_key });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.student_id, target.id);
  const bad = await pub("/find", { key: "ZZZZ-2222" });
  assert.equal(bad.status, 401);
  const [row] = await transaction({ platform: true }, (q) => q(
    "SELECT count(*)::int AS n FROM security_events WHERE kind = 'student_key_failed_ip' AND subject LIKE $1", [`${s.id}:find:%`]));
  assert.ok(row.n >= 1, "المحاولة الخاطئة مسجلة (في معاملة مستقلة)");
  assert.equal((await pub("/find", { key: "bad" })).status, 400);
});

test("الروابط تُولَّد من الخادم، ولكل دور رابطه", async () => {
  const me = await admin.get("/api/admin/me");
  const L = me.data.links;
  assert.ok(L.public.home.endsWith(`/${s.id}`));
  assert.ok(L.staff.admin.endsWith(`/${s.id}/idara?role=admin`));
  assert.ok(L.staff.teacher.endsWith("role=teacher") && L.staff.accountant.endsWith("role=accountant"));
  const page = await fetch(L.staff.teacher);
  assert.equal(page.status, 200, "رابط الدور يعمل");
});

test("صفحة المدرسة عند المالك: الروابط والاشتراك وأسماء المستخدمين، بدون كلمات مرور", async () => {
  const o = await owner.get(`/api/owner/tenants/${s.id}/overview`);
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.school.students, 35);
  assert.deepEqual(o.data.staff.map((u) => u.username), ["admin"]);
  assert.ok(o.data.subscription.plan_name);
  assert.ok(o.data.links.staff.admin.includes("role=admin"));
  assert.ok(!/password_hash|\$scrypt|\$2[aby]\$/.test(JSON.stringify(o.data)), "لا بصمات كلمات مرور");
  const reset = await owner.post(`/api/owner/tenants/${s.id}/reset-admin`, {});
  assert.match(reset.data.credentials.password, /^[A-Z0-9]{4}-[A-Z0-9]{4}-\d{2}$/);
});

test("الجلسات: «ابقني مسجلًا» افتراضي بكوكي دائم، وبدونه كوكي ينتهي بإغلاق المتصفح، والتنظيف لا يحذف الجلسات الطويلة", async () => {
  const pw = (await owner.post(`/api/owner/tenants/${s.id}/reset-admin`, {})).data.credentials.password;
  const res = await fetch(`${srv.base}/api/staff/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: srv.base },
    body: JSON.stringify({ school: s.id, username: "admin", password: pw }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie().find((c) => c.includes("midar_a"));
  assert.match(cookie, /Max-Age=\d+/, "البقاء مسجلًا هو الافتراضي");
  const token = cookie.split(";")[0];

  const res2 = await fetch(`${srv.base}/api/staff/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: srv.base },
    body: JSON.stringify({ school: s.id, username: "admin", password: pw, remember: false }) });
  assert.doesNotMatch(res2.headers.getSetCookie().find((c) => c.includes("midar_a")), /Max-Age/, "بدون تذكر: كوكي جلسة المتصفح");

  // جلسة «ابقني مسجلًا» خاملة يومين: كانت تُحذف في التنظيف (خطأ سابق)
  await transaction({ platform: true }, (q) => q(
    "UPDATE sessions SET last_seen_at = now() - interval '2 days' WHERE tenant_id = $1 AND idle_minutes IS NOT NULL", [s.id]));
  await purgeExpiredSessions();
  const me = await fetch(`${srv.base}/api/admin/me`, { headers: { Cookie: token } });
  assert.equal(me.status, 200, "الجلسة الطويلة باقية بعد يومين بلا استخدام");
});

test("فحص بيئة التشغيل للمالك", async () => {
  const d = await owner.get("/api/owner/settings/diagnostics");
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.ok(Array.isArray(d.data.checks) && d.data.checks.length >= 5);
  assert.equal(typeof d.data.db.ms, "number");
  assert.equal((await admin.get("/api/owner/settings/diagnostics")).status, 401, "للمالك فقط");
});
