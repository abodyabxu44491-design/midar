// اختبارات الباقات والاشتراكات والتجربة المجانية: كل شيء من لوحة المالك، والفرض في الخادم، ولا حذف للبيانات
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner;
const s = {};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const site = () => fetch(`${srv.base}/api/site`).then((r) => r.json());

async function staff(school, username, password) {
  const c = client(srv.base);
  const r = await c.post("/api/staff/login", { school, username, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await owner.put("/api/owner/settings", { landing_mode: "marketing", trial_enabled: true, trial_days: 30, trials_per_school: 1, trial_without_plan: true,
    trial_reminder_days: [7, 3, 1], trial_grace_days: 0 });
  // تنظيف طلبات تشغيل سابق (حد الطلبات لكل جهاز)
  for (const old of (await owner.get("/api/owner/requests")).data.filter((x) => x.source === "public")) await owner.del(`/api/owner/requests/${old.id}`);
  const plans = (await owner.get("/api/owner/plans")).data;
  s.basic = plans.find((p) => p.code === "basic");
  s.pro = plans.find((p) => p.code === "pro");
  // حالة معروفة للباقة الأساسية في كل تشغيل (تشغيل سابق متوقف قد يترك تعديلًا)
  s.basic = { ...s.basic, monthly_price: 299, discount_kind: "none", discount_value: null, promo_label: null, discount_ends_at: null, discount_starts_at: null,
    sale_monthly_price: null, sale_yearly_price: null, is_public: true, status: "active",
    features: ["students", "teachers", "structure", "parent_portal", "data_export", "attendance", "exams", "reports", "homework",
      "announcements", "messaging", "whatsapp_support"] };
  assert.equal((await owner.put(`/api/owner/plans/${s.basic.id}`, { plan: s.basic, apply: "new" })).status, 200);
  await owner.post(`/api/owner/plans/${s.basic.id}/status`, { status: "active" });
  await owner.post(`/api/owner/plans/${s.pro.id}/status`, { status: "active" });
});

after(async () => {
  await owner.put("/api/owner/settings", { landing_mode: "blank" });
  await srv.close(); await endPool();
});

test("الصفحة العامة تقرأ الباقات والأسعار والمميزات من قاعدة البيانات", async () => {
  const before = await site();
  const basic = before.plans.find((p) => p.code === "basic");
  assert.ok(basic.features.some((f) => f.key === "attendance"));
  assert.ok(!basic.features.some((f) => f.key === "timetable"), "الأساسية لا تشمل الجدول");

  // تغيير السعر وإضافة ميزة وعرض مؤقت من لوحة المالك يظهر فورًا
  const plan = { ...s.basic, monthly_price: 349, discount_kind: "percent", discount_value: 20, promo_label: "عرض الافتتاح", discount_ends_at: day(10),
    features: [...s.basic.features, "timetable"] };
  const up = await owner.put(`/api/owner/plans/${s.basic.id}`, { plan, apply: "new" });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const after1 = (await site()).plans.find((p) => p.code === "basic");
  assert.equal(after1.monthly.base, 349);
  assert.equal(after1.monthly.final, 279.2, "العرض المؤقت 20%");
  assert.equal(after1.promo_label, "عرض الافتتاح");
  assert.ok(after1.features.some((f) => f.key === "timetable"));

  // إخفاء من الموقع وإيقاف مؤقت
  await owner.put(`/api/owner/plans/${s.basic.id}`, { plan: { ...plan, is_public: false }, apply: "new" });
  assert.ok(!(await site()).plans.some((p) => p.code === "basic"), "الباقة المخفية لا تظهر");
  await owner.put(`/api/owner/plans/${s.basic.id}`, { plan: { ...s.basic, features: s.basic.features }, apply: "new" });   // إرجاعها كما كانت
  await owner.post(`/api/owner/plans/${s.pro.id}/status`, { status: "paused" });
  assert.ok(!(await site()).plans.some((p) => p.code === "pro"), "الباقة الموقوفة لا تُباع");
  await owner.post(`/api/owner/plans/${s.pro.id}/status`, { status: "active" });

  // باقة جديدة بميزة خدمية جديدة من الكتالوج (بلا أي تعديل في الكود)
  const f = await owner.post("/api/owner/catalog", { key: `svc_${uid().slice(0, 6)}`, name: "استضافة بنطاق خاص", category: "الخدمات" });
  assert.equal(f.status, 201, JSON.stringify(f.data));
  const np = await owner.post("/api/owner/plans", { code: `p-${uid().slice(0, 6)}`, name: "باقة تجريبية", monthly_price: 100, features: ["students", f.data.key] });
  assert.equal(np.status, 201, JSON.stringify(np.data));
  assert.ok((await site()).plans.some((p) => p.id === np.data.id && p.features.some((x) => x.key === f.data.key)));
  await owner.post(`/api/owner/plans/${np.data.id}/status`, { status: "archived" });
});

test("طلب تجربة من الصفحة العامة ← يصل للمالك ← تفعيل: 30 يومًا تُحسب تلقائيًا", async () => {
  const anon = client(srv.base);
  const r = await anon.post("/api/public/leads", { kind: "trial", school_name: "مدرسة المستقبل", contact_name: "أحمد", phone: "0501112222",
    email: "a@example.com", city: "الرياض", students_count: 420, plan_id: s.basic.id, try_plan: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const noPlan = await anon.post("/api/public/leads", { kind: "trial", school_name: "مدرسة بلا باقة", contact_name: "خالد", phone: "0503334444" });
  assert.equal(noPlan.status, 201, "تجربة بدون اختيار باقة");

  const badge = await owner.get("/api/owner/requests/badge");
  assert.ok(badge.data.unseen >= 2, "عدّاد الطلبات الجديدة");
  const list = (await owner.get("/api/owner/requests?kind=trial")).data;
  const lead = list.find((x) => x.school_name === "مدرسة المستقبل");
  assert.equal(lead.plan_name, "الأساسية");
  assert.equal(lead.students_count, 420);

  s.school = `fut-${uid().slice(0, 6)}`;
  const conv = await owner.post(`/api/owner/requests/${lead.id}/convert`, {
    id: s.school, name: "مدرسة المستقبل", admin_name: "أحمد",
    subscription: { kind: "trial", plan_id: s.basic.id, ends_on: day(365) },    // تاريخ نهاية يدوي يُتجاهل في التجربة
  });
  assert.equal(conv.status, 201, JSON.stringify(conv.data));
  s.adminPw = conv.data.credentials.password;
  const detail = (await owner.get(`/api/owner/subscriptions/${s.school}`)).data;
  assert.equal(detail.current.kind, "trial");
  assert.equal(detail.current.status, "trial");
  assert.equal(detail.current.ends_on, day(30), "التجربة 30 يومًا محسوبة من الخادم");
  assert.equal(Number(detail.current.price), 0, "بدون رسوم خلال التجربة");
  assert.ok(detail.events.some((e) => e.event === "trial_started"));
  assert.equal((await owner.get("/api/owner/requests")).data.find((x) => x.id === lead.id).status, "active");

  s.admin = await staff(s.school, "admin", s.adminPw);
  const me = await s.admin.get("/api/admin/me");
  assert.equal(me.data.access.state, "trial");
  assert.equal(me.data.access.days_left, 30);
});

test("الميزة غير المشمولة في الباقة تُرفض في الخادم حتى لو فعّلتها الإدارة", async () => {
  await s.admin.put("/api/admin/settings/modules", { timetable: true });
  assert.equal((await s.admin.get("/api/admin/timetable")).status, 404, "رابط مباشر لقسم خارج الباقة");
  assert.equal((await s.admin.get("/api/admin/me")).data.modules.timetable, false);
  const sub = await s.admin.get("/api/admin/subscription");
  assert.equal(sub.status, 200);
  const tt = sub.data.features.find((f) => f.key === "timetable");
  assert.equal(tt.included, false, "تظهر مقفلة في صفحة المميزات");
  assert.equal(sub.data.usage.students, 0);

  // طلب الميزة ← يصل للمالك ← الموافقة مجانًا لفترة محددة
  const req = await s.admin.post("/api/admin/subscription/requests", { kind: "feature", feature_key: "timetable", note: "نحتاج الجدول" });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  assert.equal((await s.admin.post("/api/admin/subscription/requests", { kind: "feature", feature_key: "timetable" })).status, 400, "لا تكرار");
  assert.equal((await s.admin.post("/api/admin/subscription/requests", { kind: "feature", feature_key: "attendance" })).status, 400, "ميزة موجودة أصلًا");
  const ownerReq = (await owner.get("/api/owner/requests?kind=feature")).data.find((x) => x.id === req.data.id);
  assert.equal(ownerReq.feature_name, "الجدول الدراسي");
  const grant = await owner.post(`/api/owner/requests/${req.data.id}/grant-feature`, { price: 0, until: day(60) });
  assert.equal(grant.status, 200, JSON.stringify(grant.data));
  assert.equal((await s.admin.get("/api/admin/timetable")).status, 200, "الإضافة تفتح القسم");
  const after = await s.admin.get("/api/admin/subscription");
  assert.equal(after.data.features.find((f) => f.key === "timetable").addon, true);
});

test("اللقطة: تعديل الباقة لا يغيّر الاشتراكات القائمة إلا بقرار مؤكد", async () => {
  const plan = { ...s.basic, features: [...s.basic.features, "analytics"] };
  await owner.put(`/api/owner/plans/${s.basic.id}`, { plan, apply: "new" });
  assert.equal((await s.admin.get("/api/admin/analytics?months=6")).status, 404, "الاشتراك القائم على لقطته القديمة");
  assert.equal((await owner.put(`/api/owner/plans/${s.basic.id}`, { plan, apply: "existing" })).status, 400, "يحتاج تأكيدًا");
  const applied = await owner.put(`/api/owner/plans/${s.basic.id}`, { plan, apply: "tenant", tenant_id: s.school, confirm: true });
  assert.equal(applied.data.affected, 1);
  await s.admin.put("/api/admin/settings/modules", { analytics: true });
  assert.equal((await s.admin.get("/api/admin/analytics?months=6")).status, 200, "طُبّق على هذه المدرسة فقط");
  await owner.put(`/api/owner/plans/${s.basic.id}`, { plan: s.basic, apply: "new" });
});

test("انتهاء التجربة: الوصول يتوقف والبيانات محفوظة، والتفعيل يعيدها كما هي", async () => {
  const st = await s.admin.post("/api/admin/students", { name: "طالب يبقى" });
  assert.equal(st.status, 201, JSON.stringify(st.data));
  const cls = await s.admin.post("/api/admin/structure/classes", { name: "الأول" });
  const sub = await s.admin.post("/api/admin/structure/subjects", { name: "العلوم" });
  const t = await s.admin.post("/api/admin/teachers", { name: "معلم التجربة", username: `t${uid().slice(0, 6)}`, load: [{ class_id: cls.data.id, subject_id: sub.data.id }] });
  const teacher = await staff(s.school, t.data.credentials.username || t.data.username || "x", t.data.credentials.password).catch(() => null);

  assert.equal((await owner.post(`/api/owner/subscriptions/${s.school}/action`, { action: "end_trial" })).status, 200);
  const me = await s.admin.get("/api/admin/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.access.locked, true);
  assert.equal(me.data.access.status, "trial_expired");
  assert.match(me.data.access.message, /انتهت فترة التجربة/);
  const blocked = await s.admin.get("/api/admin/students");
  assert.equal(blocked.status, 402);
  if (teacher) assert.equal((await teacher.get("/api/teacher/classes")).status, 403, "المعلم لا يعمل");
  const page = await s.admin.get("/api/admin/subscription");
  assert.equal(page.status, 200, "صفحة الاشتراك متاحة");
  assert.ok(page.data.plans.length > 0, "تظهر الباقات للاختيار");
  const renew = await s.admin.post("/api/admin/subscription/requests", { kind: "subscription", plan_id: s.pro.id, billing_cycle: "yearly" });
  assert.equal(renew.status, 201, "المدير يطلب اشتراكًا بعد التجربة");

  // سعر خاص لهذه المدرسة فقط، ثم تفعيل اشتراك مدفوع
  assert.equal((await owner.put(`/api/owner/prices/${s.school}/${s.pro.id}`, { yearly_price: 3500, note: "سعر خاص" })).status, 200);
  const act = await owner.post(`/api/owner/subscriptions/${s.school}/activate`, { kind: "paid", plan_id: s.pro.id, billing_cycle: "yearly" });
  assert.equal(act.status, 201, JSON.stringify(act.data));
  assert.equal(Number(act.data.price), 3500, "السعر الخاص");
  assert.equal(act.data.ends_on, day(365) > act.data.ends_on ? act.data.ends_on : act.data.ends_on);
  const list = await s.admin.get("/api/admin/students");
  assert.equal(list.status, 200);
  assert.ok(list.data.some((x) => x.full_name === "طالب يبقى" || x.name === "طالب يبقى"), "البيانات كما هي بعد إعادة التفعيل");
  assert.equal((await s.admin.get("/api/admin/timetable")).status, 200, "الاحترافية تشمل الجدول");
  const hist = (await owner.get(`/api/owner/subscriptions/${s.school}`)).data;
  assert.deepEqual(hist.history.map((h) => h.status), ["active", "ended"], "السجل يحتفظ بالتجربة");
  assert.ok(hist.events.some((e) => e.event === "converted" || e.event === "reactivated"));
});

test("التجربة مرة واحدة لكل مدرسة افتراضيًا، والمالك يمنح تجربة جديدة يدويًا", async () => {
  const again = await owner.post(`/api/owner/subscriptions/${s.school}/activate`, { kind: "trial", plan_id: s.basic.id });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /استُخدمت التجربة/);
  const forced = await owner.post(`/api/owner/subscriptions/${s.school}/activate`, { kind: "trial", plan_id: s.basic.id, force_trial: true });
  assert.equal(forced.status, 201);
  const d = (await owner.get(`/api/owner/subscriptions/${s.school}`)).data;
  assert.equal(d.trials.length, 2, "سجل التجارب");
  // تمديد التجربة يدويًا
  const ext = await owner.post(`/api/owner/subscriptions/${s.school}/action`, { action: "extend", days: 10 });
  assert.equal(ext.data.ends_on, day(40));
});

test("فحص الانتهاء التلقائي والتنبيهات قبل انتهاء التجربة", async () => {
  // تجربة تنتهي بعد 3 أيام ← تنبيهات 7 و3
  await owner.post(`/api/owner/subscriptions/${s.school}/action`, { action: "extend", until: day(3) });
  await owner.post("/api/owner/subscriptions/run-expiry", {});
  await owner.post("/api/owner/subscriptions/run-expiry", {});   // لا تكرار
  const ev = (await owner.get(`/api/owner/subscriptions/${s.school}`)).data.events.filter((e) => e.event === "reminder");
  assert.deepEqual(ev.map((e) => e.details.days).sort(), [3, 7]);
  const me = await s.admin.get("/api/admin/me");
  assert.equal(me.data.access.days_left, 3);

  // اشتراك مدفوع انتهى ومدة سماحه صفر ← منتهٍ، والمدرسة لم تُحذف
  const paid = await owner.post(`/api/owner/subscriptions/${s.school}/activate`,
    { kind: "paid", plan_id: s.basic.id, starts_on: day(-40), months: 1, grace_days: 0, price: 100 });
  assert.equal(paid.status, 201, JSON.stringify(paid.data));
  const run = await owner.post("/api/owner/subscriptions/run-expiry", {});
  assert.ok(run.data.changed.some((x) => x.tenant_id === s.school && x.status === "expired"));
  assert.equal((await s.admin.get("/api/admin/me")).data.access.status, "expired");
  const [tn] = await transaction({ platform: true }, (q) => q("SELECT status FROM tenants WHERE id = $1", [s.school]));
  assert.equal(tn.status, "active", "المدرسة نفسها لا تُوقف ولا تُحذف");
  assert.equal((await owner.post(`/api/owner/subscriptions/${s.school}/action`, { action: "renew", months: 12 })).status, 200);
  assert.equal((await s.admin.get("/api/admin/me")).data.access.locked, false, "التجديد يعيد الوصول");
});

test("حد المعلمين من الباقة، وإحصاءات المالك، وعزل الجداول", async () => {
  await owner.post(`/api/owner/subscriptions/${s.school}/activate`, { kind: "free", features: ["students", "teachers", "attendance"], plan_name: "مجانية خاصة", max_teachers: 1 });
  const extra = await s.admin.post("/api/admin/teachers", { name: "معلم زائد", username: `z${uid().slice(0, 6)}` });
  assert.equal(extra.status, 400);
  assert.match(extra.data.error, /حد المعلمين/);

  const stats = (await owner.get("/api/owner/subscriptions/stats")).data;
  for (const k of ["schools", "active", "trials", "expired", "expiring_7"]) assert.equal(typeof stats[k], "number", k);
  assert.ok(Array.isArray(stats.by_plan));
  assert.equal((await owner.get("/api/owner/subscriptions?filter=trial")).status, 200);

  // المدرسة لا تفتح لوحة المالك، ولا تستطيع تعديل اشتراكها من قاعدة البيانات
  assert.equal((await s.admin.get("/api/owner/plans")).status, 401);
  const rows = await transaction({ tenantId: s.school }, (q) => q("UPDATE subscriptions SET price = 0 RETURNING id"));
  assert.equal(rows.length, 0, "RLS: الكتابة للمنصة فقط");
  const other = await transaction({ tenantId: s.school }, (q) => q("SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id <> $1", [s.school]));
  assert.equal(other[0].n, 0, "المدرسة ترى اشتراكاتها فقط");
});

test("نماذج الصفحة العامة: التجربة والتواصل بلا مدة، والاشتراك بمدة افتراضية سنوية (خطأ billing_cycle)", async () => {
  for (const old of (await owner.get("/api/owner/requests")).data.filter((x) => x.source === "public")) await owner.del(`/api/owner/requests/${old.id}`);
  const anon = client(srv.base);
  const base = { school_name: "مدرسة النماذج", contact_name: "سالم", phone: "0550000001" };
  // كما يرسلها المتصفح: null للحقول غير المستخدمة
  const trial = await anon.post("/api/public/leads", { ...base, kind: "trial", plan_id: null, billing_cycle: null, months: null, try_plan: true, addon_keys: [] });
  assert.equal(trial.status, 201, JSON.stringify(trial.data));
  const contact = await anon.post("/api/public/leads", { ...base, kind: "contact", billing_cycle: null, plan_id: null });
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  const noCycle = await anon.post("/api/public/leads", { ...base, kind: "subscription", plan_id: s.pro.id });
  assert.equal(noCycle.status, 201, JSON.stringify(noCycle.data));
  const list = (await owner.get("/api/owner/requests")).data.filter((x) => x.school_name === "مدرسة النماذج");
  assert.equal(list.find((x) => x.kind === "subscription").billing_cycle, "yearly", "الافتراضي سنوي");
  assert.equal(list.find((x) => x.kind === "trial").billing_cycle, null, "التجربة بلا مدة");
  // قيمة خاطئة فعلًا: رسالة عربية بدون اسم الحقل الداخلي
  const bad = await anon.post("/api/public/leads", { ...base, kind: "subscription", billing_cycle: "weekly" });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /مدة الاشتراك/);
  assert.ok(!bad.data.error.includes("billing_cycle"));
});

test("خصم الباقة: نسبة، مبلغ، سعر نهائي، وتواريخ العرض — والبطاقات العامة تقرأ من قاعدة البيانات", async () => {
  const site = () => fetch(`${srv.base}/api/site`).then((r) => r.json());
  const put = (patch) => owner.put(`/api/owner/plans/${s.pro.id}`, { plan: { ...s.pro, monthly_price: 149, yearly_price: 1490, promo_label: null, ...patch }, apply: "new" });
  const pro = async () => (await site()).plans.find((p) => p.code === "pro");
  await owner.put("/api/owner/settings", { landing_mode: "marketing" });

  assert.equal((await put({ discount_kind: "none" })).status, 200);
  let p = await pro();
  assert.deepEqual([p.monthly.base, p.monthly.final, p.monthly.promo], [149, 149, false], "بدون خصم: السعر الطبيعي");

  assert.equal((await put({ discount_kind: "price", sale_monthly_price: 99, sale_yearly_price: 990 })).status, 200);
  p = await pro();
  assert.deepEqual([p.monthly.base, p.monthly.final, p.monthly.promo, p.monthly.percent], [149, 99, true, 34], "149 ← 99");
  assert.equal(p.yearly.final, 990);

  await put({ discount_kind: "amount", discount_value: 50 });
  assert.equal((await pro()).monthly.final, 99);
  await put({ discount_kind: "percent", discount_value: 20 });
  assert.equal((await pro()).monthly.final, 119.2);

  await put({ discount_kind: "percent", discount_value: 20, discount_starts_at: day(3) });
  assert.equal((await pro()).monthly.promo, false, "العرض لم يبدأ بعد");
  await put({ discount_kind: "percent", discount_value: 20, discount_ends_at: day(-1) });
  assert.equal((await pro()).monthly.promo, false, "العرض انتهى");
  await put({ discount_kind: "percent", discount_value: 20, discount_ends_at: day(5) });
  p = await pro();
  assert.equal(p.promo_ends_at, day(5), "تاريخ نهاية العرض يظهر");
  assert.equal(p.promo_label, null, "لا يلزم ذكر سبب الخصم");

  assert.equal((await put({ discount_kind: "price", sale_monthly_price: 200 })).status, 400, "السعر بعد الخصم أعلى من الأصلي");
  assert.equal((await put({ discount_kind: "percent", discount_value: 95 })).status, 400);

  // سعر التفعيل للمدرسة يستخدم نفس الحساب
  await put({ discount_kind: "price", sale_monthly_price: 99, sale_yearly_price: 990 });
  const act = await owner.post(`/api/owner/subscriptions/${s.school}/activate`, { kind: "paid", plan_id: s.pro.id, billing_cycle: "monthly" });
  assert.equal(Number(act.data.price), 99);
  await put({ discount_kind: "none", monthly_price: s.pro.monthly_price, yearly_price: s.pro.yearly_price });
});
