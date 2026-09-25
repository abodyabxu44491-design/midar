// اختبارات الأداء والإصدارات: التقسيم إلى صفحات، التصفية في الخادم، الضغط، إبطال الكاش، ورقم الإصدار
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { APP_VERSION } from "../src/core/version.js";

let srv, owner, admin, teacher;
const s = {};

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  s.id = `perf-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: s.id, name: "مدرسة الأداء", max_students: 500 });
  admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: s.id, username: "admin", password: r.data.credentials.password })).status, 200);
  s.c1 = (await admin.post("/api/admin/structure/classes", { name: "الأول" })).data.id;
  s.c2 = (await admin.post("/api/admin/structure/classes", { name: "الثاني" })).data.id;
  s.subject = (await admin.post("/api/admin/structure/subjects", { name: "العلوم" })).data.id;
  const names = ["أحمد", "بدر", "خالد", "سعد", "فهد", "ماجد", "نايف", "يوسف"];
  s.students = [];
  for (let i = 0; i < 24; i++) {
    const st = await admin.post("/api/admin/students", { name: `${names[i % 8]} الطالب ${i}`, class_id: i < 16 ? s.c1 : s.c2, guardian_phone: `05000000${String(i).padStart(2, "0")}` });
    assert.equal(st.status, 201, JSON.stringify(st.data));
    s.students.push(st.data);
  }
  for (const st of s.students.slice(0, 5)) {
    await admin.post("/api/admin/finance/invoices", { target: "student", target_id: st.student?.id ?? st.id, title: `رسوم ${st.student?.name ?? ""}`, amount: 100 });
  }
  const t = await admin.post("/api/admin/teachers", { name: "معلم الأداء", username: `pt${uid()}`, load: [{ class_id: s.c1, subject_id: s.subject }] });
  teacher = client(srv.base);
  assert.equal((await teacher.post("/api/staff/login", { school: s.id, username: t.data.credentials.username ?? t.data.username, password: t.data.credentials.password })).status, 200);
});

after(async () => { await srv.close(); await endPool(); });

const raw = (path, headers = {}) => fetch(`${srv.base}${path}`, { headers });

test("قائمة الطلاب: صفحات وتصفية في الخادم، وأعداد الشعب بدون تنزيل القائمة", async () => {
  const full = await admin.get("/api/admin/students");
  assert.equal(full.data.length, 24, "بدون limit: القائمة كاملة كما كانت");

  const page1 = await raw(`/api/admin/students?limit=10&offset=0`, { Cookie: admin.cookie() });
  assert.equal(page1.headers.get("x-total-count"), "24");
  const rows1 = await page1.json();
  assert.equal(rows1.length, 10);
  const rows3 = await (await raw(`/api/admin/students?limit=10&offset=20`, { Cookie: admin.cookie() })).json();
  assert.equal(rows3.length, 4, "الصفحة الأخيرة");
  assert.ok(!rows1.some((x) => rows3.some((y) => y.id === x.id)), "لا تكرار بين الصفحات");

  const summary = await admin.get("/api/admin/students?summary=1");
  const byClass = Object.fromEntries(summary.data.map((r) => [r.class_id, r.n]));
  assert.equal(byClass[s.c1], 16);
  assert.equal(byClass[s.c2], 8);

  const c2 = await admin.get(`/api/admin/students?class_id=${s.c2}&fields=basic&limit=100`);
  assert.equal(c2.data.length, 8);
  assert.deepEqual(Object.keys(c2.data[0]).sort(), ["class_id", "class_name", "id", "name"], "الحقول المختصرة فقط");

  const search = await admin.get(`/api/admin/students?q=${encodeURIComponent("خالد")}&limit=50`);
  assert.ok(search.data.length >= 3 && search.data.every((x) => x.name.includes("خالد")));
  const byPhone = await admin.get("/api/admin/students?q=0500000007&limit=50");
  assert.equal(byPhone.data.length, 1);
  const multi = await raw(`/api/admin/students?class_ids=${s.c1},${s.c2}&limit=5`, { Cookie: admin.cookie() });
  assert.equal(multi.headers.get("x-total-count"), "24");
});

test("الحضور: جوال ولي الأمر يصل للإدارة فقط وليس لبوابة المعلم", async () => {
  const day = new Date().toISOString().slice(0, 10);
  const a = await admin.get(`/api/admin/attendance?class_id=${s.c1}&date=${day}`);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.ok(a.data[0].guardian_phone, "الإدارة تحتاج الجوال لأزرار التنبيه");
  const tch = await teacher.get(`/api/teacher/attendance?class_id=${s.c1}&date=${day}`);
  assert.equal(tch.status, 200, JSON.stringify(tch.data));
  assert.equal(tch.data[0].guardian_phone, undefined, "المعلم لا يستلم بيانات التواصل");
});

test("الفواتير: صفحات وبحث وفلترة الطالب، والإجمالي بتجميع واحد", async () => {
  const all = await admin.get("/api/admin/finance/invoices");
  assert.equal(all.data.invoices.length, 5);
  assert.equal(all.data.total, 5);
  assert.equal(all.data.totals.fees_total, 500);
  const page = await admin.get("/api/admin/finance/invoices?limit=2&offset=0&totals=0");
  assert.equal(page.data.invoices.length, 2);
  assert.equal(page.data.total, 5);
  assert.equal(page.data.totals, undefined, "الإجمالي لا يُحسب مع كل صفحة");
  const sid = all.data.invoices[0].student_id;
  const mine = await admin.get(`/api/admin/finance/invoices?student_id=${sid}&totals=0`);
  assert.ok(mine.data.invoices.length >= 1 && mine.data.invoices.every((i) => i.student_id === sid));
  assert.ok(!("_total" in mine.data.invoices[0]));
});

test("الضغط: الاستجابات النصية مضغوطة", async () => {
  const r = await raw("/api/admin/students", { Cookie: admin.cookie(), "Accept-Encoding": "br" });
  assert.equal(r.headers.get("content-encoding"), "br");
  // fetch يفك الضغط تلقائيًا: نتحقق من الترويسة ثم من المحتوى المفكوك
  const html = await fetch(`${srv.base}/${s.id}/idara`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(html.headers.get("content-encoding"), "gzip");
  assert.ok((await html.text()).includes("app-version"));
});

test("الإصدار وإبطال الكاش: روابط بالإصدار، كاش دائم لها، والصفحات والإصدارات القديمة بلا كاش", async () => {
  const v = await (await raw("/api/version")).json();
  assert.equal(v.version, APP_VERSION);
  assert.equal((await raw("/api/site")).headers.get("x-app-version"), null, "خارج /api/* الداخلي");
  const me = await raw("/api/admin/me", { Cookie: admin.cookie() });
  assert.equal(me.headers.get("x-app-version"), APP_VERSION, "كل استجابة API تحمل الإصدار");

  const page = await raw(`/${s.id}/idara`);
  assert.equal(page.headers.get("cache-control"), "no-cache", "الصفحة نفسها لا تُخزَّن");
  const html = await page.text();
  assert.ok(html.includes(`<meta name="app-version" content="${APP_VERSION}">`));
  assert.ok(html.includes(`src="/v/${APP_VERSION}/staff-page/main.js"`), "نقطة البداية بالإصدار");
  assert.ok(html.includes(`href="/v/${APP_VERSION}/shared/css/app.css"`));
  assert.ok(html.includes(`<link rel="modulepreload" href="/v/${APP_VERSION}/shared/js/api.js">`), "تحميل مسبق متوازٍ للوحدات");
  assert.ok(!/(src|href)="\/(shared|staff-page)\//.test(html), "لا رابط بدون إصدار");

  const current = await raw(`/v/${APP_VERSION}/shared/js/api.js`);
  assert.equal(current.status, 200);
  assert.match(current.headers.get("cache-control"), /max-age=31536000.*immutable/, "ملفات الإصدار الحالي كاش دائم");
  const old = await raw("/v/0.0.1-oldbuild00/shared/js/api.js");
  assert.equal(old.status, 200);
  assert.match(old.headers.get("cache-control"), /max-age=0/, "رابط إصدار قديم: الملف الحالي بلا كاش");
  const plain = await raw("/shared/js/api.js");
  assert.match(plain.headers.get("cache-control"), /max-age=0/);
  assert.ok(plain.headers.get("etag"), "إعادة تحقق سريعة (304)");
  // طلب HTTP خام (fetch في Node يحوّل الطلب المشروط إلى no-cache حسب المواصفة، بخلاف المتصفح)
  const status304 = await new Promise((resolve, reject) => {
    http.get(`${srv.base}/shared/js/api.js`, { headers: { "If-None-Match": plain.headers.get("etag") } }, (r) => { r.resume(); resolve(r.statusCode); }).on("error", reject);
  });
  assert.equal(status304, 304, "الملف لم يتغير: لا يُعاد تنزيله");

  const sw = await raw("/sw.js");
  assert.equal(sw.headers.get("cache-control"), "no-cache");
  const swText = await sw.text();
  assert.ok(swText.includes(`const VERSION = "${APP_VERSION}";`), "عامل الخدمة يتغير مع كل إصدار");
  assert.ok(!swText.includes("__APP_VERSION__"));
});

test("ملف الطالب لولي الأمر لا يستلم الحقول الداخلية الجديدة للفواتير", async () => {
  const inv = (await admin.get("/api/admin/finance/invoices?limit=1&totals=0")).data.invoices[0];
  const full = (await admin.get("/api/admin/students")).data.find((x) => x.id === inv.student_id);
  const prof = await client(srv.base).post(`/api/public/${s.id}/student`, { student_id: full.id, key: full.access_key });
  assert.equal(prof.status, 200, JSON.stringify(prof.data));
  const list = prof.data.fees?.invoices;
  assert.ok(list?.length >= 1, "الفواتير ظاهرة لولي الأمر");
  for (const k of ["guardian_phone", "access_key", "_total", "student_name"]) assert.ok(!(k in list[0]), k);
});

test("التحليلات: term_id=current يُحسم في الخادم (طلب واحد مع بيانات السنة بالتوازي)", async () => {
  const academic = await admin.get("/api/admin/academic");
  const current = academic.data.current?.term_id;
  const viaCurrent = await admin.get("/api/admin/analytics?months=6&term_id=current");
  assert.equal(viaCurrent.status, 200, JSON.stringify(viaCurrent.data));
  const explicit = await admin.get(`/api/admin/analytics?months=6${current ? `&term_id=${current}` : ""}`);
  assert.deepEqual(viaCurrent.data, explicit.data, "نفس نتيجة تحديد الفصل الحالي صراحة");
  assert.equal((await admin.get("/api/admin/analytics?months=6&term_id=abc")).status, 400);
});
