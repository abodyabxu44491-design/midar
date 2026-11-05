/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The trust center: a badge is active only on a check that passed, a certificate is issued only from such a check and
// can be verified by its number, and everything shown says it is internal, not a government or third-party one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";

let srv, owner, pub;
const msg = (r) => r.data?.error?.message || r.data?.message || JSON.stringify(r.data);
const procedure = (over = {}) => ({ kind: "backup_restore", passed: true, summary: "استُعيدت نسخة في فرع منفصل وتطابقت أعداد السجلات",
  reference: "branch restore-drill-test", details: "اختبار آلي", confirm: true, ...over });

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  pub = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
});
after(async () => { await srv.close(); await endPool(); });

test("مركز الثقة يعرض الشارات الثماني، ويقول إنها داخلية، ولا يكشف أدلة الفحوص", async () => {
  const r = await pub.get("/api/public/trust");
  assert.equal(r.status, 200);
  assert.equal(r.data.badges.length, 8);
  assert.match(r.data.note, /ليست اعتمادًا حكوميًا أو شهادة من جهة خارجية/);
  for (const b of r.data.badges) {
    assert.ok(b.title && b.proves, b.kind);
    assert.equal(b.evidence, undefined, "الأدلة لا تُنشر");
    assert.equal(b.reference, undefined);
  }
  const page = await (await fetch(`${srv.base}/trust`)).text();
  assert.match(page, /مركز الثقة والتوثيق/);
  assert.match(page, /ليست اعتمادًا حكوميًا، ولا شهادة من جهة خارجية/);
});

test("لا يُسجَّل إجراء دون مرجع للدليل وتأكيد أنه نُفّذ، ولا يُسجَّل الفحص الآلي يدويًا", async () => {
  assert.equal((await owner.post("/api/owner/trust/record", procedure({ confirm: undefined }))).status, 400);
  assert.equal((await owner.post("/api/owner/trust/record", procedure({ reference: "" }))).status, 400);
  assert.equal((await owner.post("/api/owner/trust/record", procedure({ kind: "data_privacy" }))).status, 400);
});

test("لا تصدر شهادة عن إجراء لم ينجح آخر فحص له", async () => {
  assert.equal((await owner.post("/api/owner/trust/record", procedure({ passed: false, summary: "تعذّرت الاستعادة في التجربة" }))).status, 201);
  const r = await owner.post("/api/owner/trust/certificates", { kind: "backup_restore" });
  assert.equal(r.status, 409);
  assert.match(msg(r), /لم ينجح/);
  const b = (await pub.get("/api/public/trust")).data.badges.find((x) => x.kind === "backup_restore");
  assert.equal(b.active, false, "الشارة غير نشطة بعد فحص فاشل");
});

