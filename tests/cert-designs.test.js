/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool, uid } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";
import { transaction } from "../src/core/db/pool.js";

const D = "/api/admin/certificates/designs";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let srv, A, B, deputy, termTpl, customTpl, stamp, custom;

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "cd", students: 2 });
  B = await readySchool(srv.base, { prefix: "cx", students: 1 });
  const username = `dd-${uid()}`;
  const pw = (await A.admin.post("/api/admin/users/admins", { name: "وكيل الشؤون", username, admin_scope: "school" })).data.credentials.password;
  deputy = client(srv.base);
  assert.equal((await deputy.post("/api/staff/login", { school: A.id, username, password: pw })).status, 200);
  await transaction({ tenantId: A.id }, (q) => q("UPDATE users SET must_change_password = false WHERE username = $1", [username]));
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("قائمة التصاميم: الجاهزة والحقول، وإنشاء تصميم من قالب جاهز", async () => {
  const l = (await A.admin.get(D)).data;
  assert.equal(l.can_edit, true);
  assert.deepEqual(l.templates, []);
  assert.ok(l.presets.some((p) => p.key === "classic") && l.fields.some(([k]) => k === "student"));
  const r = await A.admin.post(D, { name: "شهادة الفصل الرسمية", kind: "term", from: { preset: "modern" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  termTpl = r.data;
  assert.equal(termTpl.version, 1);
  assert.equal(termTpl.layout.page.orientation, "portrait");
  assert.ok(termTpl.layout.els.some((e) => e.type === "table"));
  assert.equal((await A.admin.post(D, { name: "x", kind: "diploma" })).status, 400, "نوع غير معروف");
});

test("التصميم يُتحقق منه بدقة: الألوان والمفاتيح والحدود والصور", async () => {
  const put = (layout) => A.admin.put(`${D}/${termTpl.id}`, { name: termTpl.name, kind: "term", layout });
  const L = () => structuredClone(termTpl.layout);
  let l = L(); l.els[0].style.bg = "red; background:url(x)";
  assert.equal((await put(l)).status, 400, "لون غير صحيح");
  l = L(); l.els[0].onclick = "alert(1)";
  assert.equal((await put(l)).status, 400, "مفتاح غير معروف");
  l = L(); l.els[0].style.position = "fixed";
  assert.equal((await put(l)).status, 400, "خاصية تنسيق غير معروفة");
  l = L(); l.els[0].w = 5000;
  assert.equal((await put(l)).status, 400, "خارج حدود الصفحة");
  l = L(); l.els.push({ id: "img1", type: "image", x: 10, y: 10, w: 30, h: 30, asset: 999999 });
  assert.equal((await put(l)).status, 400, "صورة غير موجودة في المكتبة");
  l = L(); l.els.push({ id: "t9", type: "text", x: 10, y: 10, w: 60, h: 10, text: "<script>alert(1)</script> {{student}}" });
  const ok = await put(l);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.version, 2);
  assert.equal(ok.data.layout.els.at(-1).text, "<script>alert(1)</script> {{student}}", "النص يُحفظ كنص ويُعرض كنص");
  termTpl = ok.data;
});

test("مكتبة الصور: نوع الملف يطابق محتواه، والصورة تُقرأ وتُخفى", async () => {
  const bad = await A.admin.post(`${D}/assets`, { name: "ختم", mime: "image/png", data: Buffer.from("not really a png file at all").toString("base64") });
  assert.equal(bad.status, 400);
  assert.equal((await A.admin.post(`${D}/assets`, { name: "gif", mime: "image/gif", data: PNG })).status, 400);
  const r = await A.admin.post(`${D}/assets`, { name: "ختم المدرسة", mime: "image/png", data: PNG, width: 1, height: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  stamp = r.data;
  assert.equal(stamp.size_bytes, Buffer.from(PNG, "base64").length);
  const img = await fetch(`${srv.base}${D}/assets/${stamp.id}`, { headers: { Cookie: A.admin.cookie() } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), Buffer.from(PNG, "base64"));
  assert.ok((await A.admin.get(`${D}/assets`)).data.some((a) => a.id === stamp.id && !("data" in a)), "القائمة بلا محتوى الصور");
  const extra = (await A.admin.post(`${D}/assets`, { name: "مؤقتة", mime: "image/png", data: PNG })).data;
  assert.equal((await A.admin.post(`${D}/assets/${extra.id}/hide`, {})).status, 200);
  assert.ok(!(await A.admin.get(`${D}/assets`)).data.some((a) => a.id === extra.id));
});

test("الشهادة تحفظ نسخة من تصميمها وصورها، وتعديل التصميم لاحقًا لا يغيّر الصادرة", async () => {
  const c = await A.admin.post(D, { name: "شكر وتقدير", kind: "custom", from: { preset: "appreciation" } });
  assert.equal(c.status, 201);
  const layout = structuredClone(c.data.layout);
  layout.els.push({ id: "stamp", type: "image", x: 120, y: 150, w: 30, h: 30, asset: stamp.id, style: { op: 0.85 } });
  layout.page.bgAsset = stamp.id;
  customTpl = (await A.admin.put(`${D}/${c.data.id}`, { name: "شكر وتقدير", kind: "custom", layout })).data;

  const [s1, s2] = A.students;
  assert.equal((await A.admin.post("/api/admin/certificates/custom", { student_id: s1.id, title: "شهادة تقدير", body: "للتميز", template_id: termTpl.id })).status, 400, "تصميم لنوع آخر");
  const r = await A.admin.post("/api/admin/certificates/custom", { student_id: s1.id, title: "شهادة تقدير", body: "للتميز في القراءة", template_id: customTpl.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  custom = r.data;
  const p1 = (await A.admin.post("/api/admin/certificates/print", { ids: [custom.id] })).data[0];
  assert.deepEqual(p1.data.layout, customTpl.layout);
  assert.deepEqual(p1.data.template, { id: customTpl.id, name: "شكر وتقدير", version: customTpl.version });
  assert.match(p1.assets[stamp.id], /^data:image\/png;base64,/, "صور التصميم ترافق الشهادة للطباعة");

  // The template changes (even its images are hidden); the issued certificate keeps its design.
  const changed = structuredClone(customTpl.layout);
  changed.els = changed.els.filter((e) => e.id !== "stamp");
  changed.page.bgAsset = null;
  changed.page.border.style = "none";
  assert.equal((await A.admin.put(`${D}/${customTpl.id}`, { name: "شكر وتقدير", kind: "custom", layout: changed })).status, 200);
  await A.admin.post(`${D}/assets/${stamp.id}/hide`, {});
  const p2 = (await A.admin.post("/api/admin/certificates/print", { ids: [custom.id] })).data[0];
  assert.deepEqual(p2.data.layout, customTpl.layout);
  assert.ok(p2.assets[stamp.id], "الصورة المخفية تبقى للشهادات التي استخدمتها");

  // Without a chosen template: the kind's default, else the "all kinds" default, else the built-in design.
  const plain = (await A.admin.post("/api/admin/certificates/custom", { student_id: s2.id, title: "شهادة شكر", body: "للمشاركة" })).data;
  const pp = (await A.admin.post("/api/admin/certificates/print", { ids: [plain.id] })).data[0];
  assert.equal(pp.data.template.preset, "appreciation");
  const any = (await A.admin.post(D, { name: "موحد", kind: "any", from: { preset: "classic" } })).data;
  await A.admin.post(`${D}/${any.id}/default`, {});
  const viaAny = (await A.admin.post("/api/admin/certificates/custom", { student_id: s2.id, title: "شهادة شكر", body: "للمشاركة" })).data;
  assert.equal((await A.admin.post("/api/admin/certificates/print", { ids: [viaAny.id] })).data[0].data.template.id, any.id);
  await A.admin.post(`${D}/${customTpl.id}/default`, {});
  const viaKind = (await A.admin.post("/api/admin/certificates/custom", { student_id: s2.id, title: "شهادة شكر", body: "للمشاركة" })).data;
  assert.equal((await A.admin.post("/api/admin/certificates/print", { ids: [viaKind.id] })).data[0].data.template.id, customTpl.id, "افتراضي النوع يسبق الموحد");

  // Parents print the same design with its images.
  const pr = await client(srv.base).post(`/api/public/${A.id}/student/certificates/print`, { ...A.parent(s1), id: custom.id });
  assert.equal(pr.status, 200);
  assert.deepEqual(pr.data[0].data.layout, customTpl.layout);
  assert.ok(pr.data[0].assets[stamp.id]);
});

test("تصميم افتراضي واحد لكل نوع، والحذف لا يمس الشهادات", async () => {
  const second = (await A.admin.post(D, { name: "تقدير ثانٍ", kind: "custom", from: { template: customTpl.id } })).data;
  assert.deepEqual(second.layout, (await A.admin.get(`${D}/${customTpl.id}`)).data.layout, "النسخ يأخذ التصميم الحالي");
  await A.admin.post(`${D}/${second.id}/default`, {});
  const list = (await A.admin.get(D)).data.templates;
  assert.deepEqual(list.filter((t) => t.kind === "custom" && t.is_default).map((t) => t.id), [second.id]);
  assert.equal((await A.admin.post(`${D}/${second.id}/archive`, {})).status, 200);
  assert.ok(!(await A.admin.get(D)).data.templates.some((t) => t.id === second.id));
  assert.equal((await A.admin.get(`${D}/${second.id}`)).status, 404);
  assert.equal((await A.admin.post("/api/admin/certificates/custom", { student_id: A.students[0].id, title: "x شهادة", body: "نص", template_id: second.id })).status, 404);
  // Changing a default template's kind clears its default flag.
  await A.admin.post(`${D}/${customTpl.id}/default`, {});
  const t = (await A.admin.get(`${D}/${customTpl.id}`)).data;
  assert.equal(t.is_default, true);
  const moved = (await A.admin.put(`${D}/${t.id}`, { name: t.name, kind: "term", layout: t.layout })).data;
  assert.equal(moved.is_default, false);
  assert.equal((await A.admin.post("/api/admin/certificates/print", { ids: [custom.id] })).data[0].data.template.id, customTpl.id);
});

test("الصلاحيات: الوكيل والمعلم يطّلعان أو يُمنعان ولا يعدّلان التصاميم", async () => {
  const l = await deputy.get(D);
  assert.equal(l.status, 200);
  assert.equal(l.data.can_edit, false);
  assert.equal((await deputy.post(D, { name: "ممنوع", kind: "term" })).status, 403);
  assert.equal((await deputy.put(`${D}/${termTpl.id}`, { name: "ممنوع", kind: "term", layout: termTpl.layout })).status, 403);
  assert.equal((await deputy.post(`${D}/${termTpl.id}/default`, {})).status, 403);
  assert.equal((await deputy.post(`${D}/${termTpl.id}/archive`, {})).status, 403);
  assert.equal((await deputy.post(`${D}/assets`, { name: "x", mime: "image/png", data: PNG })).status, 403);
  assert.equal((await deputy.post(`${D}/assets/${stamp.id}/hide`, {})).status, 403);
  assert.ok([401, 403].includes((await A.teacher.get(D)).status));
  assert.ok([401, 403].includes((await client(srv.base).get(D)).status));
});

test("العزل: لا تصل مدرسة لتصاميم أو صور مدرسة أخرى", async () => {
  assert.deepEqual((await B.admin.get(D)).data.templates, []);
  assert.equal((await B.admin.get(`${D}/${termTpl.id}`)).status, 404);
  const bp = await B.admin.put(`${D}/${termTpl.id}`, { name: "تصميم مسروق", kind: "term", layout: termTpl.layout });
  assert.equal(bp.status, 404, JSON.stringify(bp.data));
  assert.equal((await B.admin.post(`${D}/${termTpl.id}/default`, {})).status, 404);
  assert.equal((await B.admin.post(`${D}/${termTpl.id}/archive`, {})).status, 404);
  assert.equal((await B.admin.get(`${D}/assets/${stamp.id}`)).status, 404);
  assert.equal((await B.admin.post(`${D}/assets/${stamp.id}/hide`, {})).status, 404);
  assert.equal((await B.admin.post(D, { name: "نسخ", kind: "term", from: { template: termTpl.id } })).status, 404);
  const own = (await B.admin.post(D, { name: "تصميمي", kind: "custom", from: { preset: "appreciation" } })).data;
  const l = structuredClone(own.layout);
  l.els.push({ id: "steal", type: "image", x: 1, y: 1, w: 10, h: 10, asset: stamp.id });
  assert.equal((await B.admin.put(`${D}/${own.id}`, { name: "تصميمي", kind: "custom", layout: l })).status, 400, "صورة مدرسة أخرى غير موجودة");
  assert.equal((await B.admin.post("/api/admin/certificates/custom", { student_id: B.students[0].id, title: "شهادة تقدير", body: "نص", template_id: customTpl.id })).status, 404);
  await assert.rejects(transaction({ tenantId: A.id }, (q) => q("DELETE FROM certificate_assets WHERE id = $1", [stamp.id])), /permission denied/);
  await assert.rejects(transaction({ tenantId: A.id }, (q) => q("UPDATE certificate_assets SET data = '' WHERE id = $1", [stamp.id])), /permission denied/);
});
