/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid, randomPhone, setupAdmin } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, pub, landing;
const T = "/api/owner/org-types";
const platform = (fn) => transaction({ platform: true }, fn);
const typeOf = async (id) => (await platform((q) => q("SELECT org_type, org_type_key FROM tenants WHERE id = $1", [id])))[0];
const lead = (org_type, extra = {}) => pub.post("/api/public/leads", { kind: "trial", school_name: "مؤسسة تجريبية", contact_name: "سالم أحمد",
  phone: randomPhone(), details: { org_type }, ...extra });

before(async () => {
  srv = await startServer();
  owner = client(srv.base); pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  await platform((q) => q("DELETE FROM leads WHERE (ip << inet '127.0.0.0/8' OR host(ip) IN ('::1', '::ffff:127.0.0.1')) AND created_at > now() - interval '1 day'"));
  [{ landing_mode: landing }] = await platform((q) => q("SELECT landing_mode FROM platform_settings WHERE id"));
  await owner.put("/api/owner/settings", { landing_mode: "marketing" });
});
after(async () => {
  await owner.put("/api/owner/settings", { landing_mode: landing });
  await srv.close(); await endPool();
});

test("كل مؤسسة قائمة لها نوع يطابق محركها، ولا يُقبل نوع من محرك آخر", async () => {
  const [{ n }] = await platform((q) => q(`SELECT count(*)::int AS n FROM tenants t JOIN org_types o ON o.key = t.org_type_key WHERE o.engine <> t.org_type`));
  assert.equal(n, 0);
  const [{ missing }] = await platform((q) => q("SELECT count(*)::int AS missing FROM tenants WHERE org_type_key IS NULL"));
  assert.equal(missing, 0);
  const id = `ot-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id, name: "مدرسة النوع" })).status, 201);
  assert.deepEqual(await typeOf(id), { org_type: "school", org_type_key: "private_school" }, "بلا نوع: النوع الأساسي للمحرك");
  await assert.rejects(platform((q) => q("UPDATE tenants SET org_type_key = 'training_institute' WHERE id = $1", [id])), /لا يناسب/);
});

test("الإنشاء من النوع: المحرك يُشتق من النوع، والجامعة والأنواع الموقوفة لا تُنشأ", async () => {
  const pubId = `ot-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id: pubId, name: "مدرسة حكومية تجريبية", org_type_key: "public_school" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(await typeOf(pubId), { org_type: "school", org_type_key: "public_school" });

  const centerId = `ot-${uid()}`;
  const c = await owner.post("/api/owner/tenants", { id: centerId, name: "مركز تعليمي تجريبي", org_type_key: "learning_center" });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.deepEqual(await typeOf(centerId), { org_type: "institute", org_type_key: "learning_center" });
  const admin = await setupAdmin(client(srv.base), c.data.setup.url);
  const me = (await admin.get("/api/admin/me")).data;
  assert.equal(me.org_type, "institute", "المركز يعمل بالمحرك التدريبي القائم");
  assert.equal(me.org_type_key, "learning_center");

  // The old way (org_type alone) still works and lands on the engine's base type.
  const oldId = `ot-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id: oldId, name: "معهد بالطريقة القديمة", org_type: "institute" })).status, 201);
  assert.deepEqual(await typeOf(oldId), { org_type: "institute", org_type_key: "training_institute" });

  const uni = await owner.post("/api/owner/tenants", { id: `ot-${uid()}`, name: "جامعة", org_type_key: "university" });
  assert.equal(uni.status, 400);
  assert.match(uni.data.error, /قيد التطوير/);
  assert.equal((await owner.post("/api/owner/tenants", { id: `ot-${uid()}`, name: "نوع غير موجود", org_type_key: "no_such_type" })).status, 400);
});

test("نموذج الطلب: الأنواع المتاحة فقط، والقيم القديمة تُقرأ صحيحة، والاعتماد يأخذ النوع المطلوب", async () => {
  const site = (await pub.get("/api/site")).data;
  const keys = site.org_types.map((t) => t.key);
  assert.ok(keys.includes("private_school") && keys.includes("training_institute"));
  assert.ok(!keys.includes("university") && !keys.includes("quran_school"), "الأنواع قيد التطوير لا تظهر للعامة");

  const uni = await lead("university");
  assert.equal(uni.status, 400);
  const legacy = await lead("institute");
  assert.equal(legacy.status, 201, JSON.stringify(legacy.data));
  const [row] = await platform((q) => q("SELECT details->>'org_type' AS t FROM leads WHERE id = $1", [legacy.data.id]));
  assert.equal(row.t, "training_institute");

  const asked = await lead("public_school");
  assert.equal(asked.status, 201);
  const plans = (await owner.get("/api/owner/plans")).data;
  const made = await owner.post(`/api/owner/requests/${asked.data.id}/convert`, { name: "مدرسة حكومية من طلب", subscription: { kind: "trial", plan_id: plans[0].id, force_trial: true } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual(await typeOf(made.data.tenant_id), { org_type: "school", org_type_key: "public_school" });
});

test("المالك يضيف نوعًا تجريبيًا بلا كود، ويوقفه، ولا يتأثر من عليه", async () => {
  const key = `exp_${uid()}`;
  const bad = await owner.post(T, { key: `uni_${uid()}`, name: "كلية تجريبية", engine: "university", status: "available" });
  assert.equal(bad.status, 400, "نوع على محرك قيد التطوير لا يُتاح");
  const made = await owner.post(T, { key, name: "أكاديمية تجريبية", engine: "school", status: "beta",
    terms: { student: "منتسب", students: "المنتسبون", teacher: "" }, default_features: ["attendance", "exams"] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual(made.data.terms, { student: "منتسب", students: "المنتسبون" }, "المصطلح الفارغ يبقى كلمة المنصة");
  assert.equal((await owner.post(T, { key, name: "مكرر", engine: "school" })).status, 409);
  assert.equal((await owner.post(T, { key: `x_${uid()}`, name: "أقسام خاطئة", engine: "school", default_features: ["nope"] })).status, 400);

  assert.ok((await pub.get("/api/site")).data.org_types.some((t) => t.key === key), "التجريبي يظهر في نموذج الطلب");
  assert.equal((await lead(key)).status, 201);
  const id = `ot-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id, name: "أكاديمية", org_type_key: key })).status, 201);

  const upd = await owner.patch(`${T}/${key}`, { status: "disabled", name: "أكاديمية (موقوفة)" });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  assert.equal(upd.data.version, 2);
  assert.equal(upd.data.terms.student, "منتسب", "التعديل الجزئي لا يمسح المصطلحات");
  assert.equal((await lead(key)).status, 400, "الموقوف لا يُطلب");
  assert.equal((await owner.post("/api/owner/tenants", { id: `ot-${uid()}`, name: "بعد الإيقاف", org_type_key: key })).status, 400);
  assert.deepEqual(await typeOf(id), { org_type: "school", org_type_key: key }, "المؤسسة القائمة تبقى على نوعها");

  const list = (await owner.get(T)).data;
  const mine = list.types.find((t) => t.key === key);
  assert.equal(mine.tenants, 1);
  assert.ok(list.engines.find((e) => e.key === "university" && !e.live));
});