test("بعد تنفيذ الإجراء بنجاح: الشارة نشطة، والشهادة تصدر برقم مرجعي ويمكن التحقق منها ثم إلغاؤها", async () => {
  assert.equal((await owner.post("/api/owner/trust/record", procedure())).status, 201);
  const c = await owner.post("/api/owner/trust/certificates", { kind: "backup_restore" });
  assert.equal(c.status, 201, msg(c));
  assert.match(c.data.ref, /^MS-\d{4}-\d{4}$/);
  assert.equal(c.data.title, "شهادة اختبار النسخ الاحتياطي والاستعادة");
  assert.ok(c.data.issuer);

  const b = (await pub.get("/api/public/trust")).data.badges.find((x) => x.kind === "backup_restore");
  assert.equal(b.active, true);
  assert.equal(b.certificate, c.data.ref);

  const v = await pub.get(`/api/public/trust/verify/${c.data.ref.toLowerCase()}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.status, "valid");
  assert.equal(v.data.ref, c.data.ref);
  assert.match(v.data.scope, /استُعيدت فعلًا/);
  assert.match(v.data.note, /شارة داخلية/);
  assert.match(v.data.qr, /^data:image\/svg\+xml;base64,/);
  assert.equal((await fetch(`${srv.base}/trust/verify/${c.data.ref}`)).status, 200, "صفحة الشهادة القابلة للطباعة");

  assert.equal((await owner.post(`/api/owner/trust/certificates/${c.data.id}/revoke`, { reason: "اختبار الإلغاء" })).status, 200);
  const after = await pub.get(`/api/public/trust/verify/${c.data.ref}`);
  assert.equal(after.data.status, "revoked", "الشهادة الملغاة تبقى قابلة للتحقق وتظهر ملغاة");
  assert.equal((await owner.post(`/api/owner/trust/certificates/${c.data.id}/revoke`, { reason: "مرة ثانية" })).status, 409);
});

test("رقم شهادة غير موجود أو مكتوب خطأ لا يُظهر شيئًا", async () => {
  assert.equal((await pub.get("/api/public/trust/verify/MS-1999-9999")).status, 404);
  assert.equal((await pub.get("/api/public/trust/verify/anything")).status, 404);
});

test("الفحوص الآلية تفحص المنصة فعلًا: عزل بيانات المدارس على كل الجداول، والهوية من الإعدادات", async () => {
  const r = await owner.post("/api/owner/trust/run", { kind: "data_privacy" });
  assert.equal(r.status, 201, msg(r));
  assert.equal(r.data[0].passed, true, r.data[0].summary);
  assert.ok(r.data[0].evidence.tenant_tables > 50);
  assert.deepEqual(r.data[0].evidence.without_rls, []);

  await owner.put("/api/owner/settings", { company_name: "", company_name_en: "" });
  assert.equal((await owner.post("/api/owner/trust/run", { kind: "identity" })).data[0].passed, false, "الهوية الناقصة لا تنجح");
  await owner.put("/api/owner/settings", { company_name_en: "MIDAIR SCHOOL", company_country: "السعودية", brand_email: "support@midar.test" });
  const ok = (await owner.post("/api/owner/trust/run", { kind: "identity" })).data[0];
  assert.equal(ok.passed, true, ok.summary);
  assert.match(ok.summary, /MIDAIR SCHOOL/);

  const all = await owner.post("/api/owner/trust/run", {});
  assert.equal(all.data.length, 4, "كل الفحوص الآلية");
  const admin = all.data.find((x) => x.kind === "admin_protection");
  assert.equal(typeof admin.passed, "boolean");
  if (process.env.OWNER_TOTP_SECRET?.startsWith("JBSWY3DPEHPK3PXP")) assert.equal(admin.passed, false, "مفتاح الأمثلة المنشور لا يُعد حماية");
});

test("توثيق النطاق يولّد سجل TXT، ولا ينجح الفحص دون وجود السجل فعلًا", async () => {
  const d = await owner.put("/api/owner/trust/domain", { domain: "midar-test.invalid" });
  assert.equal(d.status, 200, msg(d));
  assert.equal(d.data.record_name, "_midar-verify.midar-test.invalid");
  assert.match(d.data.record_value, /^midar-verify=[A-Za-z0-9_-]{20,}$/);
  const again = await owner.put("/api/owner/trust/domain", { domain: "midar-test.invalid" });
  assert.equal(again.data.record_value, d.data.record_value, "النطاق نفسه يحتفظ برمزه");
  const r = (await owner.post("/api/owner/trust/run", { kind: "domain" })).data[0];
  assert.equal(r.passed, false);
  assert.equal((await owner.put("/api/owner/trust/domain", { domain: "https://bad" })).status, 400);
});

test("سجل الفحوص لا يُعدَّل ولا يُحذف، والزائر لا يصل إلى لوحة الثقة", async () => {
  await assert.rejects(transaction({ platform: true }, (q) => q("UPDATE trust_checks SET passed = true")));
  await assert.rejects(transaction({ platform: true }, (q) => q("DELETE FROM trust_checks")));
  assert.equal((await pub.get("/api/owner/trust")).status, 401);
  assert.equal((await pub.post("/api/owner/trust/record", procedure())).status, 401);
});

test("الشارات النشطة تظهر في بيانات الموقع للصفحة الرئيسية وصفحة الباقات", async () => {
  await owner.put("/api/owner/settings", { landing_mode: "marketing" });
  const s = (await pub.get("/api/site")).data;
  assert.ok(Array.isArray(s.trust_badges));
  assert.ok(s.trust_badges.some((b) => b.kind === "data_privacy"), JSON.stringify(s.trust_badges));
});
