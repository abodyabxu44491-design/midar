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

test("تغيير نوع مؤسسة: داخل نفس المحرك فقط، ويُسجَّل في ملفها، ولا يمس بياناتها", async () => {
  const id = `ot-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id, name: "مدرسة تتغير", org_type_key: "private_school" })).status, 201);
  const [{ n: before }] = await transaction({ tenantId: id }, (q) => q("SELECT count(*)::int AS n FROM users"));
  const ok = await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "public_school", reason: "سُجلت بالخطأ" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.changed, true);
  assert.equal((await typeOf(id)).org_type_key, "public_school");
  const cross = await owner.patch(`/api/owner/tenants/${id}/org-type`, { org_type_key: "training_institute" });
  assert.equal(cross.status, 400);
  assert.equal((await typeOf(id)).org_type, "school");
  const [{ n: after }] = await transaction({ tenantId: id }, (q) => q("SELECT count(*)::int AS n FROM users"));
  assert.equal(after, before);
  const file = (await owner.get(`/api/owner/files/${id}`)).data;
  assert.equal(file.school.org_type_name, "مدرسة حكومية");
  assert.ok(file.events.some((e) => /مدرسة أهلية.*مدرسة حكومية.*سُجلت بالخطأ/.test(e.body)));
  const listed = (await owner.get("/api/owner/files?org_type=public_school")).data.items;
  assert.ok(listed.some((x) => x.id === id) && listed.every((x) => x.org_type_key === "public_school"));
});

test("المدرسة لا تعدّل الأنواع", async () => {
  const anon = client(srv.base);
  assert.notEqual((await anon.get(T)).status, 200);
  await assert.rejects(transaction({ tenantId: "x" }, (q) => q("UPDATE org_types SET name = 'تلاعب' WHERE key = 'private_school' RETURNING key"))
    .then((rows) => { if (!rows.length) throw new Error("لا صلاحية"); }));
});