test("تغيير نوع مؤسسة: مراجعة الأثر أولًا، ولا يُحذف شيء، والانتقال بين مدرسة ومعهد بتأكيد ويُعاد", async () => {
  const id = `ot-${uid()}`;
  const made = await owner.post("/api/owner/tenants", { id, name: "مدرسة تتغير", org_type_key: "private_school" });
  assert.equal(made.status, 201);
  const admin = await setupAdmin(client(srv.base), made.data.setup.url);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false"));
  const cls = (await admin.get("/api/admin/classes")).data;
  const counts = () => transaction({ tenantId: id }, async (q) => (await q(
    "SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM classes) AS classes, (SELECT count(*)::int FROM subjects) AS subjects"))[0]);
  const before = await counts();

  // Same engine: words only.
  const ok = await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "public_school", reason: "سُجلت بالخطأ" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.changed, true);
  assert.equal((await typeOf(id)).org_type_key, "public_school");

  // Between engines: the impact lists what hides, the change needs the code typed, and nothing is lost.
  const pv = (await owner.get(`/api/owner/tenants/${id}/org-type/preview?to=training_institute&apply_sections=1`)).data;
  assert.equal(pv.engine_change, true);
  assert.equal(pv.deleted, 0);
  if (cls.length) assert.ok(pv.hidden.some((x) => x.label === "الشعب" && x.count === cls.length), JSON.stringify(pv.hidden));
  assert.ok(pv.terms.some((x) => x.from === "طالب" && x.to === "متدرب"));
  assert.equal((await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "training_institute" })).status, 400, "بلا تأكيد يُرفض");
  const moved = await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "training_institute", confirm: id, reason: "تحولت إلى معهد" });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.deepEqual(await typeOf(id), { org_type: "institute", org_type_key: "training_institute" });
  const me = (await admin.get("/api/admin/me")).data;
  assert.equal(me.org_type, "institute");
  assert.equal(me.terms.student, "متدرب");
  assert.equal((await admin.get("/api/admin/institute/meta")).status, 200, "إعدادات المعهد جاهزة");
  assert.deepEqual(await counts(), before, "لم يُحذف شيء");

  const back = await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "private_school", confirm: id });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal((await admin.get("/api/admin/me")).data.org_type, "school");
  assert.deepEqual(await counts(), before);
  assert.equal((await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "university", confirm: id })).status, 400);

  const file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.school.org_type_name, "مدرسة أهلية");
  assert.ok(file.events.some((e) => /مدرسة أهلية.*مدرسة حكومية.*سُجلت بالخطأ/.test(e.body)));
  const hist = (await owner.get(`/api/owner/tenants/${id}/org-type/history`)).data;
  assert.deepEqual(hist.map((x) => x.to_key), ["private_school", "training_institute", "public_school"]);
  const listed = (await owner.get("/api/owner/files?org_type=private_school")).data.items;
  assert.ok(listed.some((x) => x.id === id) && listed.every((x) => x.org_type_key === "private_school"));
});

