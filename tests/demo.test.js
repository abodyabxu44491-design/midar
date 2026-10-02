// مدرسة العرض التجريبي (للقراءة فقط) + الصفحات العامة: الخصوصية والشروط ومحركات البحث
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";
import { forgetDemoCache } from "../src/modules/shared/demo.service.js";

let srv, A, B;

before(async () => {
  srv = await startServer();
  // لا مدرسة عرض من اختبارات سابقة
  await transaction({ platform: true }, (q) => q("UPDATE tenants SET is_demo = false WHERE is_demo"));
  forgetDemoCache();
  A = await readySchool(srv.base, { prefix: "demo", students: 2 });
  B = await readySchool(srv.base, { prefix: "real", students: 1 });
});
after(async () => {
  await A.owner.patch(`/api/owner/tenants/${A.id}`, { is_demo: false });
  await A.owner.put("/api/owner/settings", { landing_mode: "blank" });
  await srv.close(); await endPool();
});

const visitor = () => client(srv.base);
const start = (c, role) => c.post("/api/public/demo/start", { role });

test("بلا مدرسة عرض: الدخول التجريبي غير متاح ولا يظهر في الصفحة", async () => {
  assert.equal((await start(visitor(), "admin")).status, 404);
  await A.owner.put("/api/owner/settings", { landing_mode: "marketing" });
  assert.equal((await visitor().get("/api/site")).data.demo, false);
});

test("المالك يختار مدرسة العرض، والزائر يدخلها بكل الأدوار", async () => {
  assert.equal((await A.owner.patch(`/api/owner/tenants/${A.id}`, { is_demo: true })).status, 200);
  assert.equal((await visitor().get("/api/site")).data.demo, true);
  const list = (await A.owner.get("/api/owner/tenants")).data;
  assert.equal(list.find((t) => t.id === A.id).is_demo, true);
  assert.equal((await A.owner.get(`/api/owner/tenants/${A.id}/overview`)).data.school.is_demo, true);

  const adm = visitor();
  const r = await start(adm, "admin");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.url, `/${A.id}/idara?role=admin`);
  assert.equal((await adm.get("/api/admin/me")).status, 200);
  assert.equal((await adm.get("/api/admin/students")).status, 200);

  const tch = visitor();
  assert.equal((await start(tch, "teacher")).status, 200);
  assert.equal((await tch.get("/api/teacher/me")).status, 200);

  const par = await start(visitor(), "parent");
  assert.match(par.data.url, new RegExp(`^/${A.id}\\?k=`));
  assert.equal((await start(visitor(), "owner")).status, 400);
});

test("مدرسة العرض للقراءة فقط: يُرفض كل تعديل، حتى من حساباتها الأصلية", async () => {
  const adm = visitor();
  await start(adm, "admin");
  const w = await adm.post("/api/admin/students", { name: "طالب جديد تجريبي", class_id: A.c1.id });
  assert.equal(w.status, 403);
  assert.equal(w.data.code, "demo_readonly");
  assert.equal((await adm.post("/api/admin/password", { current: "x", next: "NewPass#2026x" })).data.code, "demo_readonly");
  // تقارير القراءة (POST) مسموحة
  assert.notEqual((await adm.post("/api/admin/ai/report/summary", {})).data?.code, "demo_readonly");
  // الخروج مسموح
  assert.equal((await adm.post("/api/admin/logout", {})).status, 200);

  const tch = visitor();
  await start(tch, "teacher");
  const e = await tch.post("/api/teacher/exams", { class_id: A.c1.id, subject_id: A.math.id, title: "تجربة", max_score: 10 });
  assert.equal(e.data.code, "demo_readonly");

  // المدير الحقيقي للمدرسة نفسها أيضًا لا يعدّل ما دامت للعرض
  assert.equal((await A.admin.post("/api/admin/students", { name: "طالب من المدير", class_id: A.c1.id })).data.code, "demo_readonly");
  assert.equal((await A.admin.get("/api/admin/students")).status, 200);
});

test("صفحة ولي الأمر في مدرسة العرض: القراءة تعمل، والإرسال يُرفض", async () => {
  const s = A.students[0];
  const p = visitor();
  const file = await p.post(`/api/public/${A.id}/student`, A.parent(s));
  assert.equal(file.status, 200, JSON.stringify(file.data));
  const ex = await p.post(`/api/public/${A.id}/student/excuse`, { ...A.parent(s), day: "2026-01-05", reason: "مريض" });
  assert.equal(ex.status, 403);
  assert.equal(ex.data.code, "demo_readonly");
  assert.equal((await p.post(`/api/public/${A.id}/admissions`, { student_name: "طالب جديد", guardian_name: "ولي", guardian_phone: "771234567" })).data?.code, "demo_readonly");
});

test("المدارس الأخرى لا تتأثر، ومدرسة عرض واحدة فقط", async () => {
  const add = await B.admin.post("/api/admin/students", { name: "طالب مدرسة حقيقية", class_id: B.c1.id });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  // تحويل العرض لمدرسة أخرى يلغي الأولى تلقائيًا
  assert.equal((await B.owner.patch(`/api/owner/tenants/${B.id}`, { is_demo: true })).status, 200);
  const [a] = await transaction({ platform: true }, (q) => q("SELECT is_demo FROM tenants WHERE id = $1", [A.id]));
  assert.equal(a.is_demo, false);
  assert.equal((await A.admin.post("/api/admin/students", { name: "طالب بعد إيقاف العرض", class_id: A.c1.id })).status, 201);
  assert.equal((await B.admin.post("/api/admin/students", { name: "طالب ممنوع", class_id: B.c1.id })).data.code, "demo_readonly");
  assert.equal((await B.owner.patch(`/api/owner/tenants/${B.id}`, { is_demo: false })).status, 200);
  assert.equal((await start(visitor(), "admin")).status, 404);
});

test("الصفحات العامة: الخصوصية والشروط ومحركات البحث، ورموز محجوزة", async () => {
  for (const [path, text] of [["/privacy", "سياسة الخصوصية"], ["/terms", "شروط الاستخدام"]]) {
    const res = await fetch(srv.base + path);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(text));
    assert.equal(res.headers.get("x-robots-tag"), null, `${path} قابلة للفهرسة`);
  }
  const home = await fetch(`${srv.base}/`);
  assert.equal(home.headers.get("x-robots-tag"), null);
  const html = await home.text();
  assert.ok(html.includes(`<link rel="canonical" href="${srv.base}/">`));
  assert.ok(!html.includes("__ORIGIN__"));
  // صفحة المدرسة (فيها أسماء طلاب) تبقى مخفية عن محركات البحث
  assert.equal((await fetch(`${srv.base}/${B.id}`)).headers.get("x-robots-tag"), "noindex, nofollow");
  const robots = await (await fetch(`${srv.base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \//);
  assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
  assert.match(await (await fetch(`${srv.base}/sitemap.xml`)).text(), /<loc>.*\/privacy<\/loc>/);
  for (const code of ["privacy", "terms", "demo"]) {
    assert.equal((await A.owner.post("/api/owner/tenants", { id: code, name: "محجوز" })).status, 400);
  }
});