test("المؤسسة الجديدة تبدأ بأقسام نوعها ومصطلحاته، والمدرسة تعدّل مصطلحاتها، والأقسام تُحفظ في الجدولين", async () => {
  const mk = async (key) => {
    const id = `ot-${uid()}`;
    const r = await owner.post("/api/owner/tenants", { id, name: `مؤسسة ${key}`, org_type_key: key });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const admin = await setupAdmin(client(srv.base), r.data.setup.url);
    await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false"));
    return { id, admin, me: (await admin.get("/api/admin/me")).data };
  };
  const priv = await mk("private_school");
  const pub2 = await mk("public_school");
  const kg = await mk("kindergarten");
  const mods = async (a) => (await a.get("/api/admin/settings/modules")).data;
  const p = await mods(priv.admin);
  assert.equal(p.fees, true); assert.equal(p.donations, false, "المدرسة الأهلية الجديدة كما كانت قبل الأنواع");
  const g = await mods(pub2.admin);
  assert.equal(g.fees, false); assert.equal(g.finance, false); assert.equal(g.installments, false, "ما يعتمد على الرسوم يُوقف معها");
  assert.equal(g.attendance, true);
  const k = await mods(kg.admin);
  assert.equal(k.timetable, false); assert.equal(k.substitutes, false);
  assert.equal(kg.me.terms.student, "طفل");
  assert.equal(priv.me.terms.student, "طالب");
  const [{ school_type }] = await transaction({ tenantId: pub2.id }, (q) => q("SELECT school_type FROM school_profile"));
  assert.equal(school_type, "public");

  // The school's own words over its type's; an empty word goes back to the type's.
  const put = await kg.admin.put("/api/admin/settings/terms", { terms: { student: "طالب الروضة", teachers: "" } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal((await kg.admin.get("/api/admin/me")).data.terms.student, "طالب الروضة");
  assert.equal((await kg.admin.get("/api/admin/me")).data.terms.teachers, "المعلمات");
  await kg.admin.put("/api/admin/settings/terms", { terms: {} });
  assert.equal((await kg.admin.get("/api/admin/me")).data.terms.student, "طفل");

  // A switch is saved in the new table and mirrored in the old one.
  assert.equal((await priv.admin.put("/api/admin/settings/modules", { library: false })).status, 200);
  const [both] = await transaction({ tenantId: priv.id }, (q) => q(
    "SELECT (SELECT enabled FROM tenant_modules WHERE key = 'library') AS new, (SELECT library FROM school_modules) AS old"));
  assert.deepEqual(both, { new: false, old: false });
  assert.equal((await priv.admin.get("/api/admin/me")).data.modules.library, false);
});

test("المدرسة لا تعدّل الأنواع", async () => {
  const anon = client(srv.base);
  assert.notEqual((await anon.get(T)).status, 200);
  await assert.rejects(transaction({ tenantId: "x" }, (q) => q("UPDATE org_types SET name = 'تلاعب' WHERE key = 'private_school' RETURNING key"))
    .then((rows) => { if (!rows.length) throw new Error("لا صلاحية"); }));
});
